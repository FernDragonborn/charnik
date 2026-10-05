/*
 * Concentration as play-state: one ref, and the effect the spell left on the character. They end
 * together — a ref cleared without its effect leaves a buff standing with no spell behind it.
 */
import type { CharacterPlay } from '$lib/character/schema';

/** Stop concentrating: the ref goes, and the spell's own effect with it. */
export function endConcentration(play: CharacterPlay): CharacterPlay {
	const spell = play.concentration;
	if (!spell) return play;
	return {
		...play,
		concentration: null,
		effects: play.effects.filter((effect) => effect.source !== spell),
	};
}
