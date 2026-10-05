/*
 * The turn as play-state: what a character can do with it.
 */
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

/** The condition that zeroes the action economy (no Action, Bonus Action, or Reaction). A named seam
 *  (not a bare string compare) — paralyzed/stunned/petrified/unconscious reach it by chaining
 *  `apply_condition:incapacitated`, so this one id gates them all. */
const INCAPACITATED_CONDITION_ID = 'incapacitated';

/** Incapacitated → no actions, bonus actions or reactions. Read from the resolved condition set, so
 *  any condition that chains into `incapacitated` counts; with effects-auto off nothing blocks. */
export const isIncapacitated = (character: Character, sheet: CharacterSheet): boolean =>
	character.play.autoCalc && sheet.facts.conditions.includes(INCAPACITATED_CONDITION_ID);
