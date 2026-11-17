/*
 * Multiclassing prerequisites (SRD 5.1 and 5.2.1 ▸ Multiclassing): every class a multiclassed
 * character has needs its scores at 13 — the one they started in as much as the one they enter.
 * The scores per class are data (`class.multiclass_prereq`); the 13 is the rule both SRDs state.
 */
import { ABILITY_IDS, type Ability } from './core';

export const MULTICLASS_MIN_SCORE = 13;

/** A `multiclass_prereq` cell as alternatives of abilities that must ALL reach 13: `str|dex` is
 *  two alternatives of one, `dex,wis` one alternative of two. Blank or unreadable → no demand. */
export function multiclassPrereq(cell: string | undefined): Ability[][] {
	const isAbility = (word: string): word is Ability =>
		(ABILITY_IDS as readonly string[]).includes(word);
	return (cell ?? '')
		.split('|')
		.map((alt) =>
			alt
				.split(',')
				.map((w) => w.trim().toLowerCase())
				.filter(isAbility),
		)
		.filter((alt) => alt.length > 0);
}

/** Does this character's score line meet a class's prerequisite? */
export function meetsMulticlassPrereq(
	alternatives: Ability[][],
	scoreOf: (ability: Ability) => number,
): boolean {
	return (
		alternatives.length === 0 ||
		alternatives.some((alt) => alt.every((a) => scoreOf(a) >= MULTICLASS_MIN_SCORE))
	);
}
