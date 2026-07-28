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
	type Ability
} from '../rules/core';
import { gatherProfGrants, isArmorProficient, armorCategoryOf } from '../rules/proficiency';
import { type ActiveEffect, type EffectCtx, type EffectIssue } from '../effects/token-parser';
import { applyEffects, collectFacts, type EffectFacts, type ResourceDef } from '../effects/apply';
import { didYouMean } from '../effects/suggest';
import { resolveActiveEffects } from '../effects/resolver';
import { RAGE_CONDITION_ID, type ResolveState } from '../effects/dependency-graph';
import { deriveSpellcasting, castingAbilityByClass, type Spellcasting } from './spellcasting';
import {
	makeExprContext,
	withSpellcastingMod,
	type BuildVars,
	type PlayVars
} from '../effects/context';
import type { ExprContext } from '../effects/expression-evaluator';
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
}

/** Armor weight class of the equipped armor (for the `armor_type` guard variable); no armor → none. */
function armorWeightOf(row: LoadedRowOf<'item'> | undefined): PlayVars['armorType'] {
	const t = String(row?.data.item_type ?? '').toLowerCase();
	if (t.includes('heavy')) return 'heavy';
	if (t.includes('medium')) return 'medium';
	if (t.includes('light')) return 'light';
	return 'none';
}

/** Piece 3: a spend-option on a granted resource, resolved for a specific character. `cost` is a
 *  small integer or `'x'` (player-picked variable spend, 1..remaining); context-dependent costs
 *  (spell_level etc.) are deferred — an unsupported cost drops the option with a deriveIssue. */
export interface ResourceOption {
	id: string;
	resourceId: string;
	name: string;
	description: string;
	/** A bounded action token (apply_condition / heal / roll / note) the UI runs / displays. */
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
}

/** Gather the spend-options for the resources a character has (edition + source filtered). Pure. */
function resolveResourceOptions({
	graph,
	resourceIds,
	system,
	isActive,
	issues
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
			action: String(row.data.action ?? ''),
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
		if (!conditionIds.has(id) && id !== RAGE_CONDITION_ID)
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

	/** The ONE ctx (makeExprContext) over the LIVE resolve state: records/Set are the state's own
	 *  mutable containers, scalars go through getters — so a guard evaluated mid-resolve reads
	 *  exactly the values the DAG has already resolved (and the final ctx reads the final state). */
	const makeCtx = (state: ResolveState): EffectCtx => {
		const buildVars: BuildVars = {
			level,
			proficiencyBonus: prof,
			abilityMods: state.mods,
			abilityScores: state.scores,
			classLevels,
			get spellcastingMod() {
				return primaryAbility !== undefined ? state.mods[primaryAbility] : 0;
			},
			baseSpeed
		};
		// a manual play-state max (play.hp.max) wins over the computed one, as everywhere
		const hpMaxLive = (): number => character.play.hp.max ?? state.hpMax.value;
		const playVars: PlayVars = {
			hp: character.play.hp.current,
			get hpMax() {
				return hpMaxLive();
			},
			tempHp: character.play.hp.temp,
			exhaustion: character.play.exhaustion,
			flags: {
				get is_bloodied() {
					return character.play.hp.current <= hpMaxLive() / 2;
				},
				is_concentrating: character.play.concentration != null,
				is_wearing_shield: character.play.shieldRaised,
				is_wearing_armor: !!equippedArmor,
				get is_raging() {
					return state.conditions.has(RAGE_CONDITION_ID);
				}
			},
			conditions: state.conditions,
			resources: state.resources,
			resourceMax: state.resourceMax,
			armorType: armorWeightOf(equippedArmor),
			size: String(speciesRow?.type === 'species' ? speciesRow.data.size : 'medium')
		};
		const base = makeExprContext(buildVars, playVars);
		// per-class `spellcasting_mod` (SPEC4): a token carried by a class's row/feature reads THAT
		// class's casting mod (live — scores may still be resolving); anything else the primary's.
		const scoped = new Map<string, ExprContext>();
		return (eff: ActiveEffect): ExprContext => {
			const id = eff.classId;
			const ability = id !== undefined ? abilityByClass[id] : undefined;
			if (id === undefined || ability === undefined) return base;
			let c = scoped.get(id);
			if (!c) {
				c = withSpellcastingMod(base, () => state.mods[ability]);
				scoped.set(id, c);
			}
			return c;
		};
	};

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

	// B9: worn armor you lack proficiency with blocks spellcasting (RAW canonical rule-block). Grants
	// come from the character's classes; lenient — undeclared classes stay proficient with all armor.
	const armorGrants = gatherProfGrants(
		build.classes.map((c) => {
			const r = graph.get(c.class);
			return r?.type === 'class' ? r.data.armor_profs : undefined;
		})
	);
	if (
		equippedArmor &&
		!isArmorProficient(armorGrants, equippedArmor.data.item_type, equippedArmor.data.category)
	) {
		const source = String(equippedArmor.data.name_en);
		// cat is always defined here — isArmorProficient returns true (no block) on an unclassifiable armor.
		const cat = armorCategoryOf(equippedArmor.data.item_type, equippedArmor.data.category);
		spellcasting.armorBlock = {
			source,
			note: `Not proficient with ${cat} armor — spellcasting blocked`
		};
		issues.push({ source, token: 'armor_proficiency', reason: spellcasting.armorBlock.note });
	}

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
		passives: derivePassives(skills, facts),
		carryingCapacity: carryingCapacity({ strScore: scores.str, system }),
		defenses,
		resources: facts.resources,
		resourceOptions: resolveResourceOptions({
			graph,
			resourceIds: new Set(facts.resources.map((r) => r.id)),
			system,
			isActive,
			issues
		}),
		spellcasting,
		missing: [...new Set(missing)], // dedupe: the same ref can be missing from several scans (D19)
		deriveIssues: issues,
		resolvedEffects,
		facts
	};
}
