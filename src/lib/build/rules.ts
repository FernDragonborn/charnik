/*
 * Pure character-creation math — point-buy, standard array, and the ability-boost allocation
 * (5.5e background / 5e species). No Svelte, no content graph: just numbers and rules, so it's
 * unit-testable. The Build VM drives these; the components render the result.
 *
 * Both editions share the same 27-point buy (scores 8–15 before boosts). The divergence the
 * app cares about is WHERE the ability boost sits: 5.5e puts it on the background, 5e on the
 * species (see docs/PLAN.md). Species boosts flow through the effects engine automatically;
 * the background boost (5.5e) is a build-time choice, allocated here into `abilityBoosts`.
 */
import type { Ability } from '../rules/core';
import { ABILITIES } from '../character/schema';
import type { SystemId } from '../stores/app.svelte';

export type StatMethod = 'point_buy' | 'standard_array' | 'manual';

/** 5e/5.5e point-buy: cost of raising a score from 8 to N (8–15). */
const POINT_BUY_COST: Record<number, number> = {
	8: 0,
	9: 1,
	10: 2,
	11: 3,
	12: 4,
	13: 5,
	14: 7,
	15: 9
};

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/** Cost of a single score under point-buy (0 outside the 8–15 band → treated as free/manual). */
export function pointBuyCost(score: number): number {
	return POINT_BUY_COST[score] ?? 0;
}

/** Total points spent on a full ability set under point-buy. */
export function pointsSpent(abilities: Record<Ability, number>): number {
	return ABILITIES.reduce((sum, ab) => sum + pointBuyCost(abilities[ab]), 0);
}

/** Points remaining (budget − spent); can go negative if a caller over-allocates. */
export function pointsRemaining(abilities: Record<Ability, number>): number {
	return POINT_BUY_BUDGET - pointsSpent(abilities);
}

/** Can this score be raised by one step under point-buy without breaking cap or budget? */
export function canRaise(abilities: Record<Ability, number>, ab: Ability): boolean {
	const next = abilities[ab] + 1;
	if (next > POINT_BUY_MAX) return false;
	const delta = pointBuyCost(next) - pointBuyCost(abilities[ab]);
	return pointsRemaining(abilities) - delta >= 0;
}

/** Can this score be lowered by one step under point-buy (floor 8)? */
export function canLower(abilities: Record<Ability, number>, ab: Ability): boolean {
	return abilities[ab] - 1 >= POINT_BUY_MIN;
}

/** Which entity carries the primary ability boost in a given system. */
export function boostCarrier(system: SystemId): 'background' | 'species' {
	return system === '5.5e' ? 'background' : 'species';
}

/** The two 5.5e background boost shapes, over the three abilities the background offers. */
export type BoostShape = '2-1' | '1-1-1';

/**
 * Allocate a 5.5e background ability boost into an `abilityBoosts` record.
 *  - shape '2-1': +2 to `picks[0]`, +1 to `picks[1]`
 *  - shape '1-1-1': +1 to each of the three `picks`
 * `choices` is the background's offered ability list; picks must be a subset of it.
 */
export function allocateBackgroundBoost(
	shape: BoostShape,
	picks: Ability[],
	choices: Ability[]
): Partial<Record<Ability, number>> {
	const valid = picks.filter((a) => choices.includes(a));
	const out: Partial<Record<Ability, number>> = {};
	if (shape === '2-1') {
		if (valid[0]) out[valid[0]] = 2;
		if (valid[1] && valid[1] !== valid[0]) out[valid[1]] = 1;
	} else {
		for (const a of valid.slice(0, 3)) out[a] = (out[a] ?? 0) + 1;
	}
	return out;
}

/** How many abilities a background-boost shape asks the user to pick (2-1 → 2, 1-1-1 → 3). */
export function boostPickCount(shape: BoostShape): number {
	return shape === '2-1' ? 2 : 3;
}

/**
 * The ASI-or-feat-slot levels a class grants up to `level`. `asiLevels` is the class's own
 * progression (the `asi_levels` content column, derived from the SRD by the converters — e.g.
 * Fighter 4,6,8,12,14,16,19; Rogue 4,8,10,12,16,19; most classes 4,8,12,16,19). Data-driven, NOT a
 * class-name switch. Falls back to the common progression when a (homebrew) class omits the column.
 * Lenient: this drives the *count* of feat slots, it doesn't hard-gate anything.
 */
export function asiFeatLevels(level: number, asiLevels?: readonly number[]): number[] {
	const levels = asiLevels && asiLevels.length ? asiLevels : [4, 8, 12, 16, 19];
	return [...levels].filter((l) => l <= level).sort((a, b) => a - b);
}

/** A blank ability set at the point-buy floor (all 8). */
export function baseAbilities(): Record<Ability, number> {
	return Object.fromEntries(ABILITIES.map((a) => [a, POINT_BUY_MIN])) as Record<Ability, number>;
}
