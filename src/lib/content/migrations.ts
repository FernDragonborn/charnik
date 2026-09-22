/*
 * Forward migration of CONTENT rows across a `#content-schema:` bump (DATA-VER-1, task 6).
 *
 * The unit is a FILE, not a row: the schema version is declared once in the header, so every row in
 * the file is at that version and a step transforms them together (a column split, a renamed value,
 * an id re-slugging — the E3 kebab→snake pass is exactly the shape this would have taken).
 *
 * It is wired up while the registry is EMPTY on purpose, and not as somewhere to put future work:
 * without it a pack declaring a schema this build has never heard of loads in silence and renders
 * whatever its columns happen to mean here. Now that file says so in content health, which is the
 * half that matters before the first migration ever exists.
 *
 * `CONTENT_SCHEMA_VERSION` is the target. Registering a step is: bump the constant, add the
 * `from → transform` entry below for each type the change touches, and re-stamp the shipped CSVs.
 */
import {
	CONTENT_SCHEMA_VERSION,
	migrate,
	type Migration,
	type Versioned,
} from '$lib/schema/version';
import type { ContentType } from './schemas';

/** A file's rows carried together with the version they were authored at. */
export interface VersionedRows extends Versioned {
	rows: Record<string, string>[];
}

/** Lowercase snake_case form of one word or value, keeping the characters a tag value needs
 *  (`1d10`, `20/60`). `-` becomes `_` because it is the L2 minus operator (see `slugify`). */
const slugTag = (s: string): string =>
	s
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z0-9_/]/g, '');

/** Split a v1 `properties` cell without breaking a parenthetical that contains the separator —
 *  "Ammunition (Range 80/320, Bolt)" is ONE property, and splitting it produced the junk entry
 *  "Bolt)" that shipped as a weapon scope. */
function splitProperties(raw: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of raw) {
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
		if ((ch === ',' || ch === ';') && depth === 0) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * One v1 `properties` entry → its tag(s). The column mixed three shapes: a bare word ("Finesse"), a
 * word qualifying itself in a parenthetical ("Versatile (1d10)", "Thrown (Range 20/60)"), and an
 * already-`name: value` pair ("mastery: Vex"). A parenthetical whose value has a space is prose, not
 * a value — the word is kept and the qualifier stays in `text_en`, where it always was.
 */
function propertyTags(raw: string): string[] {
	const pair = /^([^:(]+):\s*(.+)$/.exec(raw);
	if (pair) return [`${slugTag(pair[1] ?? '')}:${slugTag(pair[2] ?? '')}`];
	const m = /^([^(]+?)\s*(?:\((.*)\))?$/.exec(raw);
	const name = slugTag(m?.[1] ?? '');
	if (!name) return [];
	// "(Range 20/60)" — the word "Range" is the column saying what the number is, not part of it
	const inner = (m?.[2] ?? '').replace(/^range\s+/i, '').trim();
	if (!inner) return [name];
	// the SRD separates INSIDE a parenthetical with either mark: "(Range 80/320; Bolt)" in 5.5e,
	// "(range 20/60)" in 5.1 — same list grammar `splitList` reads
	const [value, ...rest] = inner.split(/[,;]/).map((s) => s.trim());
	const tags = value && !/\s/.test(value) ? [`${name}:${slugTag(value)}`] : [name];
	// "Ammunition (Range 80/320, Bolt)" also says WHICH ammunition the weapon fires
	for (const extra of rest) if (extra && !/\s/.test(extra)) tags.push(`ammo:${slugTag(extra)}`);
	return tags;
}

/** Magic-item kinds that v1 kept in `item_type` while `category` said only "gear". They are what
 *  `category` should have held all along, so they migrate INTO it rather than becoming tags. */
const MAGIC_KINDS: readonly string[] = ['potion', 'ring', 'wand', 'staff', 'rod', 'scroll'];

/** A row's v2 category. Its own `category` column is the answer for everything the SRD tables
 *  produced; only a magic item's `item_type` knows better, because that is where its kind was. */
function itemCategoryFrom(head: string, qualifier: string, declared: string): string {
	if (qualifier === 'shield') return 'shield'; // "armor (shield)" is a shield, not armour
	if (head === 'wondrous item') return 'wondrous';
	return MAGIC_KINDS.find((kind) => head === kind || head === `${kind} item`) ?? declared;
}

/**
 * v1 → v2 for an item row: eight sparse columns fold into `tags` (docs/plan.md ▸ ITEM-TAGS).
 *
 * `item_type` is the reason this migration exists — it held a weapon's category ("martial melee"),
 * an armor's weight ("heavy armor") and a magic item's PROSE ("weapon (any sword that deals
 * slashing damage)") under one name, and three readers substring-matched it. Only the words before
 * the parenthetical are ever categories; the phrase inside is prose and is dropped here, because a
 * magic item names its base through `base_item_id` now and nowhere else.
 */
function itemV1ToV2(row: Record<string, string>): Record<string, string> {
	const cell = (name: string): string => (row[name] ?? '').trim();
	const type = cell('item_type').toLowerCase();
	// magic items qualify a base in prose ("weapon (any sword)"); only the head words are categories
	const [head = '', qualifier = ''] = [
		(type.split('(')[0] ?? '').trim(),
		(type.split('(')[1] ?? '').replace(')', '').trim(),
	];
	const words = new Set(head.split(/\s+/).filter(Boolean));
	const tags: string[] = [];

	if (words.has('martial')) tags.push('martial');
	else if (words.has('simple')) tags.push('simple');
	if (words.has('melee')) tags.push('melee');
	else if (words.has('ranged')) tags.push('ranged');
	// weight only off an ARMOR row: "light" is a weapon property too, and a Light hammer must not
	// come out of this wearing light armor
	if (cell('category') === 'armor')
		for (const w of ['light', 'medium', 'heavy']) if (words.has(w)) tags.push(`armor:${w}`);

	const properties = splitProperties(cell('properties')).flatMap(propertyTags);
	tags.push(...properties);
	// `range` duplicated the thrown/ammunition parenthetical; keep it only where nothing carried it
	const range = cell('range');
	if (range && !properties.some((t) => /^(thrown|ammunition):/.test(t)))
		tags.push(`range:${slugTag(range)}`);

	for (const [column, name] of [
		['ac', 'ac'],
		['armor_dex_cap', 'dex_cap'],
		['str_min', 'str_min'],
	] as const)
		if (cell(column) !== '') tags.push(`${name}:${slugTag(cell(column))}`);
	if (cell('stealth_disadvantage').toLowerCase() === 'true') tags.push('stealth_disadvantage');
	if (cell('attunement').toLowerCase() === 'true') tags.push('attunement');

	const out: Record<string, string> = {
		...row,
		category: itemCategoryFrom(head, qualifier, cell('category')),
		tags: [...new Set(tags)].join(', '),
		base_item_id: cell('base_item_id'),
	};
	for (const dropped of [
		'item_type',
		'properties',
		'range',
		'ac',
		'armor_dex_cap',
		'str_min',
		'stealth_disadvantage',
		'attunement',
	])
		delete out[dropped];
	return out;
}

/**
 * Per-type migration steps, keyed by the version they upgrade FROM. A type absent from here has no
 * steps, which is only an error if a file actually declares an older version — `migrate` says so
 * rather than guessing.
 */
export const CONTENT_MIGRATIONS: Partial<
	Record<ContentType, Record<number, Migration<VersionedRows>>>
> = {
	item: {
		1: ({ rows }) => ({ schemaVersion: 2, rows: rows.map(itemV1ToV2) }),
	},
	effect: {
		2: ({ rows }) => ({ schemaVersion: 3, rows: rows.map(stateV2ToV3) }),
	},
};

/**
 * v2 → v3 (CONDEFF): the `negative` boolean becomes the `valence` open enum.
 *
 * The rename is the whole of it, because the merge kept both files' names and both kinds' columns —
 * but the VALUE has to move, or a debuff written before the merge reads as `neutral` and renders as
 * something the player wants. `true`/`false` are the only two things the old column could say, and a
 * row that already carries a valence is left alone: an author who wrote both meant the newer one.
 */
function stateV2ToV3(row: Record<string, string>): Record<string, string> {
	const { negative, ...rest } = row;
	if (rest.valence) return rest;
	if (negative === undefined || negative === '') return rest;
	return { ...rest, valence: negative.toLowerCase() === 'true' ? 'harmful' : 'helpful' };
}

/** What a file's `#content-schema:` said, or the current version when it says nothing. Absent is
 *  treated as current rather than as 0: an unstamped hand-authored CSV is written against TODAY's
 *  columns, and demanding a migration for it would flag every homebrew file ever hand-made. */
export function declaredSchema(value: string | undefined): number {
	const n = Number(value);
	return value === undefined || !Number.isFinite(n) ? CONTENT_SCHEMA_VERSION : n;
}

/** Migration outcome. `error` set ⇒ the rows come back UNTOUCHED and the caller surfaces the reason:
 *  refusing to guess beats loading rows under a shape they were not written for. */
export interface MigrationResult {
	rows: Record<string, string>[];
	error?: string;
}

/** Bring one file's rows up to `CONTENT_SCHEMA_VERSION`. Never throws — the loader's contract is that
 *  a bad file becomes an issue, not an exception. */
export function migrateRows(
	type: ContentType,
	rows: Record<string, string>[],
	from: number,
): MigrationResult {
	if (from === CONTENT_SCHEMA_VERSION) return { rows };
	// One version counter covers every content TYPE, so a bump that reshapes items says nothing about
	// spells: a type with no step at a version simply did not change then, and its rows advance
	// untouched. (Contrast the CHARACTER chain — one shape, so there a missing step is a real gap.)
	const declared = CONTENT_MIGRATIONS[type] ?? {};
	const steps: Record<number, Migration<VersionedRows>> = {};
	for (let v = from; v < CONTENT_SCHEMA_VERSION; v++)
		steps[v] = declared[v] ?? ((data) => ({ ...data, schemaVersion: v + 1 }));
	try {
		const out = migrate<VersionedRows>(
			{ schemaVersion: from, rows },
			steps,
			CONTENT_SCHEMA_VERSION,
		);
		return { rows: out.rows };
	} catch (e) {
		return { rows, error: e instanceof Error ? e.message : String(e) };
	}
}
