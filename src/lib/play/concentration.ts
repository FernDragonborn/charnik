/*
 * Concentration as play-state: one ref, and the effect the spell left on the character. They end
 * together — a ref cleared without its effect leaves a buff standing with no spell behind it.
 */
import type { CharacterPlay, EffectInstance } from '$lib/character/schema';

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

/**
 * Take effects off the character — and the concentration with them, when one of them was carrying
 * it. The carrier effect IS the concentration (`play.concentration` is a ref to it), so a removed or
 * expired one clears the ref too, or the sheet keeps naming a spell that is no longer running. One
 * seam for every way an effect goes: the panel's ✕, a rest that outlasts it, the round counter.
 */
export function dropEffects(
	play: CharacterPlay,
	isGone: (effect: EffectInstance) => boolean,
): CharacterPlay {
	const gone = play.effects.filter(isGone);
	if (!gone.length) return play;
	const carried = gone.some((effect) => effect.source && effect.source === play.concentration);
	return {
		...play,
		effects: play.effects.filter((effect) => !gone.includes(effect)),
		concentration: carried ? null : play.concentration,
	};
}
