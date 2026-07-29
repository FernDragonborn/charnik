/*
 * The typed-facts CONTRACT for the L1 effect seam. `EffectFacts` (AUDIT D7) is the one object every
 * derive builds once and every consumer reads — stat folds, the roll path, proficiency/defense/
 * resource scans, the action economy. The fact types + the `emptyFacts` seed + `matchesTarget` (the
 * target-fan-out predicate) live here as a leaf so both the collector (apply.ts) and any consumer can
 * import them without a cycle. `collectFacts` / `applyEffects` (the seam functions) stay in apply.ts.
 */
import type { Layer } from '../rules/pipeline';
import type { Defense, Recharge } from './token-parser';

/** Does an effect target apply to this stat key? Exact, plus the group targets that fan out:
 *  `saves`→`save.*`, `skills`/`ability_checks`→`skill.*` (the ability checks the sheet models —
 *  2014 exhaustion L1 rides `ability_checks`), and `d20_tests`→every d20-based roll (saves, ability
 *  checks/skills, attack, initiative) — the 2024 exhaustion penalty rides this one group. */
export function matchesTarget(effTarget: string | undefined, key: string): boolean {
	if (!effTarget) return false;
	if (effTarget === key) return true;
	if (effTarget === 'saves' && key.startsWith('save')) return true;
	if ((effTarget === 'skills' || effTarget === 'ability_checks') && key.startsWith('skill'))
		return true;
	if (
		effTarget === 'd20_tests' &&
		(key.startsWith('save') || key.startsWith('skill') || key === 'attack' || key === 'initiative')
	)
		return true;
	return false;
}

/** Result of the derive's target check (B13): whether a consumer reads this (kind, target), plus an
 *  optional "did you mean X?" suffix (PLG-9) when it's unsupported but near a known key. */
export interface TargetCheck {
	supported: boolean;
	/** Ready-to-append suffix like ` — did you mean "ac"?`, or absent. */
	suggestion?: string;
}

/** Predicate the derive supplies (B13): does a consumer actually read this (kind, target) pair?
 *  Only CLOSED-vocab targets are checked (stat/roll/proficiency keys); open-vocab kinds
 *  (resist_immune types, grant_resource / apply_condition ids) are validated elsewhere or unbounded,
 *  so the validator returns `supported: true` for them. `kind` is an `EFFECT_KIND` value. */
export type TargetValidator = (kind: string, target: string) => TargetCheck;

/** A roll-manipulation fact for the roll path: `{target, value}` where value is the reroll
 *  threshold (`reroll`) or the die floor (`min_die`). */
export interface RollMod {
	target: string;
	value: number;
}

/** A resolved numeric token (`flat_bonus`/`set_override`) — its L2 expression already evaluated
 *  against the derive ctx, so every consumer folds a NUMBER (or rides a dice formula), never
 *  re-parses/re-evaluates. Exactly one of `amount`/`diceFormula`/`error` is set. */
export interface NumericFact {
	target: string;
	/** `add`/`set` from flat_bonus/set_override; `floor`/`cap` from set_override's mode slot (A9);
	 *  `mult` from `halve` (G4, ×½) and plugin `contributions` (PLUGINS.md §4.3). */
	op: 'add' | 'set' | 'mult' | 'floor' | 'cap';
	layer: Layer;
	source: string;
	/** The guard-stripped token, for provenance notes. */
	token: string;
	amount?: number;
	/** A dice quantity (`1d4`, `-2d6`) — rides the roll path; folds as a note on stats. */
	diceFormula?: string;
	/** The value failed to resolve — the token degrades to a note (the inert-fallback contract). */
	error?: string;
}
/** A non-numeric fact tied to a target key (`advantage:attack` → {target:'attack', source}). */
export interface FactRef {
	target: string;
	source: string;
}
interface ProficiencyFact {
	target: string;
	level: 'proficient' | 'expertise';
	source: string;
}
/** A feature-granted named rollable (EFX-ROLL): `grant_roll:<id>:<expr>` with the L2 expression
 *  already resolved to a dice `formula` string, ready to hand to the DiceTrayRequest seam. */
interface RollFact {
	id: string;
	source: string;
	label: string;
	formula: string;
}
interface DefenseFact {
	bucket: Defense;
	type: string;
	source: string;
}

/** A trackable resource pool a feature/effect grants (rage, ki, sorcery points, an item's N/day…). */
export interface ResourceDef {
	id: string;
	name: string; // display label (title-cased from id)
	max: number;
	recharge: Recharge;
	source: string; // the granting effect/feature
}

/**
 * The ONE typed-facts object (AUDIT D7): every token of the resolved effect list, parsed once and
 * value-resolved once per derive. Every downstream consumer — stat folds (`applyEffects`), the
 * roll path (`rollEffectsFor`), proficiency/defense/resource scans, the action economy — reads
 * THIS, never its own re-scan of raw tokens.
 */
export interface EffectFacts {
	numeric: NumericFact[];
	/** `block_bonus:<target>` facts (A9): while active, effect-borne POSITIVE bonuses to the target
	 *  are dropped (grappled/restrained "can't benefit from any bonus to its speed"). */
	blockedBonuses: FactRef[];
	advantage: FactRef[];
	disadvantage: FactRef[];
	/** Rolls whose OUTCOME is forced (paralyzed → auto-fail STR/DEX saves): the target roll fails
	 *  (`autoFail`) or succeeds (`autoSucceed`) regardless of the die. Consumed as a save note + the
	 *  roll-outcome check (combat), NOT as a die modifier — so it never mixes with advantage math. */
	autoFail: FactRef[];
	autoSucceed: FactRef[];
	proficiencies: ProficiencyFact[];
	defenses: DefenseFact[];
	/** Feature-granted named rollables (`grant_roll`), expr resolved to a dice formula (EFX-ROLL). */
	rolls: RollFact[];
	/** Fully-specified resource pools (id:max:recharge), expression maxes resolved. */
	resources: ResourceDef[];
	/** Every granted resource id, incl. bare `grant_resource:<id>` flags (deduped). */
	resourceIds: string[];
	/** Applied condition ids (deduped). */
	conditions: string[];
	rerolls: RollMod[];
	minDie: RollMod[];
	unknown: { source: string; token: string }[];
	/** Plain-text notes returned by plugin handlers (PLUGINS.md §4.3) — panel display only,
	 *  rendered as TEXT (PLG-SEC 3). Filled by the plugin pre-pass, empty otherwise. */
	pluginNotes: { source: string; text: string }[];
}

export const emptyFacts = (): EffectFacts => ({
	numeric: [],
	blockedBonuses: [],
	advantage: [],
	disadvantage: [],
	autoFail: [],
	autoSucceed: [],
	proficiencies: [],
	defenses: [],
	rolls: [],
	resources: [],
	resourceIds: [],
	conditions: [],
	rerolls: [],
	minDie: [],
	unknown: [],
	pluginNotes: []
});
