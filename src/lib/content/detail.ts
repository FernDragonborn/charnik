/*
 * Pure "content → view" helpers shared by the Compendium and the Spellbook (both are the
 * same two-pane shape: a grouped list + a wiki detail rendered from the CSV row). No Svelte —
 * unit-testable. The components (WikiDetail / EntryList) just render these models.
 */
import type { LoadedRow } from '$lib/content/loader';
import type { ContentType } from '$lib/content/schemas';

/** Columns never shown as a meta cell (identity / localization / rendered elsewhere). */
const COMMON = new Set([
	'id',
	'systems',
	'source',
	'name_en',
	'name_uk',
	'text_en',
	'text_uk',
	'effects',
	'higher_level'
]);

const cap = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const asText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v));
const nonEmpty = (v: unknown) => v !== '' && v != null && !(Array.isArray(v) && v.length === 0);
// skip noisy negative/placeholder values ("false", "none", "0") from the meta grid
const meaningful = (v: unknown) => nonEmpty(v) && !/^(false|none|0)$/i.test(String(v));
const ordinal = (n: number) =>
	`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const abilMod = (score: number) => {
	const m = Math.floor((score - 10) / 2);
	return m >= 0 ? `+${m}` : `−${Math.abs(m)}`;
};

export interface AbilityScore {
	ab: string; // "STR"
	score: number;
	mod: string; // "+5" / "−1"
}

/** A row in the left-pane list (name + meta sub-line + the underlying content row). */
export interface Entry<T> {
	id: string;
	name: string;
	meta: string;
	row: T;
}

export interface DetailModel {
	eyebrow: string; // "Level 3 · Evocation" (spell) or the type name
	title: string;
	abilities: AbilityScore[]; // monster STR..CHA block (empty otherwise)
	meta: [string, string][]; // k/v cells (Casting time, Range, Components, Duration, …)
	bodyHtml: string; // text_en — rendered as HTML (content may contain markup)
	higherLevel: string; // higher_level, if any
	source: string; // attribution line
}

/** Build the right-pane wiki detail model for a content row. */
export function buildDetail(row: LoadedRow, type: ContentType): DetailModel {
	const d = row.data;
	const skip = new Set(COMMON);
	let eyebrow: string;
	if (type === 'spell') {
		eyebrow = [
			Number(d.level) === 0 ? 'Cantrip' : `Level ${d.level}`,
			d.school ? cap(String(d.school)) : ''
		]
			.filter(Boolean)
			.join(' · ');
		skip.add('level');
		skip.add('school');
	} else {
		eyebrow = cap(String(type));
	}
	// monster ability scores → a compact 3×2 block, kept out of the generic meta grid
	const abilities: AbilityScore[] = ABILS.filter((a) => meaningful(d[a])).map((a) => ({
		ab: a.toUpperCase(),
		score: Number(d[a]),
		mod: abilMod(Number(d[a]))
	}));
	if (abilities.length) ABILS.forEach((a) => skip.add(a));

	const meta = Object.entries(d)
		.filter(([k, v]) => !skip.has(k) && meaningful(v))
		.map(([k, v]) => [cap(k), asText(v)] as [string, string]);

	// The 2024 monster text embeds the whole stat-block header (Size/AC/HP/Speed, the ability
	// grid that flattens into "MOD SAVE …" mush, Resistances, Senses, CR) — most already shown
	// structured above. Before dropping the header (keep only the Traits/Actions prose after
	// the "**CR** …" line), lift the fields that AREN'T columns (Initiative/Resistances/
	// Immunities/Vulnerabilities) into meta cells so nothing is lost. 2014 has no such header.
	let body = String(d.text_en ?? '');
	if (abilities.length) {
		const cr = body.match(/\*\*CR\*\*[^\n]*\n?/);
		const header = cr ? body.slice(0, body.indexOf(cr[0])) : '';
		for (const key of ['Initiative', 'Resistances', 'Immunities', 'Vulnerabilities']) {
			const m = header.match(new RegExp(`\\*\\*${key}\\*\\*\\s*([^\\n*]+)`));
			if (m && m[1].trim()) meta.push([key, m[1].trim().replace(/\s+$/, '')]);
		}
		if (cr) body = body.slice(body.indexOf(cr[0]) + cr[0].length).replace(/^\s+/, '');
	}
	return {
		eyebrow,
		title: String(d.name_en),
		abilities,
		meta,
		bodyHtml: body,
		higherLevel: String(d.higher_level ?? ''),
		source: `Source: ${row.source}`
	};
}

/** The small sub-line under an entry's name in the list. */
export function entryMeta(row: LoadedRow, type: ContentType): string {
	const d = row.data;
	if (type === 'spell') {
		const res =
			d.resolution &&
			d.resolution !== 'none' &&
			d.resolution !== 'attack' &&
			d.resolution !== 'save'
				? String(d.resolution)
				: '';
		return [d.school ? String(d.school) : '', d.damage ? String(d.damage) : res]
			.filter(Boolean)
			.join(' · ');
	}
	return [d.category, d.item_type, d.rarity]
		.map((x) => (x ? String(x) : ''))
		.filter(Boolean)
		.join(' · ');
}

/** Group entries for the list — spells by level, everything else as one flat group. */
export function groupEntries(
	rows: LoadedRow[],
	type: ContentType
): { label: string; rows: LoadedRow[] }[] {
	if (type !== 'spell') return [{ label: '', rows }];
	const byLevel = new Map<number, LoadedRow[]>();
	for (const r of rows) {
		const l = Number(r.data.level);
		(byLevel.get(l) ?? byLevel.set(l, []).get(l)!).push(r);
	}
	return [...byLevel.keys()]
		.sort((a, b) => a - b)
		.map((l) => ({ label: l === 0 ? 'Cantrips' : `${ordinal(l)} level`, rows: byLevel.get(l)! }));
}
