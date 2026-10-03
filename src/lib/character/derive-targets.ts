/*
 * B13 effect-target validation — the closed-vocabulary check `collectFacts` runs so a known-kind
 * token with an unconsumed target is surfaced (content-health) instead of folding onto nothing.
 * Split out of derive.ts; a pure leaf (skills + rules + effects vocab, no derive.ts import).
 */
import { ABILITIES } from './schema';
import { SKILL_ABILITY } from './skills';
import { EFFECT_KIND } from '../effects/token-parser';
import { ARMOR_CATEGORIES, WEAPON_CATEGORIES } from '../content/item-tags';
import { suggestClosest } from '../util/suggest';
import type { TargetCheck } from '../effects/apply';

// The target keys the sheet actually consumes, per kind. Kept here (not in the effects module) because
// they are DERIVE's contract — the stats/rolls derive.ts computes; the economy-action (action/bonus/
// reaction) targets `TurnEconomy.slotMax` consumes are documented in plugins.md §4.4.
const SAVE_TARGETS = ['saves', ...ABILITIES.map((a) => `save.${a}`)];
const SKILL_TARGETS = [
	'skills',
	'ability_checks', // group alias for skill checks (2014 exhaustion L1: disadvantage on ability checks)
	...Object.keys(SKILL_ABILITY).map((s) => `skill.${s}`),
];
/** `senses.<name>` — a sense and how far it reaches. Open by GRAMMAR, not by membership: the
 *  SRD names four (darkvision, truesight, blindsight, tremorsense) and a pack may name its own,
 *  exactly as it may name its own damage type. Two sources take the GREATER range, which is
 *  what `set_override:<t>:<n>:floor` already means, so the fold needs no new op. */
export const SENSE_PREFIX = 'senses.';
/** The one target that is not a die this character throws: what an ATTACKER rolling at them gets. */
export const INCOMING_ATTACK_TARGET = 'attacked';
const SENSE_TARGET = /^senses\.[a-z][a-z0-9_]{0,31}$/;
/** The death saving throw: a save no ability owns, so it is not one of `SAVE_TARGETS` (nothing is
 *  proficient in it), and a roll the sheet does make — Beacon of Hope's advantage lands on it. */
const DEATH_SAVE_TARGET = 'save.death';

const NUMERIC_TARGETS = new Set<string>([
	...ABILITIES,
	'ac',
	'hp_max',
	'speed',
	'speed.fly',
	'speed.swim',
	'speed.climb',
	'initiative',
	'attack',
	'attacks',
	'damage',
	'spell_dc',
	'spell_attack',
	// the lowest d20 face that can crit — LOWERED by an effect (Champion), never raised, which is why
	// the shipped tokens are `set_override:crit_threshold:<n>:cap`
	'crit_threshold',
	'action',
	'bonus',
	'reaction',
	'd20_tests',
	// passive score of ANY skill (RAW: any ability check has a passive form — passive Athletics,
	// passive Stealth…), not only the three senses the strip highlights.
	...Object.keys(SKILL_ABILITY).map((s) => `passive.${s}`),
	...SAVE_TARGETS,
	DEATH_SAVE_TARGET,
	...SKILL_TARGETS,
]);
// roll-matched kinds (advantage/disadvantage/auto_*/reroll/min_die): the keys `matchesTarget` fans
// out over — `damage` included for GWF-style `reroll:damage`.
const ROLL_TARGETS = new Set<string>([
	'attack',
	// `attacked` is the one target that is NOT your roll: it is what an attacker rolling AT you gets
	// (Cloak of Displacement). The sheet STATES it and the roller never folds it, because we do not
	// roll the monster's dice — which is exactly why it needs a channel of its own rather than a
	// scope on `attack`, where it would have landed on the dice you throw.
	'attacked',
	'damage',
	'initiative',
	'd20_tests',
	...SAVE_TARGETS,
	DEATH_SAVE_TARGET,
	...SKILL_TARGETS,
]);
// grant_proficiency canonical target (token-parser strips `skill.` → bare skill id; saves keep
// `save.`; a bare ability grants that save). Equipment carries its own prefix, because "heavy" and
// "martial" are only unambiguous next to the thing they are a category OF.
const WEAPON_PREFIX = 'weapon.';
/** A tool names a content id the same way a specific weapon does, so it is open vocabulary for the
 *  same reason: this module holds no graph, and a mistyped id is indistinguishable from a homebrew
 *  pack's own tool. */
const TOOL_PREFIX = 'tool.';
const PROFICIENCY_TARGETS = new Set<string>([
	...ABILITIES,
	'saves', // the group: proficiency in ALL saving throws (Diamond Soul)
	'skills', // the group: a rung on EVERY skill at once (Jack of All Trades' half)
	// `check.<ability>` — every check that ability makes, its BARE check and its skills alike, which
	// is how 2014 Remarkable Athlete's "any Strength, Dexterity, or Constitution check" reads. A bare
	// ability above means the SAVE, so the checks needed a prefix of their own.
	...ABILITIES.map((a) => `check.${a}`),
	...ABILITIES.map((a) => `save.${a}`),
	...Object.keys(SKILL_ABILITY),
	...ARMOR_CATEGORIES.map((c) => `armor.${c}`),
	...WEAPON_CATEGORIES.map((c) => `${WEAPON_PREFIX}${c}`),
]);

/** G4 `halve` targets — the only two stats RAW ever halves (2014 exhaustion L2 speed, L4 hp-max). */
const HALVE_TARGETS = new Set<string>(['speed', 'hp_max']);

/** A kind whose targets are NOT a closed set (damage_sensitivity's types, grant_resource's ids):
 *  there is nothing to check against, so every target passes. Named rather than `null` (NULL-1) —
 *  "no candidate set" and "no valid targets" are opposite answers and must not share a spelling. */
const OPEN_VOCAB = 'open-vocab';

/** The candidate target set a kind is checked against, or OPEN_VOCAB when it has no closed set. */
const targetCandidatesFor = (kind: string, target: string): Set<string> | typeof OPEN_VOCAB => {
	switch (kind) {
		// block_bonus blocks bonuses to a stat target (grappled → speed) — same closed vocab as sets.
		case EFFECT_KIND.flatBonus:
		case EFFECT_KIND.setOverride:
		case EFFECT_KIND.blockBonus:
			return SENSE_TARGET.test(target) ? OPEN_VOCAB : NUMERIC_TARGETS;
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
			// a SPECIFIC weapon (`weapon.warhammer` — Dwarven Combat Training) names a content id, and
			// this module holds no graph to check ids against, so the whole `weapon.` namespace is open
			// like a damage type. A mistyped category is indistinguishable from an id here — armour,
			// which has no ids, stays closed and spell-checked.
			return target.startsWith(WEAPON_PREFIX) || target.startsWith(TOOL_PREFIX)
				? OPEN_VOCAB
				: PROFICIENCY_TARGETS;
		default:
			return OPEN_VOCAB;
	}
};

/**
 * Group aliases a CONTRIBUTION may not name (plugins.md §4.4): they fan out over many stats, which is
 * a token's job — one contribution names one target.
 */
const CONTRIBUTION_GROUPS = new Set<string>([
	'saves',
	'skills',
	'ability_checks',
	'attacks',
	...ABILITIES,
]);
/** `skill.`/`passive.` take a snake-case id by GRAMMAR rather than by membership, so an unknown skill
 *  folds onto nothing exactly as a typo'd content target does (plugins.md §4.4). */
const SKILL_SCOPED_TARGET = /^(?:skill|passive)\.[a-z][a-z0-9_]{0,31}$/;

/**
 * May a plugin `contributions` key name this target (plugins.md §4.4)?
 *
 * Answered HERE, off `NUMERIC_TARGETS`, because this file owns the vocabulary. The plugin host used
 * to carry a hand-written regex copy of it and the copy drifted: eight documented keys — `speed.fly`,
 * `speed.swim`, `spell_dc`, `spell_attack`, the action-economy three, `d20_tests` and any passive but
 * the three senses — were rejected, and a rejected key takes the whole result down with it, tokens
 * and notes included.
 */
export const isPluginContributionTarget = (key: string): boolean =>
	SKILL_SCOPED_TARGET.test(key) ||
	SENSE_TARGET.test(key) ||
	(NUMERIC_TARGETS.has(key) && !CONTRIBUTION_GROUPS.has(key));

/** B13 validator handed to collectFacts: is this (kind, target) pair consumed by some stat/roll?
 *  Open-vocab kinds (damage_sensitivity, grant_resource, apply_condition) are always supported —
 *  validated elsewhere or unbounded. An unsupported target carries a PLG-9 "did you mean?" suffix. */
export const isEffectTargetSupported = (kind: string, target: string): TargetCheck => {
	const candidates = targetCandidatesFor(kind, target);
	if (candidates === OPEN_VOCAB || candidates.has(target)) return { supported: true };
	const options = suggestClosest(target, candidates);
	return { supported: false, ...(options.length ? { options } : {}) };
};
