/*
 * A class's or a background's starting equipment, as its `starting_equipment` column states it
 * (`docs/internals/content.md` ▸ Starting equipment).
 *
 *   chain_mail | leather_armor + longbow + arrows; any.martial + shield | 2*any.martial
 *
 * `;` separates the lines the book prints, `|` the alternatives a line offers — SRD 5.1's (a)/(b),
 * SRD 5.2.1's A/B/C — and `+` the things one alternative hands over. A thing is an item id with an
 * optional count (`4*handaxe`), coins (`15gp`), or an item the player picks (`any.martial,melee`: one
 * whose tags carry every word; `/` between word sets is either). A trailing `?` on an item is the
 * book's "(if proficient)".
 *
 * Parsed, never evaluated, and nothing in it is read out of the row's prose: a part this cannot read
 * stays as its own text, shown on the card and named in content health, and adds nothing.
 */
import type { ContentGraph, LoadedRow, LoadedRowOf } from './loader';
import { parseItemTags } from './item-tags';
import { resolveItem, needsBaseItem } from './resolved-item';
import { issueText, type IssueText } from './issue-text';
import type { JoinIssue } from './resource-joins';
import { COINS } from '$lib/rules/currency';

export const KIT_SOURCE = { class: 'class', background: 'background' } as const;
export type KitSource = (typeof KIT_SOURCE)[keyof typeof KIT_SOURCE];
export const KIT_SOURCES = [KIT_SOURCE.class, KIT_SOURCE.background] as const;

export const KIT_PART = { item: 'item', any: 'any', coin: 'coin', unread: 'unread' } as const;

export type KitPart =
	| { kind: typeof KIT_PART.item; id: string; count: number; ifProficient: boolean }
	/** Each inner list is a set of tag words an item must ALL carry; the item may match any set. */
	| { kind: typeof KIT_PART.any; tagSets: string[][]; count: number }
	| { kind: typeof KIT_PART.coin; coin: string; amount: number }
	| { kind: typeof KIT_PART.unread; text: string };

export interface KitAlternative {
	parts: KitPart[];
}

/** One line the book prints. A line with one alternative is not a choice — it is simply handed over. */
export interface KitLine {
	alternatives: KitAlternative[];
}

const COIN_IDS = COINS.map((c) => c.id);
const COUNTED = /^(\d+)\*(.+)$/;
const COIN = new RegExp(`^(\\d+)(${COIN_IDS.join('|')})$`);
const WORD = /^[a-z0-9_]+$/;
const ANY_PREFIX = 'any.';
const IF_PROFICIENT = '?';

function parsePart(text: string): KitPart {
	const coin = COIN.exec(text);
	if (coin) return { kind: KIT_PART.coin, coin: coin[2] ?? '', amount: Number(coin[1]) };
	const counted = COUNTED.exec(text);
	const count = counted ? Number(counted[1]) : 1;
	const body = (counted ? (counted[2] ?? '') : text).trim();
	if (count < 1) return { kind: KIT_PART.unread, text };
	if (body.startsWith(ANY_PREFIX)) {
		const tagSets = body
			.slice(ANY_PREFIX.length)
			.split('/')
			.map((set) => set.split(',').map((word) => word.trim()));
		return tagSets.every((set) => set.every((word) => WORD.test(word)))
			? { kind: KIT_PART.any, tagSets, count }
			: { kind: KIT_PART.unread, text };
	}
	const ifProficient = body.endsWith(IF_PROFICIENT);
	const id = ifProficient ? body.slice(0, -IF_PROFICIENT.length) : body;
	return WORD.test(id)
		? { kind: KIT_PART.item, id, count, ifProficient }
		: { kind: KIT_PART.unread, text };
}

/** The column as lines of alternatives. Blank → no starting equipment. */
export function parseStartingKit(raw: string | undefined): KitLine[] {
	const lines: KitLine[] = [];
	for (const line of (raw ?? '').split(';')) {
		if (!line.trim()) continue;
		lines.push({
			alternatives: line.split('|').map((alternative) => ({
				parts: alternative
					.split('+')
					.map((part) => part.trim())
					.filter(Boolean)
					.map(parsePart),
			})),
		});
	}
	return lines;
}

/** The kit the row carries, or none — the one reader of the column. */
export function kitOf(row: LoadedRow | undefined): KitLine[] {
	return row?.type === 'class' || row?.type === 'background'
		? parseStartingKit(row.data.starting_equipment)
		: [];
}

/** The item rows of one edition by id: a kit names its items by id, matched in the row's own
 *  edition and never by source, so a homebrew pack's dagger serves a shipped kit. */
export function kitItemsById(
	graph: ContentGraph,
	system: string,
	isActive: (row: LoadedRow) => boolean,
): Map<string, LoadedRowOf<'item'>> {
	const out = new Map<string, LoadedRowOf<'item'>>();
	for (const row of graph.list('item', { system }))
		if (isActive(row) && !out.has(row.id)) out.set(row.id, row);
	return out;
}

/** Does the item carry every word of one of the sets? Mundane only: a magic item is found, never
 *  handed over at 1st level, and a template states no item until someone says which. */
export function matchesAny(
	graph: ContentGraph,
	row: LoadedRowOf<'item'>,
	tagSets: readonly (readonly string[])[],
): boolean {
	if (row.data.rarity) return false;
	const item = resolveItem(graph, row);
	if (needsBaseItem(item)) return false;
	const tags = parseItemTags(row.data.tags);
	return tagSets.some((set) => set.every((word) => tags.has(word)));
}

/** The coins one alternative hands over, by coin id. */
export function kitCoins(alternative: KitAlternative): Record<string, number> {
	const out: Record<string, number> = {};
	for (const part of alternative.parts)
		if (part.kind === KIT_PART.coin) out[part.coin] = (out[part.coin] ?? 0) + part.amount;
	return out;
}

/** What one part cannot hand over in this edition, or nothing. */
function partIssue(
	graph: ContentGraph,
	items: Map<string, LoadedRowOf<'item'>>,
	part: KitPart,
): IssueText | null {
	if (part.kind === KIT_PART.unread) return issueText.kitPartUnread(part.text);
	if (part.kind === KIT_PART.item && !items.has(part.id))
		return issueText.kitItemMissing(part.id, items.keys());
	if (
		part.kind === KIT_PART.any &&
		![...items.values()].some((item) => matchesAny(graph, item, part.tagSets))
	)
		return issueText.kitAnyNone(part.tagSets.map((set) => set.join(',')).join('/'));
	return null;
}

/** What a kit names that this edition cannot hand over — a part it cannot read, an item id with no
 *  row, a pick no item can answer. Each is a card that adds nothing, so each is said. */
export function startingKitIssues(graph: ContentGraph, system: string): JoinIssue[] {
	const items = kitItemsById(graph, system, () => true);
	const out: JoinIssue[] = [];
	for (const row of [...graph.list('class', { system }), ...graph.list('background', { system })]) {
		const at = { file: `${row.root}/${row.file}`, id: row.id };
		for (const part of kitOf(row).flatMap((line) => line.alternatives.flatMap((a) => a.parts))) {
			const said = partIssue(graph, items, part);
			if (said) out.push({ ...at, ...said });
		}
	}
	return out;
}
