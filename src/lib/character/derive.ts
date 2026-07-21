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
import { ABILITIES } from './schema';
import {
	abilityModifier,
	proficiencyBonus,
	savingThrow,
	skillCheck,
	passiveScore,
	initiative as initiativeOf,
	unarmoredAC,
	armoredAC,
	maxHpForClass,
	carryingCapacity,
	ABILITY_SCORE_CLAMP,
	type Ability
} from '../rules/core';
import {
	EFFECT_KIND,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue
} from '../effects/token-parser';
import {
	applyEffects,
	collectFacts,
	mergeFacts,
	matchesTarget,
	type EffectFacts,
	type ResourceDef,
	type TargetCheck
} from '../effects/apply';
import { didYouMean } from '../effects/suggest';
import { expandPluginEffects, type PluginCtx } from '../effects/plugin-registry';
import {
	resolveActiveEffects,
	RAGE_CONDITION_ID,
	type ResolveState
} from '../effects/dependency-graph';
import { deriveSpellcasting, castingAbilityByClass, type Spellcasting } from './spellcasting';
import {
	makeExprContext,
	withSpellcastingMod,
	type BuildVars,
	type PlayVars
} from '../effects/context';
import type { ExprContext } from '../effects/expression-evaluator';
import {
	computed,
	type Computed,
	type Contribution,
	type Layer,
	type System
} from '../rules/pipeline';

/** Skill → its governing ability (the 18 SRD skills). */
// `as const satisfies` so the KEYS form the `SkillId` union (not widened to `string`) while the
// values are still checked to be `Ability`. This lets the skills map be keyed by `SkillId`, so
// indexing it with a known skill id is sound (no `T | undefined`, no non-null assertions).
export const SKILL_ABILITY = {
	acrobatics: 'dex',
	animal_handling: 'wis',
	arcana: 'int',
	athletics: 'str',
	deception: 'cha',
	history: 'int',
	insight: 'wis',
	intimidation: 'cha',
	investigation: 'int',
	medicine: 'wis',
	nature: 'int',
	perception: 'wis',
	performance: 'cha',
	persuasion: 'cha',
	religion: 'int',
	sleight_of_hand: 'dex',
	stealth: 'dex',
	survival: 'wis'
} as const satisfies Record<string, Ability>;

/** The 18 SRD skill ids. */
export type SkillId = keyof typeof SKILL_ABILITY;

// B13 exhaustiveness — the CLOSED-vocab targets each effect kind's consumer actually reads. derive
// IS the authority (it makes every applyEffects/rollEffectsFor call), so it owns these sets and
// hands a validator to collectFacts; a known-kind token outside them is surfaced as a content-health
// issue instead of folding onto nothing (`flat_bonus:armorclass+1` no longer vanishes). Kept as a
// permissive SUPERSET: a false negative (a rare bogus target slips through) is far better than a
// false positive (flagging a real target scares authors). action/bonus/reaction are the economy
// targets `TurnEconomy.slotMax` consumes (now documented in PLUGINS.md §4.4).
const SAVE_TARGETS = ['saves', ...ABILITIES.map((a) => `save.${a}`)];
const SKILL_TARGETS = ['skills', ...Object.keys(SKILL_ABILITY).map((s) => `skill.${s}`)];
const NUMERIC_TARGETS = new Set<string>([
	...ABILITIES,
	'ac',
	'hp_max',
	'speed',
	'speed.fly',
	'speed.swim',
	'initiative',
	'attack',
	'damage',
	'spell_dc',
	'spell_attack',
	'action',
	'bonus',
	'reaction',
	'd20_tests',
	// passive score of ANY skill (RAW: any ability check has a passive form — passive Athletics,
	// passive Stealth…), not only the three senses the strip highlights.
	...Object.keys(SKILL_ABILITY).map((s) => `passive.${s}`),
	...SAVE_TARGETS,
	...SKILL_TARGETS
]);
// roll-matched kinds (advantage/disadvantage/auto_*/reroll/min_die): the keys `matchesTarget` fans
// out over — `damage` included for GWF-style `reroll:damage`.
const ROLL_TARGETS = new Set<string>([
	'attack',
	'damage',
	'initiative',
	'd20_tests',
	...SAVE_TARGETS,
	...SKILL_TARGETS
]);
// grant_proficiency canonical target (token-parser strips `skill.` → bare skill id; saves keep
// `save.`; a bare ability grants that save).
const PROFICIENCY_TARGETS = new Set<string>([
	...ABILITIES,
	...ABILITIES.map((a) => `save.${a}`),
	...Object.keys(SKILL_ABILITY)
]);

/** G4 `halve` targets — the only two stats RAW ever halves (2014 exhaustion L2 speed, L4 hp-max). */
const HALVE_TARGETS = new Set<string>(['speed', 'hp_max']);

/** The candidate target set a kind is checked against, or null for an open-vocab kind. */
const targetCandidatesFor = (kind: string): Set<string> | null => {
	switch (kind) {
		// block_bonus blocks bonuses to a stat target (grappled → speed) — same closed vocab as sets.
		case EFFECT_KIND.flatBonus:
		case EFFECT_KIND.setOverride:
		case EFFECT_KIND.blockBonus:
			return NUMERIC_TARGETS;
		// halve (2014 exhaustion) only ever multiplies speed or hp_max — a tighter closed set.
		case EFFECT_KIND.halve:
			return HALVE_TARGETS;
		case EFFECT_KIND.advantage:
		case EFFECT_KIND.disadvantage:
		case EFFECT_KIND.autoFail:
		case EFFECT_KIND.autoSucceed:
		case EFFECT_KIND.reroll:
		case EFFECT_KIND.minDie:
			return ROLL_TARGETS;
		case EFFECT_KIND.grantProficiency:
			return PROFICIENCY_TARGETS;
		default:
			return null;
	}
};

/** B13 validator handed to collectFacts: is this (kind, target) pair consumed by some stat/roll?
 *  Open-vocab kinds (resist_immune, grant_resource, apply_condition) are always supported —
 *  validated elsewhere or unbounded. An unsupported target carries a PLG-9 "did you mean?" suffix. */
const isEffectTargetSupported = (kind: string, target: string): TargetCheck => {
	const candidates = targetCandidatesFor(kind);
	if (!candidates || candidates.has(target)) return { supported: true };
	return { supported: false, suggestion: didYouMean(target, candidates) };
};

/** Skill proficiency level (a level, not two booleans): none → half (Jack of All Trades) →
 *  proficient → expertise (×2). */
type SkillProficiency = 'none' | 'half' | 'proficient' | 'expertise';
const PROF_ORDER: Record<SkillProficiency, number> = {
	none: 0,
	half: 1,
	proficient: 2,
	expertise: 3
};
/** The higher rung of the proficiency ladder — sources combine by MAX, never by flag-union, so
 *  "expertise without proficiency" is unrepresentable. */
const maxProf = (a: SkillProficiency, b: SkillProficiency): SkillProficiency =>
	PROF_ORDER[a] >= PROF_ORDER[b] ? a : b;

interface AbilityBlock {
	/** The effective score — traced + clamped through the pipeline (A10), explainable on hover. */
	score: Computed;
	baseScore: number;
	mod: number;
	save: Computed;
}

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

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);

/** Gather every active effect (species/items/runtime) as {source, layer, tokens}. */
function gatherEffects(
	character: Character,
	graph: ContentGraph,
	missing: string[],
	isActive: (row: LoadedRow) => boolean
): ActiveEffect[] {
	const active: ActiveEffect[] = [];
	// B15: a row whose file/source is disabled, or which lost a collision, is treated exactly like a
	// missing ref — rendered as unresolved + flagged, never silently applied and never a crash.
	const resolve = (ref: string | undefined) => {
		if (!ref) return undefined;
		const row = graph.get(ref);
		if (!row || !isActive(row)) {
			missing.push(ref);
			return undefined;
		}
		return row;
	};
	/** Push a row's tokens as one active effect (skipping token-less rows). `classId` marks
	 *  class-borne effects so their `spellcasting_mod` reads THAT class's mod (SPEC4). */
	const pushRow = (row: LoadedRow | undefined, layer: Layer, classId?: string): void => {
		const tokens = tokensOf(row);
		if (!row || !tokens.length) return;
		active.push({
			source: String(row.data.name_en),
			layer,
			tokens,
			...(classId !== undefined ? { classId } : {})
		});
	};

	pushRow(resolve(character.build.species), 'feature');
	// species sub-option (subrace / lineage) — its ASI + traits cascade like the species' own
	pushRow(resolve(character.build.speciesOption), 'feature');
	pushRow(resolve(character.build.background), 'feature');

	// class + subclass: the class row's own tokens, its base features up to the class level, the
	// chosen subclass row, and that subclass's features (same level gate). Features are matched by
	// class_id within the CLASS ROW'S source + the character's edition, so a 5e and a 5.5e feature
	// table for the same class can coexist without double-applying.
	for (const entry of character.build.classes) {
		const classRow = resolve(entry.class);
		pushRow(classRow, 'feature', classRow?.id);
		const subclassRow = resolve(entry.subclass);
		pushRow(subclassRow, 'feature', classRow?.id);
		if (!classRow) continue;
		for (const f of graph.rows) {
			if (f.type !== 'class_feature' || f.source !== classRow.source) continue;
			if (f.data.class_id !== classRow.id || Number(f.data.level) > entry.level) continue;
			if (!f.systems.includes(character.system)) continue;
			if (!isActive(f)) continue; // B15: a disabled/collision-lost feature row doesn't apply
			// base feature (no subclass_id) always applies; a subclass feature only for the chosen one
			const forSubclass = f.data.subclass_id;
			if (forSubclass && forSubclass !== (subclassRow?.type === 'subclass' ? subclassRow.id : ''))
				continue;
			pushRow(f, 'feature', classRow.id);
		}
	}

	// feats (incl. repeatable ones taken more than once → their effect applies each time)
	for (const featRef of character.build.feats) pushRow(resolve(featRef), 'feature');

	for (const inv of character.build.inventory) {
		if (!inv.equipped && !inv.attuned) continue;
		pushRow(resolve(inv.item), 'item');
	}

	for (const eff of character.play.effects) {
		// B17: prefer the LIVE catalog row when the instance carries a ref (`source`) — so a fix to the
		// catalog row PROPAGATES and the name re-localizes. Fall back to the baked `effects`/`label` for
		// a catalog-less custom effect OR an orphaned ref (row deleted / disabled); an orphan is flagged
		// like any missing ref (still applied from the bake, never silently dropped).
		const live = eff.source ? graph.get(eff.source) : undefined;
		const liveActive = live !== undefined && isActive(live);
		if (eff.source && !liveActive) missing.push(eff.source);
		const tokens = liveActive ? tokensOf(live) : eff.effects;
		const label = liveActive ? String(live.data.name_en) : eff.label;
		if (tokens.length) active.push({ source: label, layer: 'condition', tokens });
	}
	// NOTE: guard evaluation + `apply_condition` expansion happen in the ONE resolve stage
	// (`resolveActiveEffects`, effects/dependency-graph.ts) — in DEPENDENCY order, so guards gate a token BEFORE
	// its condition is expanded (SPEC7) and every consumer reads the same resolved list.
	return active;
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
	const system = character.system as System;
	const missing: string[] = [];
	const issues: EffectIssue[] = [];
	// effects-auto global toggle: off → no effect layers (base stats / text only)
	const active = character.play.autoCalc ? gatherEffects(character, graph, missing, isActive) : [];

	const level = build.classes.reduce((n, c) => n + c.level, 0) || 1;
	const prof = proficiencyBonus(level);

	// A10 seeds: the score fold starts from the base score + allocated boosts, as traced contributions
	const abilityBase = {} as Record<Ability, Contribution[]>;
	for (const ab of ABILITIES) {
		const contribs: Contribution[] = [
			{ source: 'Base score', layer: 'base', op: 'add', amount: build.abilities[ab] }
		];
		const boost = build.abilityBoosts?.[ab] ?? 0;
		if (boost) contribs.push({ source: 'Ability boosts', layer: 'base', op: 'add', amount: boost });
		abilityBase[ab] = contribs;
	}

	// class levels keyed by BARE id (`class_level.monk`)
	const classLevels: Record<string, number> = {};
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (row) classLevels[row.id] = (classLevels[row.id] ?? 0) + c.level;
	}
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
	let primaryAbility: Ability | undefined;
	let primaryLevel = -1;
	for (const [cid, ab] of Object.entries(abilityByClass)) {
		const lvl = classLevels[cid] ?? 0;
		if (lvl > primaryLevel) {
			primaryLevel = lvl;
			primaryAbility = ab;
		}
	}

	const expandCondition = (condId: string) => {
		// A16(a): edition-filter the lookup — a 5.5e `frightened` row must NOT apply to a 5e character
		// when both roots are loaded, exactly the `systems` gate the class-feature scan above uses.
		// A16(b): first match is now deterministic within the edition (load order); a genuine
		// same-id/same-edition clash across two sources is a collisions.json concern, not resolved here.
		const cond = graph.rows.find(
			(r) => r.type === 'condition' && r.id === condId && r.systems.includes(character.system)
		);
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

	// L3 plugin PRE-PASS (docs/PLUGINS.md; stage 2½ — between resolve and the fold): resolve every
	// `plugin:` token against the registry over the §4.2 least-data ctx. Returned TOKENS become
	// synthetic effects merged through a second collectFacts (same parser/rules as content);
	// CONTRIBUTIONS fold as host-stamped numeric facts. No plugin tokens / no registry → null,
	// and the sheet computes exactly as before (removability invariant).
	// `api: 1` limits (documented): the ctx's hpMax and a returned `apply_condition`'s sub-token
	// expansion both read the PRE-plugin state — plugins cannot feed the condition DAG.
	if (character.play.autoCalc && resolvedEffects.length) {
		const preHpMax = character.play.hp.max ?? applyEffects('hp_max', maxHpBase, facts).value;
		const pluginCtx: PluginCtx = {
			api: 1,
			build: {
				system: character.system,
				level,
				classLevels,
				proficiencyBonus: prof,
				abilities: Object.fromEntries(
					ABILITIES.map((ab) => [ab, { score: scores[ab], mod: abilityModifier(scores[ab]) }])
				) as Record<Ability, { score: number; mod: number }>
			},
			play: {
				hp: character.play.hp.current,
				hpMax: preHpMax,
				tempHp: character.play.hp.temp,
				flags: {
					isBloodied: character.play.hp.current <= preHpMax / 2,
					isRaging: facts.conditions.includes(RAGE_CONDITION_ID),
					isConcentrating: character.play.concentration != null
				},
				conditions: facts.conditions,
				resources: Object.fromEntries(
					facts.resources.map((r) => {
						// own-or-zero: the id is content-controlled (`constructor` parses fine) — a bare
						// index would read an inherited Object.prototype member (same guard as context.ts)
						const spent = Object.hasOwn(character.play.resourcesSpent, r.id)
							? (character.play.resourcesSpent[r.id] ?? 0)
							: 0;
						return [r.id, Math.max(0, r.max - spent)];
					})
				)
			}
		};
		// scope = character id: the fail-closed counter is per (plugin, character), so one
		// character's ctx can't disable a plugin for another (PLG-3)
		const expansion = expandPluginEffects(resolvedEffects, pluginCtx, issues, character.id);
		if (expansion) {
			const condsBefore = new Set(facts.conditions);
			if (expansion.syntheticEffects.length)
				mergeFacts(
					facts,
					collectFacts(expansion.syntheticEffects, effCtx, issues, isEffectTargetSupported)
				);
			facts.numeric.push(...expansion.numeric);
			facts.pluginNotes.push(...expansion.notes);
			facts.unknown.push(...expansion.unknown);
			// a plugin-granted `apply_condition` expands ONE level here (PLUGINS.md §4.3): the
			// condition's own stat tokens DO apply — only guard/DAG participation stays out of
			// reach (the resolve stage already ran). A condition already active pre-plugin was
			// expanded by the resolve stage; skip it (the A11 once-per-id rule).
			const grantedConds = facts.conditions.filter((id) => !condsBefore.has(id));
			if (grantedConds.length) {
				const condEffects: ActiveEffect[] = [];
				for (const id of grantedConds) {
					const cond = expandCondition(id);
					if (cond)
						condEffects.push({ source: cond.source, layer: 'condition', tokens: cond.tokens });
				}
				if (condEffects.length)
					mergeFacts(facts, collectFacts(condEffects, effCtx, issues, isEffectTargetSupported));
			}
		}
	}

	// A4: armor with the stealth-disadvantage flag imposes disadvantage on Stealth. Synthesized as a
	// disadvantage FACT (the vocab exists since EFX-1) so it reaches BOTH the skill.stealth hover note
	// (applyEffects below) AND the actual Hide/Stealth roll (rollEffectsFor reads facts.disadvantage),
	// not just the item card. Deduped by (target, source) like a real token would be (A11).
	if (equippedArmor?.data.stealth_disadvantage) {
		const source = String(equippedArmor.data.name_en);
		if (!facts.disadvantage.some((d) => d.target === 'skill.stealth' && d.source === source))
			facts.disadvantage.push({ target: 'skill.stealth', source });
	}

	// A16: an `apply_condition:<id>` referencing a condition that has no row in the active edition
	// otherwise applies a PHANTOM condition silently (a typo'd id sets a flag that never matches).
	// Surface it as a content-health issue. A real, edition-matched condition with an EMPTY effects
	// column is legitimate (many SRD conditions) — checked by row existence, not by expandCondition
	// (which also returns undefined for token-less rows). Guard/expansion ordering is already handled
	// by the resolve stage (A16 e / SPEC7); edition-filter + once-per-id by expandCondition (A16 a/c).
	const conditionIds = new Set(
		graph.rows
			.filter((r) => r.type === 'condition' && r.systems.includes(character.system))
			.map((r) => r.id)
	);
	for (const id of facts.conditions)
		if (!conditionIds.has(id) && id !== RAGE_CONDITION_ID)
			issues.push({
				source: 'apply_condition',
				token: `apply_condition:${id}`,
				reason: `unknown condition "${id}"${didYouMean(id, conditionIds)}` // PLG-9
			});

	// spellcasting AFTER the resolve, so DCs/attacks read the EFFECTIVE scores (a Headband of
	// Intellect moves the wizard's DC, as it should) — and `spell_dc`/`spell_attack` effects fold in.
	const spellcasting = deriveSpellcasting(character, graph, scores, facts);

	// proficiencies granted by effects (item/feat/feature): `grant_proficiency:[expertise:]<target>`
	// where target is a save (`con` / `save.con`) or a skill id (`stealth` — the parser already
	// stripped any `skill.` prefix). Skills collect the granted LEVEL (max of the ladder); saves are
	// proficient-or-not (expertise doesn't apply to saves — a granted 'expertise' still just means
	// proficient there).
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Map<string, SkillProficiency>();
	for (const p of facts.proficiencies) {
		const tgt = p.target.replace(/^save\./, '');
		if ((ABILITIES as readonly string[]).includes(tgt)) grantedSaves.add(tgt as Ability);
		else grantedSkills.set(p.target, maxProf(grantedSkills.get(p.target) ?? 'none', p.level));
	}

	// saves: proficient if the ability is in build.saves, effect-granted, or from the STARTING class.
	// Multiclass RAW grants save proficiencies from the FIRST class ONLY — NOT every class (A8); the
	// loop still resolves each class row so missing refs are flagged, but only classes[0] adds saves.
	const classSaves = new Set<Ability>([...(build.saves as Ability[]), ...grantedSaves]);
	build.classes.forEach((c, i) => {
		const row = graph.get(c.class);
		if (!row) {
			missing.push(c.class);
			return;
		}
		if (i === 0 && row.type === 'class' && Array.isArray(row.data.saves))
			for (const a of row.data.saves as Ability[]) classSaves.add(a);
	});

	const abilities = {} as Record<Ability, AbilityBlock>;
	for (const ab of ABILITIES) {
		const base = savingThrow({
			ability: ab,
			score: scores[ab],
			level,
			proficient: classSaves.has(ab)
		});
		abilities[ab] = {
			score: abilityComputed[ab],
			baseScore: build.abilities[ab],
			mod: abilityModifier(scores[ab]),
			save: applyEffects(`save.${ab}`, base, facts)
		};
	}

	// skills: the BUILD's chosen level (expertise requires the chosen proficiency — Rogue/Bard)
	// combines with the effect-granted level by MAX on the one ladder; the math flags derive from
	// that single level, so no boolean combination can express an invalid state.
	const chosenProf = new Set(build.skills);
	const chosenExpert = new Set(build.expertise ?? []);
	const skills = {} as Record<SkillId, Computed & { prof: SkillProficiency }>;
	for (const [skill, ab] of Object.entries(SKILL_ABILITY) as [SkillId, Ability][]) {
		const chosen: SkillProficiency = chosenProf.has(skill)
			? chosenExpert.has(skill)
				? 'expertise'
				: 'proficient'
			: 'none';
		const profLevel = maxProf(chosen, grantedSkills.get(skill) ?? 'none');
		const base = skillCheck({
			ability: ab,
			score: scores[ab],
			level,
			proficient: profLevel === 'proficient',
			expertise: profLevel === 'expertise',
			halfProficient: profLevel === 'half'
		});
		skills[skill] = {
			...applyEffects(`skill.${skill}`, base, facts),
			prof: profLevel
		};
	}

	// AC: equipped armor (found above for the armor_type guard) + shield, else unarmored; then effects
	let acBase: Computed;
	if (equippedArmor) {
		const capRaw = equippedArmor.data.armor_dex_cap;
		const dexCap = capRaw === '' || capRaw == null ? null : num(capRaw);
		acBase = armoredAC({ armorBaseAc: num(equippedArmor.data.ac), dexScore: scores.dex, dexCap });
	} else {
		acBase = unarmoredAC({ dexScore: scores.dex });
	}
	// shield = the play-state raised flag (the dedicated combat toggle), the single source for its
	// +2 — not the inventory equipped flag (which just says the character owns/wears one)
	if (character.play.shieldRaised)
		acBase = {
			...acBase,
			value: acBase.value + 2,
			trace: [...acBase.trace, { source: 'Shield', layer: 'item', op: 'add', amount: 2 }]
		};
	const ac = applyEffects('ac', acBase, facts);

	// HP: the base fold came out of the resolve stage (recomputed at the final CON); hp_max flows
	// through the seam like every other stat (Toughness, Aid → `flat_bonus:hp_max+N`).
	const maxHp = applyEffects('hp_max', maxHpBase, facts);

	// speed from species (base_speed, computed above for the expr ctx). A3: armor whose STR
	// requirement (`str_min`) exceeds the wearer's STR drops speed by 10 ft (RAW, both editions) —
	// folded as an item-layer contribution so it's traced/explained, then effects layer on top.
	const speedBase: Contribution[] = [
		{
			source: speciesRow ? String(speciesRow.data.name_en) : 'Default',
			layer: 'base',
			op: 'add',
			amount: baseSpeed
		}
	];
	const armorStrMin = equippedArmor ? num(equippedArmor.data.str_min) : 0;
	if (armorStrMin > 0 && scores.str < armorStrMin)
		speedBase.push({
			source: `${String(equippedArmor?.data.name_en)} (STR ${armorStrMin})`,
			layer: 'item',
			op: 'add',
			amount: -10,
			note: `STR ${scores.str} < ${armorStrMin}`
		});
	const speed = applyEffects('speed', computed(speedBase, { min: 0 }), facts);
	// fly/swim: no SRD species grants a base, so the fold starts at 0 and effects are the source
	const movementOf = (key: 'speed.fly' | 'speed.swim') =>
		applyEffects(key, computed([], { min: 0 }), facts);

	// passive score of every skill — RAW any ability check has a passive form (passive Athletics,
	// passive Stealth…), and the play view lets the user pin ANY skill as a passive sense, so
	// `passive.<skill>` (Observant, an item bonus) must resolve for all 18, not just the three senses.
	const passiveOf = (skill: SkillId) => {
		// advantage/disadvantage on the underlying check moves the passive by ±5 (both → cancel, RAW);
		// then `passive.<skill>`-targeted effects (Observant) fold in through the seam.
		const adv = facts.advantage.some((a) => matchesTarget(a.target, `skill.${skill}`));
		const dis = facts.disadvantage.some((d) => matchesTarget(d.target, `skill.${skill}`));
		let base = passiveScore(skills[skill]);
		if (adv !== dis)
			base = {
				...base,
				value: base.value + (adv ? 5 : -5),
				trace: [
					...base.trace,
					{
						source: adv ? 'Advantage' : 'Disadvantage',
						layer: 'condition',
						op: 'add',
						amount: adv ? 5 : -5
					}
				]
			};
		return applyEffects(`passive.${skill}`, base, facts);
	};

	// damage defenses from effects: `resist_immune:<resist|immune|vulnerable>:<type>` (a bare
	// `resist_immune:<type>` defaults to resistance).
	const defenses = { resist: [] as string[], immune: [] as string[], vulnerable: [] as string[] };
	for (const d of facts.defenses)
		if (!defenses[d.bucket].includes(d.type)) defenses[d.bucket].push(d.type);

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
		passives: Object.fromEntries(
			(Object.keys(SKILL_ABILITY) as SkillId[]).map((k) => [k, passiveOf(k)])
		) as Record<SkillId, Computed>,
		carryingCapacity: carryingCapacity({ strScore: scores.str, system }),
		defenses,
		resources: facts.resources,
		spellcasting,
		missing: [...new Set(missing)], // dedupe: the same ref can be missing from several scans (D19)
		deriveIssues: issues,
		resolvedEffects,
		facts
	};
}
