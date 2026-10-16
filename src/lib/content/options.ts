/*
 * The OPTIONS of a row: the rows of the `option` type that name it in `option_of`. An item's are
 * its varieties, answered per inventory entry; a class feature's are what the character chooses
 * between, answered in the build. One query for both, so the two cannot match differently.
 */
import { issueText } from './issue-text';
import { parseBonusChoices } from './item-tags';
import type { ContentGraph, LoadedRow, LoadedRowByType } from './loader';
import type { JoinIssue } from './resource-joins';
import { RARITIES, splitList } from './schemas';

export type OptionRow = LoadedRowByType<'option'>;

/** How a parent is spelled in `option_of`. */
export const optionParentKey = (parent: Pick<LoadedRow, 'type' | 'id'>): string =>
	`${parent.type}:${parent.id}`;

/** The parents an option names: one, or a comma list where several features offer the same option —
 *  a 2014 Fighting Style is offered by the fighter's, the paladin's, the ranger's and the champion's
 *  feature, and is one row, so a correction to it lands once. */
export const optionParents = (option: OptionRow): string[] => splitList(option.data.option_of);

/**
 * A row's options, in the order their file lists them — which is the order the source's own table
 * prints. Matched on edition OVERLAP and never on source: a homebrew variety of a shipped item
 * carries its own source tag and must still attach (`loader.ts` ▸ featuresForClass says why).
 */
export function optionsOf(graph: ContentGraph, parent: LoadedRow): OptionRow[] {
	const key = optionParentKey(parent);
	return graph
		.list('option')
		.filter(
			(option) =>
				optionParents(option).includes(key) &&
				option.systems.some((s) => parent.systems.includes(s)),
		);
}

/** The one of a row's options an answer names, if it names one. */
export const optionNamed = (
	graph: ContentGraph,
	parent: LoadedRow,
	id: string | undefined,
): OptionRow | undefined =>
	id === undefined ? undefined : optionsOf(graph, parent).find((option) => option.id === id);

/**
 * Every rarity an item can be found at, commonest first: each rung's where the row is a `+1/+2/+3`
 * ladder that states them, each variety's where its varieties are rows, and its own otherwise. The
 * book prints such a row once, so a list that files it under one rarity hides it from the others.
 * Without a graph only the row itself is read, which is the whole answer for a ladder.
 */
export function itemRarities(row: LoadedRow, graph?: ContentGraph | null): string[] {
	if (row.type !== 'item') return [];
	const stated = [
		...parseBonusChoices(row.data.bonus_choice).map((rung) => rung.rarity),
		...(graph ? optionsOf(graph, row).map((variety) => variety.data.rarity) : []),
	].filter((rarity): rarity is string => !!rarity);
	const found = stated.length ? stated : row.data.rarity ? [row.data.rarity] : [];
	const order = (rarity: string): number => (RARITIES as readonly string[]).indexOf(rarity);
	return [...new Set(found)].sort((a, b) => order(a) - order(b));
}

/** Why an option cannot be taken yet — an open enum, since a rule may grow a third reason. */
export const OPTION_BLOCK = { level: 'level', requires: 'requires', taken: 'taken' } as const;
export type OptionBlock = (typeof OPTION_BLOCK)[keyof typeof OPTION_BLOCK];

/**
 * What stands between a character and an option of a class feature: the class level it opens at,
 * or another option it names that is not held. `null` when nothing does.
 */
export function optionBlock(
	option: OptionRow,
	classLevel: number,
	held: ReadonlySet<string>,
): OptionBlock | null {
	if ((option.data.level ?? 0) > classLevel) return OPTION_BLOCK.level;
	if (option.data.requires && !held.has(option.data.requires)) return OPTION_BLOCK.requires;
	return null;
}

/**
 * Options that point at nothing: a parent this edition does not have, so the option is never
 * offered, or a `requires` naming no option, so nobody can meet it. Content-level, like the
 * resource joins beside which content health lists them.
 */
export function optionJoinIssues(graph: ContentGraph, system: string): JoinIssue[] {
	const options = graph.list('option', { system });
	const parents = new Set(
		graph.rows.filter((row) => row.systems.includes(system)).map(optionParentKey),
	);
	const ids = new Set(options.map((option) => option.id));
	const out: JoinIssue[] = [];
	for (const option of options) {
		const at = { file: `${option.root}/${option.file}`, id: option.id };
		for (const parent of optionParents(option))
			if (!parents.has(parent)) out.push({ ...at, ...issueText.optionParentMissing(parent) });
		if (option.data.requires && !ids.has(option.data.requires))
			out.push({ ...at, ...issueText.optionRequiresMissing(option.data.requires) });
	}
	return out;
}
