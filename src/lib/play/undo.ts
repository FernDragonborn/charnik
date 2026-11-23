/*
 * Taking a play act back (audit-oct-27 U7): the act's delta applied in reverse. Not settled again —
 * the state it returns to was a settled one — and refused, with a word, when anything the act
 * changed has moved since.
 */
import type { Character } from '#lib/character/schema.ts';
import { LOG_KIND } from '#lib/character/log-kind.ts';
import { undoDelta, type PlayDelta } from './delta';
import { quietly, type PlayOutcome } from './outcome';

export function undoAct(character: Character, { delta }: { delta: PlayDelta }): PlayOutcome {
	const back = undoDelta(character, delta);
	if (!back)
		return {
			...quietly(character),
			refused: true,
			notices: [{ text: { key: 'combat.notice.undoRefused' } }],
		};
	return {
		character: back,
		log: [],
		notices: [{ text: { key: 'combat.notice.undone' }, kind: LOG_KIND.undo }],
	};
}
