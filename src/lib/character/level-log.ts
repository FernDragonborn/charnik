/*
 * The levels a save gained, for the log. A level is taken in the builder, not at the table, so the
 * line that says it was taken is written when the builder's save lands — once, by comparing the
 * character as it was on disk with the character written over it.
 */
import type { Storage } from '$lib/storage/types';
import type { Character } from './schema';
import { appendLog, logLineFor } from './log-repository';
import { LOG_KIND } from './log-kind';
import { eventEntries } from '$lib/combat/roll';
import { logger } from '$lib/diag/logger';

type ClassEntry = Character['build']['classes'][number];

/** One class that rose: which, and the level it reached in it. */
export interface LevelGain {
	classId: string;
	level: number;
}

/** The classes whose level rose, matched by row identity — a class taken anew is a gain from
 *  nothing. A level lowered or kept says nothing: the log records what was gained. */
export function levelGains(
	before: readonly ClassEntry[],
	after: readonly ClassEntry[],
): LevelGain[] {
	const was = new Map(before.map((c) => [c.rowId, c.level]));
	return after.flatMap((c) =>
		c.level > (was.get(c.rowId) ?? 0) ? [{ classId: c.class, level: c.level }] : [],
	);
}

/** Write the levels `after` gained over `before` into the character's log, where the turns played at
 *  them are read. Best-effort: the character is saved by then, and a log line that could not be
 *  written must not turn a successful level-up into a failed save — it is logged, not raised. */
export async function logLevelGains(
	storage: Storage,
	before: Character,
	after: Character,
	nameOf: (classId: string) => string,
): Promise<void> {
	const gains = levelGains(before.build.classes, after.build.classes);
	if (!gains.length) return;
	const total = after.build.classes.reduce((sum, c) => sum + c.level, 0);
	const events = gains.map(({ classId, level }) => {
		const name = nameOf(classId);
		return {
			name: {
				text: `${name} ${level}`,
				key: 'combat.log.levelGained',
				values: { name, level, total },
			},
			kind: LOG_KIND.level,
		};
	});
	try {
		for (const entry of eventEntries(events, Date.now()))
			await appendLog(storage, after.id, logLineFor(entry));
	} catch (e) {
		logger.warn('character: the level-up is saved, its log line is not', {
			error: e instanceof Error ? e.message : String(e),
		});
	}
}
