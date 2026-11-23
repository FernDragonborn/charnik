/*
 * Taking play acts back (audit-oct-27 U7): each act's delta applied in reverse. Not settled again —
 * the state it returns to was a settled one — and refused, with a word, when anything an act
 * changed has moved since.
 */
import type { Character } from '#lib/character/schema.ts';
import { LOG_KIND, type LogKind } from '#lib/character/log-kind.ts';
import { undoDelta, type PlayDelta } from './delta';
import { quietly, type PlayOutcome } from './outcome';

export function undoAct(character: Character, { delta }: { delta: PlayDelta }): PlayOutcome {
	return rewindActs(character, { deltas: [delta] });
}

/**
 * Take back several acts, newest first — a rewind through the log to before the oldest of them.
 * All or nothing: when any act on the way changed something that has moved since, none is taken
 * back, because stopping half-way leaves a state that never was.
 */
export function rewindActs(
	character: Character,
	{ deltas }: { deltas: readonly PlayDelta[] },
): PlayOutcome {
	let back: Character | null = character;
	for (const delta of deltas) {
		if (!back) break;
		back = undoDelta(back, delta);
	}
	if (!back)
		return {
			...quietly(character),
			refused: true,
			notices: [{ text: { key: 'combat.notice.undoRefused' } }],
		};
	const said =
		deltas.length === 1
			? { key: 'combat.notice.undone' }
			: { key: 'combat.notice.rewound', values: { count: deltas.length } };
	return { character: back, log: [], notices: [{ text: said, kind: LOG_KIND.undo }] };
}

/** What a log line carries that a take-back reads. */
interface LoggedAct {
	delta?: PlayDelta;
	kind?: LogKind;
}

/**
 * What taking the log back to `line` reverses, newest first: the delta of every line from the newest
 * down to it. Null when the line changed nothing, or when a level-up stands on the way — that is a
 * build change, which the log does not take back, so nothing older than it can be reached.
 */
export function deltasBackTo<L extends LoggedAct>(log: readonly L[], line: L): PlayDelta[] | null {
	const at = log.indexOf(line);
	if (at < 0 || !line.delta?.length) return null;
	const way = log.slice(0, at + 1);
	if (way.some((l) => l.kind === LOG_KIND.level)) return null;
	return way.flatMap((l) => (l.delta?.length ? [l.delta] : []));
}
