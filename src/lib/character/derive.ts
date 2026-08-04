/*
 * The aggregator: character + loaded content + rules core + effects engine → the full set
 * of derived stats a sheet renders. One call, `deriveSheet(character, graph)`.
 *
 * This is the glue seam — it resolves the character's `type:source:id` refs against the
 * content graph, runs the pure rules math on the resulting numbers, and layers active
 * effects through `applyEffects`. Ability scores flow through the SAME fold/clamp pipeline
 * as every other stat (A10): base + boosts + score-targeting effects fold into a traced,
 * clamped `Computed`, resolved in DEPENDENCY order by the effects DAG (a guarded ability
 * bonus, a rage that raises max HP feeding `is_bloodied` — see effects/dependency-graph.ts). Missing
 * referenced content is skipped gracefully (loader already flagged it) — the sheet computes
 * with what it can.
 *
 * Every field is a `Computed` ({value, trace, notes}), so the UI explains any number.
 */
import { tokensOf, type ContentGraph, type LoadedRow, type LoadedRowOf } from '../content/loader';
import type { Character } from './schema';
import { gatherEffects } from './derive-gather';
import { applyPluginPrePass } from './derive-plugins';
import {
	num,
	gatherGrantedProficiencies,
	resolveClassSaves,
	deriveAbilityBlocks,
	deriveSkills,
	deriveAc,
	deriveSpeed,
	derivePassives,
	deriveDefenses,
	type SkillProficiency,
	type AbilityBlock,
	type StatInputs
} from './derive-stats';
import { ABILITIES } from './schema';
import {
	proficiencyBonus,
	initiative as initiativeOf,
	maxHpForClass,
	carryingCapacity,
	ABILITY_SCORE_CLAMP,
	DIE_MAX,
	type Ability
} from '../rules/core';
import { gatherProfGrants, isArmorProficient, armorCategoryOf } from '../rules/proficiency';
import {
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue,
	ctxOf
} from '../effects/token-parser';
import { evalExpression, diceToFormula, type ExprContext } from '../effects/expression-evaluator';
import { applyEffects, collectFacts, type EffectFacts, type ResourceDef } from '../effects/apply';
import { didYouMean } from '../effects/suggest';
import { resolveActiveEffects } from '../effects/resolver';
import { deriveSpellcasting, castingAbilityByClass, type Spellcasting } from './spellcasting';
import { makeEffectCtxFactory, baseResolveState } from './derive-context';
import { computed, type Computed, type Contribution, type System } from '../rules/pipeline';

// SKILL_ABILITY / SkillId live in the leaf `./skills` (so derive's sub-modules share them without a
// cycle); re-exported here so existing `$lib/character/derive` importers keep working.
import { SKILL_ABILITY, type SkillId } from './skills';
export { SKILL_ABILITY, type SkillId };
// B13 target validation moved to ./derive-targets (the closed-vocab check collectFacts runs).
import { isEffectTargetSupported } from './derive-targets';

export interface CharacterSheet {
	level: number;
	proficiencyBonus: number;
	abilities: Record<Ability, AbilityBlock>;
	skills: Record<SkillId, Computed & { prof: SkillProficiency }>;
	ac: Computed;
	initiative: Computed;
	speed: Computed;
	/** Fly / swim speeds — base 0 (no SRD species grants one); effects (`set_override:speed.fly:60`
	 *  — the Fly spell, magic items) are the source. Rendered only when nonzero. */
	flySpeed: Computed;
	swimSpeed: Computed;
	maxHp: Computed;
	/** Hit-dice pools grouped by die size (paladin 5 / fighter 5 → one d10 pool of 10; different die
	 *  sizes stay separate — RAW multiclass rule). Spent counts live in `play.hitDiceSpent` keyed by die. */
	hitDice: HitDiePool[];
	/** Passive score of every skill (10 + mod ± adv/dis, `passive.<skill>` effects folded). The play
	 *  view can pin any skill as a passive sense; the strip highlights perception/investigation/insight. */
	passives: Record<SkillId, Computed>;
	carryingCapacity: Computed;
	/** Damage resistances / immunities / vulnerabilities from active effects (by type). */
	defenses: { resist: string[]; immune: string[]; vulnerable: string[] };
	/** Trackable resource pools (rage, ki, item N/day…) from `grant_resource` effects. */
	resources: ResourceDef[];
	/** Piece 3: spend-options on granted resources (Ki → Flurry of Blows…), resolved from the
	 *  `resource_option` linked table for the resources this character actually has. */
	resourceOptions: ResourceOption[];
	/** Per-class casting profiles + shared/pact slot pools (empty classes = non-caster). */
	spellcasting: Spellcasting;
	/** Content refs the character points at that the graph couldn't resolve. */
	missing: string[];
	/** Per-character derive-time problems (a malformed L2 expression / guard for THIS build) — the
	 *  SPEC10 channel content-health merges with loader issues. Empty on a clean sheet. */
	deriveIssues: EffectIssue[];
	/** The guard-resolved, condition-expanded effect list (the ONE resolve stage's output) — the
	 *  roll path / action economy read THIS, never raw `play.effects` (B21). Empty when
	 *  effects-auto is off. */
	resolvedEffects: ActiveEffect[];
	/** The typed-facts view of `resolvedEffects` (parsed once, values resolved once — D7): what
	 *  every consumer outside the stat folds reads (roll path, action economy, panels). */
	facts: EffectFacts;
	/** The post-derive L2 snapshot ctx (final build vars + live play getters), for CAST-TIME evaluation
	 *  that needs sheet vars plus the ephemeral `slot`/`spell_level` — upcast wraps it with
	 *  `withCastSlot` (UPCAST §4/§5). `undefined` when effects-auto is off (N6: no auto-scaling — the
	 *  cast falls back to base damage + prose), so a consumer gates on its presence. */
	castCtx?: ExprContext;
}

/** Piece 3: a spend-option on a granted resource, resolved for a specific character. `cost` is a
 *  small integer or `'x'` (player-picked variable spend, 1..remaining); context-dependent costs
 *  (spell_level etc.) are deferred — an unsupported cost drops the option with a deriveIssue. */
export interface ResourceOption {
	id: string;
	resourceId: string;
	name: string;
	description: string;
	/** A bounded action token (apply_condition / heal / roll / gain_action / rest:short|long /
	 *  restore_resource:<id> / note) the UI runs / displays. */
	action: string;
	actionType: 'action' | 'bonus_action' | 'reaction' | 'free';
	cost: number | 'x';
}

interface ResourceOptionsInput {
	graph: ContentGraph;
	resourceIds: Set<string>;
	system: System;
	isActive: (row: LoadedRow) => boolean;
	issues: EffectIssue[];
	/** The L2 context (base), so a `heal:`/`roll:` action's formula resolves to concrete dice HERE
	 *  (once, like resource maxes) instead of at spend time; absent when auto-calc is off (manual). */
	ctx: ExprContext | undefined;
}

/** Resolve the L2 value inside a resource-option `action` so the executor can just roll it: `heal:` /
 *  `roll:` carry a formula (`1d10+class_level.fighter` → `1d10+5`); `apply_condition:` / `note:` pass
 *  through unchanged. A resolution failure keeps the raw token + flags a deriveIssue (executor no-ops). */
function resolveActionFormula(
	action: string,
	ctx: ExprContext | undefined,
	name: string,
	issues: EffectIssue[]
): string {
	const i = action.indexOf(':');
	if (i === -1) return action;
	const verb = action.slice(0, i);
	const rest = action.slice(i + 1).trim();
	if ((verb !== 'heal' && verb !== 'roll') || !rest || !ctx) return action;
	const r = evalExpression(rest, ctx);
	if (!r.ok) {
		issues.push({ source: name, token: action, reason: r.error });
		return action;
	}
	const formula =
		r.value.type === 'number' ? String(Math.floor(r.value.value)) : diceToFormula(r.value.dice);
	return `${verb}:${formula}`;
}

/** Gather the spend-options for the resources a character has (edition + source filtered). Pure. */
function resolveResourceOptions({
	graph,
	resourceIds,
	system,
	isActive,
	issues,
	ctx
}: ResourceOptionsInput): ResourceOption[] {
	const out: ResourceOption[] = [];
	for (const row of graph.rows) {
		if (row.type !== 'resource_option' || !row.systems.includes(system) || !isActive(row)) continue;
		const resourceId = String(row.data.resource_id);
		if (!resourceIds.has(resourceId)) continue;
		const raw = String(row.data.cost ?? '').trim();
		let cost: number | 'x';
		if (raw === 'x') cost = 'x';
		else if (/^\d+$/.test(raw)) cost = Number(raw);
		else {
			issues.push({
				source: String(row.data.name_en),
				token: `cost:${raw}`,
				reason: 'unsupported resource-option cost (v1 supports an integer or `x`)'
			});
			continue;
		}
		out.push({
			id: row.id,
			resourceId,
			name: String(row.data.name_en),
			description: String(row.data.text_en ?? ''),
			action: resolveActionFormula(
				String(row.data.action ?? ''),
				ctx,
				String(row.data.name_en),
				issues
			),
			actionType: (row.data.action_type as ResourceOption['actionType']) ?? 'action',
			cost
		});
	}
	return out;
}

/** A4: armor with the stealth-disadvantage flag synthesizes a `disadvantage:skill.stealth` FACT so
 *  it reaches BOTH the hover note and the actual Hide roll (deduped by target+source, like a token). */
function applyStealthDisadvantage(
	equippedArmor: LoadedRowOf<'item'> | undefined,
	facts: EffectFacts
): void {
	if (!equippedArmor?.data.stealth_disadvantage) return;
	const source = String(equippedArmor.data.name_en);
	if (!facts.disadvantage.some((d) => d.target === 'skill.stealth' && d.source === source))
		facts.disadvantage.push({ target: 'skill.stealth', source });
}

/** A16: an `apply_condition:<id>` whose condition has no row in the active edition would set a
 *  PHANTOM flag silently (a typo'd id matches nothing). Surface it as a content-health issue with a
 *  did-you-mean. A real edition-matched condition with an empty effects column is legitimate. */
function flagPhantomConditions(
	facts: EffectFacts,
	graph: ContentGraph,
	system: System,
	issues: EffectIssue[]
): void {
	const conditionIds = new Set(graph.list('condition', { system }).map((r) => r.id));
	for (const id of facts.conditions)
		if (!conditionIds.has(id))
			issues.push({
				source: 'apply_condition',
				token: `apply_condition:${id}`,
				reason: `unknown condition "${id}"${didYouMean(id, conditionIds)}` // PLG-9
			});
}

/** A10 seeds: the score fold starts from the base score + allocated boosts, as traced contributions. */
function seedAbilityBase(build: Character['build']): Record<Ability, Contribution[]> {
	const abilityBase = {} as Record<Ability, Contribution[]>;
	for (const ab of ABILITIES) {
		const contribs: Contribution[] = [
			{ source: 'Base score', layer: 'base', op: 'add', amount: build.abilities[ab] }
		];
		const boost = build.abilityBoosts?.[ab] ?? 0;
		if (boost) contribs.push({ source: 'Ability boosts', layer: 'base', op: 'add', amount: boost });
		abilityBase[ab] = contribs;
	}
	return abilityBase;
}

/** Class levels keyed by BARE id (`class_level.monk`), summed across multiclass entries. */
function computeClassLevels(
	build: Character['build'],
	graph: ContentGraph
): Record<string, number> {
	const classLevels: Record<string, number> = {};
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (row) classLevels[row.id] = (classLevels[row.id] ?? 0) + c.level;
	}
	return classLevels;
}

/** The primary caster's ability (highest caster-class level) — the ctx's default `spellcasting_mod`. */
function pickPrimaryCaster(
	abilityByClass: Record<string, Ability>,
	classLevels: Record<string, number>
): Ability | undefined {
	let primaryAbility: Ability | undefined;
	let primaryLevel = -1;
	for (const [cid, ab] of Object.entries(abilityByClass)) {
		const lvl = classLevels[cid] ?? 0;
		if (lvl > primaryLevel) {
			primaryLevel = lvl;
			primaryAbility = ab;
		}
	}
	return primaryAbility;
}

interface ArmorSpellBlockInput {
	spellcasting: Spellcasting;
	equippedArmor: LoadedRowOf<'item'> | undefined;
	build: Character['build'];
	graph: ContentGraph;
	issues: EffectIssue[];
}

/** B9: worn armor you lack proficiency with blocks spellcasting (RAW canonical rule-block). Grants
 *  come from the character's classes; lenient — undeclared classes stay proficient with all armor. */
function applyArmorSpellBlock({
	spellcasting,
	equippedArmor,
	build,
	graph,
	issues
}: ArmorSpellBlockInput): void {
	if (!equippedArmor) return;
	const armorGrants = gatherProfGrants(
		build.classes.map((c) => {
			const r = graph.get(c.class);
			return r?.type === 'class' ? r.data.armor_profs : undefined;
		})
	);
	if (isArmorProficient(armorGrants, equippedArmor.data.item_type, equippedArmor.data.category))
		return;
	const source = String(equippedArmor.data.name_en);
	// cat is always defined here — isArmorProficient returns true (no block) on an unclassifiable armor.
	const cat = armorCategoryOf(equippedArmor.data.item_type, equippedArmor.data.category);
	spellcasting.armorBlock = {
		source,
		note: `Not proficient with ${cat} armor — spellcasting blocked`
	};
	issues.push({ source, token: 'armor_proficiency', reason: spellcasting.armorBlock.note });
}

/** A hit-dice pool: one die size + how many of it the character has (= summed levels of classes with
 *  that die). Spent counts live in `play.hitDiceSpent`, keyed by `die`. */
export interface HitDiePool {
	die: string;
	max: number;
}

/** Group the character's classes into hit-dice pools by die size (RAW multiclass: pool same-size dice,
 *  keep different sizes separate). Sorted largest die first — a deterministic recover order for the
 *  2014 half-recovery. Pure. */
export function hitDicePools(build: Character['build'], graph: ContentGraph): HitDiePool[] {
	const byDie = new Map<string, number>();
	for (const c of build.classes) {
		const row = graph.get(c.class);
		const die = String((row?.type === 'class' ? row.data.hit_die : undefined) || 'd8');
		byDie.set(die, (byDie.get(die) ?? 0) + c.level);
	}
	return [...byDie]
		.map(([die, max]) => ({ die, max }))
		.sort((a, b) => (DIE_MAX[b.die] ?? 0) - (DIE_MAX[a.die] ?? 0));
}

// Stays over max-lines-per-function (~134) by design — a deliberate D1 exception like CombatVM. The
// separable phases are already pure helpers (setup slices, the ctx factory, resolve, gather, the
// stat/spell/armor phases); what remains is orchestration + the final assembly, whose length is
// intrinsic. Complexity is already <20. Splitting further would thread big param bundles through glue
// code for no readability gain.
export function deriveSheet(
	character: Character,
	graph: ContentGraph,
	// B15: source/collision filter. Kept a PARAMETER (not an import) so derive stays framework-
	// agnostic and testable; the VMs pass `isRowActive` (reactive over the source config), tests
	// default to all-active. Applied once at gather, never per-stat.
	isActive: (row: LoadedRow) => boolean = () => true
): CharacterSheet {
	const build = character.build;
	const system = character.system;
	const missing: string[] = [];
	const issues: EffectIssue[] = [];
	// effects-auto global toggle: off → no effect layers (base stats / text only)
	const active = character.play.autoCalc
		? gatherEffects({ character, graph, isActive, missing, issues })
		: [];

	const level = build.classes.reduce((n, c) => n + c.level, 0) || 1;
	const prof = proficiencyBonus(level);

	// A10 seeds + class levels (bare id) + species base speed — the pure setup slices.
	const abilityBase = seedAbilityBase(build);
	const classLevels = computeClassLevels(build, graph);
	const speciesRow = build.species ? graph.get(build.species) : undefined;
	const baseSpeed = num(speciesRow?.type === 'species' ? speciesRow.data.speed : undefined, 30);

	// base max HP (pre-effect) as a function of the FINAL CON — the DAG's structural con→hp_max
	// edge means score-writing effects resolve first, then this recomputes with the effective CON.
	// classes[0] grants the max hit die; multiclasses avg-up (RAW).
	const hpMaxBaseFor = (conScore: number): Contribution[] => {
		const parts = build.classes.map((c, i) => {
			const row = graph.get(c.class);
			const hitDie = String((row?.type === 'class' ? row.data.hit_die : undefined) || 'd8');
			return maxHpForClass({ hitDie, level: c.level, conScore, includesCharacterLevel1: i === 0 });
		});
		return parts.length
			? parts.flatMap((h) => h.trace)
			: maxHpForClass({ hitDie: 'd8', level, conScore, includesCharacterLevel1: true }).trace;
	};

	// equipped armor — shared by the AC math below and the `armor_type`/`is_wearing_armor` guards.
	const equippedArmor = build.inventory
		.map((i) => (i.equipped ? graph.get(i.item) : undefined))
		.find((r): r is LoadedRowOf<'item'> => r?.type === 'item' && r.data.category === 'armor');

	// casting ability per caster class + the primary caster (highest caster class level) — the
	// cheap slice the resolve ctx needs; full spellcasting derives AFTER the final scores exist.
	const abilityByClass = castingAbilityByClass(character, graph);
	const primaryAbility = pickPrimaryCaster(abilityByClass, classLevels);

	const expandCondition = (condId: string) => {
		// A16(a): edition-filter the lookup — a 5.5e `frightened` row must NOT apply to a 5e character
		// when both roots are loaded, exactly the `systems` gate the class-feature scan above uses.
		// A16(b): first match is now deterministic within the edition (load order); a genuine
		// same-id/same-edition clash across two sources is a collisions.json concern, not resolved here.
		const cond = graph.list('condition', { system }).find((r) => r.id === condId);
		const toks = tokensOf(cond);
		return cond && toks.length ? { source: String(cond.data.name_en), tokens: toks } : undefined;
	};

	// The ctx factory (derive-context.ts): closes over the static setup, returns `(state) => EffectCtx`
	// with live getters over the resolve state (see that file for the mid-resolve read contract).
	const makeCtx = makeEffectCtxFactory({
		character,
		level,
		proficiencyBonus: prof,
		classLevels,
		primaryAbility,
		baseSpeed,
		equippedArmor,
		speciesRow,
		abilityByClass
	});

	// The ONE resolve stage (effects/dependency-graph.ts): dependency-ordered guards, A10 ability pipeline,
	// condition expansion — every consumer below reads its output.
	let effCtx: EffectCtx | undefined;
	let resolvedEffects: ActiveEffect[] = [];
	let abilityComputed: Record<Ability, Computed>;
	let maxHpBase: Computed;
	if (character.play.autoCalc) {
		const r = resolveActiveEffects({
			active,
			makeCtx,
			expandCondition,
			abilityBase,
			hpMaxBase: hpMaxBaseFor,
			resourcesSpent: character.play.resourcesSpent
		});
		issues.push(...r.issues);
		effCtx = r.ctx;
		resolvedEffects = r.effects;
		abilityComputed = r.abilities;
		maxHpBase = r.hpMaxBase;
	} else {
		abilityComputed = {} as Record<Ability, Computed>;
		for (const ab of ABILITIES)
			abilityComputed[ab] = computed(abilityBase[ab], ABILITY_SCORE_CLAMP);
		maxHpBase = computed(hpMaxBaseFor(abilityComputed.con.value), { min: 1 });
	}
	const scores = {} as Record<Ability, number>;
	for (const ab of ABILITIES) scores[ab] = abilityComputed[ab].value;
	// Auto-calc OFF gates the effect LAYERS (Bless / Rage / conditions), NOT the spell's OWN mechanics:
	// with no resolve stage there's no `effCtx`, but upcast + resource-option formulas still need the L2
	// ctx (so a higher-slot cast scales its dice in manual mode, like cantrip die-scaling already does).
	// Build it from the base state — the same `makeCtx` factory, fed base scores.
	if (!effCtx) effCtx = makeCtx(baseResolveState(scores, maxHpBase.value));

	// the ONE typed-facts object (D7): every token parsed + value-resolved once; every consumer
	// below (and the roll path / action economy through the sheet) reads THIS, never a re-scan.
	const facts = collectFacts(resolvedEffects, effCtx, issues, isEffectTargetSupported);

	// L3 plugin PRE-PASS (stage 2½ — between resolve and the fold); a no-op with no plugin tokens.
	if (character.play.autoCalc && resolvedEffects.length)
		applyPluginPrePass({
			character,
			resolvedEffects,
			scores,
			prof,
			level,
			classLevels,
			facts,
			effCtx,
			expandCondition,
			maxHpBase,
			issues
		});

	applyStealthDisadvantage(equippedArmor, facts); // A4
	flagPhantomConditions(facts, graph, system, issues); // A16

	// spellcasting AFTER the resolve, so DCs/attacks read the EFFECTIVE scores (a Headband of
	// Intellect moves the wizard's DC, as it should) — and `spell_dc`/`spell_attack` effects fold in.
	const spellcasting = deriveSpellcasting(character, graph, scores, facts);

	applyArmorSpellBlock({ spellcasting, equippedArmor, build, graph, issues }); // B9

	// stat phases — each reads the shared computed inputs (build/scores/level/facts); see the pure
	// helpers above. Grouped so deriveSheet stays an orchestrator, not a 300-line body.
	const statInputs: StatInputs = { build, scores, level, facts };
	const { grantedSaves, grantedSkills } = gatherGrantedProficiencies(facts);
	const classSaves = resolveClassSaves(build, graph, grantedSaves, missing);
	const abilities = deriveAbilityBlocks(statInputs, abilityComputed, classSaves);
	const skills = deriveSkills(statInputs, grantedSkills);
	const ac = deriveAc(statInputs, equippedArmor, character.play.shieldRaised);

	// HP: the base fold came out of the resolve stage (recomputed at the final CON); hp_max flows
	// through the seam like every other stat (Toughness, Aid → `flat_bonus:hp_max+N`).
	const maxHp = applyEffects('hp_max', maxHpBase, facts);

	const speed = deriveSpeed(statInputs, speciesRow, baseSpeed, equippedArmor);
	// fly/swim: no SRD species grants a base, so the fold starts at 0 and effects are the source
	const movementOf = (key: 'speed.fly' | 'speed.swim') =>
		applyEffects(key, computed([], { min: 0 }), facts);

	const defenses = deriveDefenses(facts);

	// the base L2 ctx (a bare synthetic effect — no per-effect spellcasting scoping): resource-option
	// formulas resolve against it here, AND it's the post-derive snapshot the cast layer wraps for
	// upcast (UPCAST §5). Always present now — built from base state even with auto-calc off (the toggle
	// gates effect LAYERS, not spell mechanics like upcast; N6 revised 2026-08-04).
	const baseCtx = ctxOf(effCtx, { source: '', layer: 'feature', tokens: [] });

	return {
		level,
		proficiencyBonus: prof,
		abilities,
		skills,
		ac,
		initiative: applyEffects('initiative', initiativeOf({ dexScore: scores.dex }), facts),
		speed,
		flySpeed: movementOf('speed.fly'),
		swimSpeed: movementOf('speed.swim'),
		maxHp,
		hitDice: hitDicePools(build, graph),
		passives: derivePassives(skills, facts),
		carryingCapacity: carryingCapacity({ strScore: scores.str, system }),
		defenses,
		resources: facts.resources,
		resourceOptions: resolveResourceOptions({
			graph,
			resourceIds: new Set(facts.resources.map((r) => r.id)),
			system,
			isActive,
			issues,
			// the base L2 ctx (resource-option formulas don't use per-effect spellcasting scoping), so
			// `heal:`/`roll:` formulas resolve once here like resource maxes
			ctx: baseCtx
		}),
		spellcasting,
		missing: [...new Set(missing)], // dedupe: the same ref can be missing from several scans (D19)
		deriveIssues: issues,
		resolvedEffects,
		facts,
		...(baseCtx ? { castCtx: baseCtx } : {})
	};
}
