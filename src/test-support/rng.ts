/*
 * Deterministic randomness for tests. Its own module, not part of `fixtures.ts`, so a rules-core test
 * can take it without dragging the content loader in behind it.
 */
import type { Rng } from '$lib/rules/dice';

/**
 * An `Rng` that yields exactly the values given, in order, and throws once they run out — an
 * over-draw is a real finding (a roll the code was not supposed to make), so it fails loudly instead
 * of quietly wrapping around.
 *
 * Values are the raw [0,1) draws, because `rollDie(sides) = 1 + floor(rng() * sides)` and the tests
 * assert hand-derived faces: 0.5 is a 4 on a d6, an 11 on a d20, a 3 on a d4. A seeded PRNG would
 * make every one of those numbers unexplainable.
 */
export function rngSequence(...values: number[]): Rng {
	let i = 0;
	return () => {
		const value = values[i++];
		if (value === undefined) throw new Error('rng over-drawn');
		return value;
	};
}
