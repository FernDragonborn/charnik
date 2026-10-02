/*
 * Experience points and the level they have earned.
 *
 * Both SRDs state it as a table and one sentence — "When your XP total equals or exceeds a number in
 * the Experience Points column, you reach the corresponding level" (5.2.1), and 5.1's Character
 * Advancement table "summarizes the XP you need to advance in levels" — so the table is DATA (the
 * pack's `advancement` rows) and this is the sentence. A system whose pack ships no table has no
 * answer here, and says so rather than borrowing another edition's numbers.
 */

/** One row of an advancement table: the XP total at which a level is reached. */
export interface LevelThreshold {
	level: number;
	xp: number;
}

/** The level an XP total has earned: the highest level whose threshold it meets. Undefined when the
 *  table is empty — there is then nothing to earn a level against. */
export function levelEarned(table: readonly LevelThreshold[], xp: number): number | undefined {
	let earned: number | undefined;
	for (const row of table) if (xp >= row.xp && row.level > (earned ?? 0)) earned = row.level;
	return earned;
}

/** The XP total at which a level is reached, or undefined when the table has no row for it — past
 *  the last level there is nothing further to reach. */
export const xpToReach = (table: readonly LevelThreshold[], level: number): number | undefined =>
	table.find((row) => row.level === level)?.xp;
