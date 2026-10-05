/*
 * Experience points as an action. Earning a level never TAKES it — a level-up asks questions only
 * the builder can take answers to — so the total is all that moves here.
 */
import type { Character } from '$lib/character/schema';
import { quietly, type PlayOutcome } from './outcome';

/** Add experience points; a negative amount takes them away (a correction, or a card that says
 *  so). The total never goes below zero. */
export function gainExperience(character: Character, { amount }: { amount: number }): PlayOutcome {
	const xp = Math.max(0, character.play.xp + Math.round(amount || 0));
	return quietly({ ...character, play: { ...character.play, xp } });
}
