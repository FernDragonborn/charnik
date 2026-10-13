/*
 * The left-pane LIST the Compendium, the Spellbook and the translator share: a row's entry, the
 * sub-line under its name, and the grouping. Pure — the components render these models.
 */
import type { LoadedRow } from '$lib/content/loader';
import { abilityShortLabel, asText, titleCase } from '$lib/util/format';
import type { ContentType } from '$lib/content/schemas';
import type { Translate } from '$lib/i18n';
import { editionLabel } from './detail';
import { itemRarities } from './options';

/** A row in the left-pane list (name + meta sub-line + the underlying content row). */
export interface Entry<T> {
	id: string;
	name: string;
	meta: string;
	edition: string; // "5e" | "5.5e" | "5e · 5.5e" — shown dimmed when >1 edition is active
	row: T;
}

/** "60 feet" → "60 ft". The one safe swap on free SRD text, and it is on every single row. */
const shortRange = (s: string): string => s.replace(/\bfeet\b/i, 'ft').replace(/-foot\b/i, '-ft');

/** The casting time both editions spell for a plain action — 2014 writes "1 action", 2024 "Action". */
const PLAIN_ACTION = /^(1\s+)?action$/i;

/** Between the rarities one entry is found at. Not the ` · ` that separates facts: these are one. */
export const RARITY_JOIN = ' / ';

/**
 * A content enum value as a person reads it — a school, a rarity, an item kind, a feat category.
 *
 * The catalog is the source and the value itself is the fallback, exactly like `skillLabel`: these
 * columns are OPEN enums, so a homebrew pack's ninth school has to read as a name rather than as a
 * missing key. Takes the translator, because this module has no locale of its own.
 */
export const contentLabel = (catalog: string, value: unknown, t: Translate): string => {
	// through `asText`, not `String`: a column whose cell holds a list or an object stringifies to
	// "[object Object]", which would then be looked up as a key and printed as one
	const key = asText(value);
	return key ? t(`${catalog}.${key}`, { default: titleCase(key) }) : '';
};

/** The small sub-line under an entry's name in the list. */
export function entryMeta(row: LoadedRow, t: Translate): string {
	if (row.type === 'spell') {
		const d = row.data;
		const casting = String(d.casting_time ?? '');
		return [
			contentLabel('spellSchool', d.school, t),
			// A plain action is the default and true of most spells — printing it on every row is
			// noise, while a bonus action or a reaction is exactly what decides whether a spell is
			// castable this turn. Only the unusual casting time earns the space.
			PLAIN_ACTION.test(casting) ? '' : casting,
			d.range ? shortRange(String(d.range)) : '',
			d.damage ? String(d.damage) : '',
			d.resolution === 'save' && d.save_ability
				? t('entryMeta.save', {
						// the ability's short name is a catalog entry, so a save reads "ряткидок МУД" rather
						// than an upper-cased English id — the same resolution the spell panel's chip makes
						values: {
							ability: abilityShortLabel(String(d.save_ability).toLowerCase(), t),
						},
					})
				: '',
			d.resolution === 'attack' ? t('entryMeta.attack') : '',
			d.concentration ? t('entryMeta.concentration') : '',
			d.ritual ? t('entryMeta.ritual') : '',
		]
			.filter(Boolean)
			.join(' · ');
	}
	// The `in` checks read only the columns a row's type actually has — no cast onto the union.
	const data = row.data;
	return [
		'category' in data ? contentLabel(categoryCatalog(row.type), data.category, t) : '',
		// each rarity a `+1/+2/+3` row states, where the book prints one entry for three items
		itemRarities(row)
			.map((rarity) => contentLabel('itemRarity', rarity, t))
			.join(RARITY_JOIN),
	]
		.filter(Boolean)
		.join(' · ');
}

/** Which catalog a `category` column is spelled in — the column name is shared, the vocabulary is
 *  not: an item's category is a kind of thing, a feat's is when you may take it. */
const categoryCatalog = (type: ContentType): string =>
	type === 'feat' ? 'featCategory' : 'itemCategory';

/** Project grouped rows into the EntryList model: each group's rows become display Entries (id, name
 *  via `nameOf`, meta, edition, row). Shared by the compendium + spellbook lists so the row projection
 *  stays identical; the caller supplies the grouping and the name source (localized vs English). */
export function toEntryGroups(
	groups: { label: string; rows: LoadedRow[] }[],
	nameOf: (row: LoadedRow) => string,
	t: Translate,
): { label: string; entries: Entry<LoadedRow>[] }[] {
	return groups.map((g) => ({
		label: g.label,
		entries: g.rows.map((r) => ({
			id: r.effectiveId,
			name: nameOf(r),
			meta: entryMeta(r, t),
			edition: editionLabel(r.systems),
			row: r,
		})),
	}));
}

/** Group entries for the list — spells by level, everything else as one flat group. */
export function groupEntries(
	rows: LoadedRow[],
	type: ContentType,
	t: Translate,
): { label: string; rows: LoadedRow[] }[] {
	if (type !== 'spell') return [{ label: '', rows }];
	const byLevel = new Map<number, LoadedRow[]>();
	for (const r of rows) {
		const level = r.type === 'spell' ? Number(r.data.level) : 0;
		const bucket = byLevel.get(level) ?? [];
		bucket.push(r);
		byLevel.set(level, bucket);
	}
	return [...byLevel.keys()]
		.sort((a, b) => a - b)
		.map((level) => ({
			label: level === 0 ? t('spellLevel.cantrips') : t('spellLevel.group', { values: { level } }),
			rows: byLevel.get(level) ?? [],
		}));
}
