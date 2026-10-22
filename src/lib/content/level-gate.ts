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

const GRANT = /^([a-z0-9_]+)(?:@(\d+))?$/;

/** The ids a grant column (`spells`) names by this level: `bless@3` from level 3, a bare `bless`
 *  from the row's own level, which the reader has already reached. A part it cannot read grants
 *  nothing and is said in content health. */
export function grantedAtLevel(spec: string | undefined, level: number): string[] {
	const out: string[] = [];
	for (const raw of (spec ?? '').split(',')) {
		const m = GRANT.exec(raw.trim());
		if (m?.[1] && (m[2] === undefined || Number(m[2]) <= level)) out.push(m[1]);
	}
	return out;
}

/** Every part of a feature's `spells` content health should point at: one it cannot read, and a
 *  spell this edition has no row for. */
function featureSpellIssues(graph: ContentGraph, system: string): JoinIssue[] {
	const spells = new Set(graph.list('spell', { system }).map((spell) => spell.id));
	const out: JoinIssue[] = [];
	for (const row of graph.list('class_feature', { system }))
		for (const raw of (row.data.spells ?? '').split(',')) {
			const part = raw.trim();
			const m = GRANT.exec(part);
			if (!part || (m?.[1] && spells.has(m[1]))) continue;
			out.push({
				file: `${row.root}/${row.file}`,
				id: row.id,
				...(m ? issueText.featureSpellMissing(part) : issueText.featureSpellUnread(part)),
			});
		}
	return out;
}

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
	return [...out, ...featureSpellIssues(graph, system)];
}
