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

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

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

function buildSpell(row: LoadedRow, availableTo?: SpellModel['availableTo']): SpellModel {
	const d = row.data;
	const res = String(d.resolution ?? 'none');
	const dmg = String(d.damage ?? '');
	let dice = '';
	let dmgType = '';
	const dm = dmg.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(.*)/);
	if (dm) {
		dice = dm[1].replace(/\s/g, '');
		dmgType = dm[2].trim();
	} else if (res === 'auto') {
		const h = String(d.text_en ?? '').match(/(\d+d\d+)/);
		if (h) {
			dice = h[1];
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
		availableTo,
		higherLevel: String(d.higher_level ?? ''),
		material: String(d.material ?? '')
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
	monster?: MonsterModel; // present for type === 'monster' → dedicated stat-block layout
	spell?: SpellModel; // present for type === 'spell' → dedicated spell layout
}

/** Build the dedicated monster stat block (vitals + abilities/saves + a derived band). */
function buildMonster(row: LoadedRow): MonsterModel {
	const d = row.data;
	const s = (k: string) => (d[k] == null || d[k] === '' ? '' : String(d[k]));
	const abilities: AbilityScore[] = ABILS.map((a) => {
		const score = Number(d[a]);
		const raw = d[`${a}_save`];
		const save = raw === '' || raw == null ? undefined : Number(raw);
		return {
			ab: a.toUpperCase(),
			score,
			mod: abilMod(score),
			save: save == null ? undefined : signed(save)
		};
	});
	const hasSaves = ABILS.some((a) => {
		const raw = d[`${a}_save`];
		return raw !== '' && raw != null && Number(raw) !== Math.floor((Number(d[a]) - 10) / 2);
	});
	const pair = (label: string, key: string): [string, string][] =>
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
	availableTo?: SpellModel['availableTo']
): DetailModel {
	const d = row.data;
	if (type === 'monster') {
		return {
			eyebrow: '',
			title: String(d.name_en),
			abilities: [],
			meta: [],
			bodyHtml: String(d.text_en ?? ''),
			higherLevel: '',
			source: `Source: ${sourceLabel(row.source)}`,
			monster: buildMonster(row)
		};
	}
	if (type === 'spell') {
		return {
			eyebrow: [
				Number(d.level) === 0 ? 'Cantrip' : `Level ${d.level}`,
				d.school ? cap(String(d.school)) : ''
			]
				.filter(Boolean)
				.join(' · '),
			title: String(d.name_en),
			abilities: [],
			meta: [],
			bodyHtml: String(d.text_en ?? ''),
			higherLevel: String(d.higher_level ?? ''),
			source: `Source: ${sourceLabel(row.source)}`,
			spell: buildSpell(row, availableTo)
		};
	}
	const skip = new Set(COMMON);
	const eyebrow = cap(String(type));
	// monster ability scores → a compact 3×2 block, kept out of the generic meta grid
	const abilities: AbilityScore[] = ABILS.filter((a) => meaningful(d[a])).map((a) => ({
		ab: a.toUpperCase(),
		score: Number(d[a]),
		mod: abilMod(Number(d[a]))
	}));
	if (abilities.length) ABILS.forEach((a) => skip.add(a));

	const meta = Object.entries(d)
		.filter(([k, v]) => !skip.has(k) && meaningful(v))
		.map(([k, v]) => [cap(k), String(v) === 'true' ? 'Yes' : asText(v)] as [string, string]);

	return {
		eyebrow,
		title: String(d.name_en),
		abilities,
		meta,
		bodyHtml: String(d.text_en ?? ''),
		higherLevel: String(d.higher_level ?? ''),
		source: `Source: ${sourceLabel(row.source)}`
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
	// item_type is usually more specific than category ("martial melee" vs "weapon"); drop the
	// broader one when it's already implied, so basic gear isn't "gear · adventuring gear"
	const parts = [d.category, d.item_type, d.rarity]
		.map((x) => (x ? String(x) : ''))
		.filter(Boolean);
	return parts
		.filter(
			(p, i) =>
				!parts.some((q, j) => j !== i && q !== p && q.toLowerCase().includes(p.toLowerCase()))
		)
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
