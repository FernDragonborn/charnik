/*
 * "At a level" in content, written once: `<what>@<level>`. `@` reads "at", so `2@3` is "two at level
 * 3" and a ladder is its steps joined by commas — `2@3,2@10` is two at level 3 and two more at 10.
 * Whose level it is belongs to the column (a class feature's is its class's), never to the mark.
 * One mark for the one fact, so the colon is left to say "spell level : count", which is what it
 * says in `spell_choice`.
 */
import { issueText } from './issue-text';
import type { ContentGraph } from './loader';
import type { JoinIssue } from './resource-joins';

export const LEVEL_MARK = '@';

/** The class-feature columns that are a ladder of counts by class level. */
export const LEVEL_LADDER_COLUMNS = ['choose', 'expertise_slots', 'mastery_slots'] as const;

/** One step of a ladder: how many, from which level. */
export interface LevelStep {
	count: number;
	level: number;
}

const STEP = /^(\d+)@(\d+)$/;
/** The form these columns took before the mark: `level:count`. */
const OLD_STEP = /^(\d+):(\d+)$/;

/** A ladder read: the steps it states, and every part it could not read, kept to be said. */
export function readLevelLadder(spec: string | undefined): {
	steps: LevelStep[];
	unread: string[];
} {
	const steps: LevelStep[] = [];
	const unread: string[] = [];
	for (const raw of (spec ?? '').split(',')) {
		const part = raw.trim();
		if (!part) continue;
		const step = STEP.exec(part);
		if (step) steps.push({ count: Number(step[1]), level: Number(step[2]) });
		else unread.push(part);
	}
	return { steps, unread };
}

/** How many a ladder has granted by this level. A part it cannot read grants nothing — it is said in
 *  content health instead of guessed at. */
export const countAtLevel = (spec: string | undefined, level: number): number =>
	readLevelLadder(spec)
		.steps.filter((step) => step.level <= level)
		.reduce((total, step) => total + step.count, 0);

/** Every ladder part content health should point at: the old `level:count` form, with the step it
 *  is in the new one, and anything else that is not a step. */
export function levelLadderIssues(graph: ContentGraph, system: string): JoinIssue[] {
	const out: JoinIssue[] = [];
	for (const row of graph.list('class_feature', { system })) {
		for (const column of LEVEL_LADDER_COLUMNS) {
			for (const part of readLevelLadder(row.data[column]).unread) {
				const old = OLD_STEP.exec(part);
				out.push({
					file: `${row.root}/${row.file}`,
					id: row.id,
					...(old
						? issueText.levelLadderOldForm(column, part, `${old[2]}${LEVEL_MARK}${old[1]}`)
						: issueText.levelLadderUnread(column, part)),
				});
			}
		}
	}
	return out;
}
