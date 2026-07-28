/*
 * B13 effect-target validation — the closed-vocabulary check `collectFacts` runs so a known-kind
 * token with an unconsumed target is surfaced (content-health) instead of folding onto nothing.
 * Split out of derive.ts; a pure leaf (skills + rules + effects vocab, no derive.ts import).
 */
import { ABILITIES } from './schema';
import { SKILL_ABILITY } from './skills';
import { EFFECT_KIND } from '../effects/token-parser';
import { didYouMean } from '../effects/suggest';
import type { TargetCheck } from '../effects/apply';

// The target keys the sheet actually consumes, per kind. Kept here (not in the effects module) because
// they are DERIVE's contract — the stats/rolls derive.ts computes; the economy-action (action/bonus/
// reaction) targets `TurnEconomy.slotMax` consumes are documented in PLUGINS.md §4.4.
const SAVE_TARGETS = ['saves', ...ABILITIES.map((a) => `save.${a}`)];
const SKILL_TARGETS = [
	'skills',
	'ability_checks', // group alias for skill checks (2014 exhaustion L1: disadvantage on ability checks)
	...Object.keys(SKILL_ABILITY).map((s) => `skill.${s}`)
];
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
export const isEffectTargetSupported = (kind: string, target: string): TargetCheck => {
	const candidates = targetCandidatesFor(kind);
	if (!candidates || candidates.has(target)) return { supported: true };
	return { supported: false, suggestion: didYouMean(target, candidates) };
};
