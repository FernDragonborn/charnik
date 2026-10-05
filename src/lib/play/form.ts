/*
 * A form as play-state: `play.form` says which stat block, and a carrier effect whose `source` is the
 * same ref holds its numbers and its clock (`character/forms.ts`).
 */
import type { CharacterPlay } from '$lib/character/schema';

/** The form ends, however it ended: its carrier goes, and hit points that were waiting come back. */
export function leaveForm(play: CharacterPlay): CharacterPlay {
	const form = play.form;
	if (!form) return play;
	return {
		...play,
		form: null,
		effects: play.effects.filter((effect) => effect.source !== form.monster),
		hp: form.hpBefore === undefined ? play.hp : { ...play.hp, current: form.hpBefore },
	};
}
