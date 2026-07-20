/*
 * Pure "content → view" helpers shared by the Compendium and the Spellbook (both are the
 * same two-pane shape: a grouped list + a wiki detail rendered from the CSV row). No Svelte —
 * unit-testable. The components (WikiDetail / EntryList) just render these models.
 */
import { LOCALE_TAG, type LoadedRow, type LoadedRowOf } from '$lib/content/loader';
import { ordinal, signed } from '$lib/util/format';
import { ABILITY_IDS, abilityModifier } from '$lib/rules/core';
import type { ContentType, RowColumn } from '$lib/content/schemas';

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

// nicer meta-cell labels than the auto Title-Case of the raw column name
const LABELS: Record<string, string> = {
	item_type: 'Type',
	weight_lb: 'Weight (lb)',
	damage_type: 'Damage type',
	armor_dex_cap: 'Dex cap',
	str_min: 'Str min',
	stealth_disadvantage: 'Stealth',
	ac: 'AC',
	hp_formula: 'HP formula',
	save_ability: 'Save',
	casting_time: 'Casting time',
	higher_level: 'At higher levels',
	creature_type: 'Type',
	class_id: 'Class'
};
const cap = (s: string) =>
	LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const asText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v));
const nonEmpty = (v: unknown) => v !== '' && v != null && !(Array.isArray(v) && v.length === 0);
// skip noisy negative/placeholder values ("false", "none", "0") from the meta grid
const meaningful = (v: unknown) => nonEmpty(v) && !/^(false|none|0)$/i.test(String(v));

// Prose columns are localized `<base>_<loc>`. Read a locale with fallback: target → en → a legacy
// bare column (so pre-localization data like a plain `material` still renders). PROSE_LOC matches the
// suffixed variants so the meta grid can skip them (they're rendered as prose, not as k/v cells).
const localized = (d: Record<string, unknown>, base: string, locale: string): string =>
	String(d[`${base}_${locale}`] ?? d[`${base}_en`] ?? d[base] ?? '');

/** A content row's display NAME in `locale`, falling back to EN then the id (AUDIT F9 — the one
 *  localized-name reader). NB translate view deliberately does NOT use this (it wants an empty
 *  string, not an EN fallback, to mark "not yet translated"). */
export const localizedName = (row: LoadedRow, locale: string): string =>
	String(row.data[`name_${locale}`] || row.data.name_en || row.id);
const PROSE_LOC = new RegExp(`^(?:name|text|material|higher_level)_${LOCALE_TAG}$`);

interface AbilityScore {
	ab: string; // "STR"
	score: number;
	mod: string; // "+5" / "−1"
	save?: string; // "+6" (monster saving throw), when present
}

/** A monster stat block (the two-table "C" layout), built when type === 'monster'. */
export interface MonsterModel {
	type: string; // eyebrow, e.g. "Huge Dragon (metallic)"
	edition: string; // "5.5e"
	cr: string;
	ac: string;
	initiative: string;
	hp: string;
	hpFormula: string; // "16d12 + 80" — for the dice roller
	speed: string;
	abilities: AbilityScore[];
	hasSaves: boolean; // any save differs from its mod → show the save column
	band: [string, string][]; // Senses / Skills / Languages / Gear
	defenses: [string, string][]; // Resistances / Immunities / Vulnerabilities (accent)
}

/** A spell article (the "strip" layout: fixed-size effect block + casting cells). */
export interface SpellModel {
	edition: string;
	ritual: boolean;
	concentration: boolean;
	resChip: 'hit' | 'save' | 'auto' | 'util'; // reuse the spell-list resolution pill colours
	resLabel: string; // "DEX save" | "Attack roll" | "Automatic" | "Utility"
	dice: string; // "8d6" | "2d4" | "" (utility → grey "No roll")
	dmgType: string; // "fire" | "healing" | ""
	cells: [string, string][]; // Casting / Range / Duration / Components
	classes: string; // raw `classes` column (fallback when the access index isn't supplied)
	/** Classes that can take the spell, from the reverse UNION access index (inline ∪ spell_lists),
	 *  with provenance — `homebrew` = granted class-side (via spell_lists), not on the spell row. */
	availableTo?: { name: string; homebrew: boolean }[];
	higherLevel: string;
	material: string;
}

const withMetric = (range: string): string => {
	const m = range.match(/(\d+)\s*(?:feet|ft)\.?/i);
	if (!m) return range;
	const met = (Number(m[1]) * 0.3048).toFixed(1).replace(/\.0$/, '');
	return `${range} (${met} m)`;
};

function buildSpell(
	row: LoadedRowOf<'spell'>,
	availableTo?: SpellModel['availableTo'],
	locale = 'en'
): SpellModel {
	const d = row.data;
	const res = String(d.resolution ?? 'none');
	const dmg = String(d.damage ?? '');
	let dice = '';
	let dmgType = '';
	const dm = dmg.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(.*)/);
	if (dm) {
		dice = (dm[1] ?? '').replace(/\s/g, '');
		dmgType = (dm[2] ?? '').trim();
	} else if (res === 'auto') {
		const h = String(d.text_en ?? '').match(/(\d+d\d+)/);
		if (h) {
			dice = h[1] ?? '';
			dmgType = 'healing';
		}
	}
	const resChip =
		res === 'attack' ? 'hit' : res === 'save' ? 'save' : res === 'auto' ? 'auto' : 'util';
	const resLabel =
		res === 'attack'
			? 'Attack roll'
			: res === 'save'
				? `${String(d.save_ability ?? '').toUpperCase()} save`
				: res === 'auto'
					? 'Automatic'
					: 'Utility';
	const components = String(d.components ?? '')
		.replace(/,/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const conc = String(d.concentration) === 'true';
	return {
		edition: (Array.isArray(d.systems) ? d.systems : [d.systems]).filter(Boolean).join('/'),
		ritual: String(d.ritual) === 'true',
		concentration: conc,
		resChip,
		resLabel,
		dice,
		dmgType,
		cells: [
			['Casting', String(d.casting_time ?? '')],
			['Range', withMetric(String(d.range ?? ''))],
			[
				'Duration',
				conc && !/concentration/i.test(String(d.duration))
					? `Concentration · ${d.duration}`
					: String(d.duration ?? '')
			],
			['Components', components]
		].filter(([, v]) => v) as [string, string][],
		classes: String(d.classes ?? '')
			.split(',')
			.map((c) => cap(c.trim()))
			.filter(Boolean)
			.join(', '),
		...(availableTo ? { availableTo } : {}),
		higherLevel: localized(d, 'higher_level', locale),
		material: localized(d, 'material', locale)
	};
}

/** A row in the left-pane list (name + meta sub-line + the underlying content row). */
export interface Entry<T> {
	id: string;
	name: string;
	meta: string;
	edition: string; // "5e" | "5.5e" | "5e · 5.5e" — shown dimmed when >1 edition is active
	row: T;
}

/** Deep-link path to a compendium entry. `source` is IN the path (encoded) because a slug is unique
 *  only per TYPE, not across sources/editions ("fireball" exists in both 5e and 5.5e) — so the unique
 *  identity is type:source:id. `base` is the app base path ('' on desktop, the repo subpath on Pages).
 *  One builder shared by the compendium row-click and the command-palette jump so the URL can't drift. */
export function compendiumEntryPath(
	base: string,
	type: string,
	source: string,
	id: string
): string {
	return `${base}/compendium/${type}/${encodeURIComponent(source)}/${id}`;
}

/** User-facing label for a source tag — the raw "SRD 5.1 / 5.2.1" are too technical, show the
 *  game edition. The underlying `source` value stays exact (CC-BY attribution + identity); this is
 *  a DISPLAY map only. Unknown sources (homebrew, third-party) pass through unchanged. */
const SOURCE_LABELS: Record<string, string> = {
	'SRD 5.1': 'D&D 5e',
	'SRD 5.2.1': 'D&D 5.5e'
};
export function sourceLabel(source: string): string {
	return SOURCE_LABELS[source] ?? source;
}

/** Format a row's `systems` array as a short edition label. */
export function editionLabel(systems: unknown): string {
	const arr = Array.isArray(systems) ? systems.map(String) : systems ? [String(systems)] : [];
	return arr.join(' · ');
}

export interface DetailModel {
	eyebrow: string; // "Level 3 · Evocation" (spell) or the type name
	title: string;
	abilities: AbilityScore[]; // monster STR..CHA block (empty otherwise)
	meta: [string, string][]; // k/v cells (Casting time, Range, Components, Duration, …)
	bodyHtml: string; // text_en — rendered as HTML (content may contain markup)
	higherLevel: string; // higher_level, if any
	source: string; // attribution line
	license: string; // the file's #content-license (e.g. CC-BY-4.0), '' when the file declares none
	monster?: MonsterModel; // present for type === 'monster' → dedicated stat-block layout
	spell?: SpellModel; // present for type === 'spell' → dedicated spell layout
}

/** Build the dedicated monster stat block (vitals + abilities/saves + a derived band). */
function buildMonster(row: LoadedRowOf<'monster'>): MonsterModel {
	const d = row.data;
	const s = (k: RowColumn<'monster'>) => (d[k] == null || d[k] === '' ? '' : String(d[k]));
	const abilities: AbilityScore[] = ABILITY_IDS.map((a) => {
		const score = Number(d[a]);
		const raw = d[`${a}_save`];
		const save = raw == null ? undefined : Number(raw);
		return {
			ab: a.toUpperCase(),
			score,
			mod: signed(abilityModifier(score)),
			...(save == null ? {} : { save: signed(save) })
		};
	});
	const hasSaves = ABILITY_IDS.some((a) => {
		const raw = d[`${a}_save`];
		return raw != null && Number(raw) !== Math.floor((Number(d[a]) - 10) / 2);
	});
	const pair = (label: string, key: RowColumn<'monster'>): [string, string][] =>
		meaningful(d[key]) ? [[label, asText(d[key])]] : [];
	return {
		type: [d.size ? cap(String(d.size)) : '', d.creature_type ? cap(String(d.creature_type)) : '']
			.filter(Boolean)
			.join(' '),
		edition: (Array.isArray(d.systems) ? d.systems : [d.systems]).filter(Boolean).join('/'),
		cr: s('cr'),
		ac: s('ac'),
		initiative: s('initiative'),
		hp: s('hp'),
		hpFormula: s('hp_formula'),
		speed: s('speed'),
		abilities,
		hasSaves,
		band: [
			...pair('Senses', 'senses'),
			...pair('Skills', 'skills'),
			...pair('Languages', 'languages'),
			...pair('Gear', 'gear')
		],
		defenses: [
			...pair('Resistances', 'resistances'),
			...pair('Immunities', 'immunities'),
			...pair('Vulnerabilities', 'vulnerabilities')
		]
	};
}

/** Build the right-pane wiki detail model for a content row. `availableTo` (for spells) comes
 *  from the reverse access index, supplied by the caller that has the graph. */
export function buildDetail(
	row: LoadedRow,
	type: ContentType,
	availableTo?: SpellModel['availableTo'],
	locale = 'en'
): DetailModel {
	const d = row.data;
	if (row.type === 'monster') {
		return {
			eyebrow: '',
			title: localized(d, 'name', locale),
			abilities: [],
			meta: [],
			bodyHtml: localized(d, 'text', locale),
			higherLevel: '',
			source: `Source: ${sourceLabel(row.source)}`,
			license: row.license ?? '',
			monster: buildMonster(row)
		};
	}
	if (row.type === 'spell') {
		const spell = row.data;
		return {
			eyebrow: [
				Number(spell.level) === 0 ? 'Cantrip' : `Level ${spell.level}`,
				spell.school ? cap(String(spell.school)) : ''
			]
				.filter(Boolean)
				.join(' · '),
			title: localized(d, 'name', locale),
			abilities: [],
			meta: [],
			bodyHtml: localized(d, 'text', locale),
			higherLevel: localized(d, 'higher_level', locale),
			source: `Source: ${sourceLabel(row.source)}`,
			license: row.license ?? '',
			spell: buildSpell(row, availableTo, locale)
		};
	}
	// generic types carry no ability-score columns (only monster does, handled above), so the meta
	// grid is the whole story here — every non-identity, non-prose column becomes a k/v cell.
	const skip = new Set(COMMON);
	const eyebrow = cap(String(type));
	const meta = Object.entries(d)
		.filter(([k, v]) => !skip.has(k) && !PROSE_LOC.test(k) && meaningful(v))
		.map(([k, v]) => [cap(k), String(v) === 'true' ? 'Yes' : asText(v)] as [string, string]);

	return {
		eyebrow,
		title: localized(d, 'name', locale),
		abilities: [],
		meta,
		bodyHtml: localized(d, 'text', locale),
		higherLevel: localized(d, 'higher_level', locale),
		source: `Source: ${sourceLabel(row.source)}`,
		license: row.license ?? ''
	};
}

/** The small sub-line under an entry's name in the list. */
export function entryMeta(row: LoadedRow): string {
	if (row.type === 'spell') {
		const d = row.data;
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
	// item_type is usually more specific than category ("martial melee" vs "weapon"); drop the
	// broader one when it's already implied, so basic gear isn't "gear · adventuring gear". The
	// `in` checks read only the columns a row's type actually has — no cast onto the union.
	const data = row.data;
	const parts = [
		'category' in data ? String(data.category ?? '') : '',
		'item_type' in data ? String(data.item_type ?? '') : '',
		'rarity' in data ? String(data.rarity ?? '') : ''
	].filter(Boolean);
	return parts
		.filter(
			(p, i) =>
				!parts.some((q, j) => j !== i && q !== p && q.toLowerCase().includes(p.toLowerCase()))
		)
		.join(' · ');
}

/** Project grouped rows into the EntryList model: each group's rows become display Entries (id, name
 *  via `nameOf`, meta, edition, row). Shared by the compendium + spellbook lists so the row projection
 *  stays identical; the caller supplies the grouping and the name source (localized vs English). */
export function toEntryGroups(
	groups: { label: string; rows: LoadedRow[] }[],
	nameOf: (row: LoadedRow) => string
): { label: string; entries: Entry<LoadedRow>[] }[] {
	return groups.map((g) => ({
		label: g.label,
		entries: g.rows.map((r) => ({
			id: r.effectiveId,
			name: nameOf(r),
			meta: entryMeta(r),
			edition: editionLabel(r.systems),
			row: r
		}))
	}));
}

/** Group entries for the list — spells by level, everything else as one flat group. */
export function groupEntries(
	rows: LoadedRow[],
	type: ContentType
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
			label: level === 0 ? 'Cantrips' : `${ordinal(level)} level`,
			rows: byLevel.get(level) ?? []
		}));
}
