/*
 * Pure "content → view" helpers shared by the Compendium and the Spellbook (both are the
 * same two-pane shape: a grouped list + a wiki detail rendered from the CSV row). No Svelte —
 * unit-testable. This is the DETAIL half, which WikiDetail renders; the list half is `entry-list.ts`.
 */
import { LOCALE_TAG, type LoadedRow, type LoadedRowOf } from '$lib/content/loader';
import { asText, signed, titleCase } from '$lib/util/format';
import { ABILITY_IDS, abilityModifier } from '$lib/rules/core';
import { costSaid } from '$lib/rules/currency';
import type { ContentType, RowColumn } from '$lib/content/schemas';
import { cellText, localizedCell } from './prose';
import type { Said, SaidText } from '$lib/util/say';
import { packNameOf } from './disk';
import { ITEM_TAG, parseBonusChoices, parseItemTags } from './item-tags';

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
	'higher_level',
]);

/** What a COLUMN is called, as a meta-cell heading: the `contentField` catalog, with the column's
 *  own name title-cased as the fallback — a homebrew column reads as its author wrote it rather than
 *  as a missing key. The same catalog the homebrew form labels its inputs from. */
const fieldLabel = (column: string): SaidText => ({
	key: `contentField.${column}`,
	fallback: titleCase(column),
});

/** Tags that keep a cell of their own, so folding eight item columns into one did not cost the
 *  detail view its vocabulary — an armour still says "STR min 15", not a word buried in a list.
 *  Everything else joins one "Properties" cell. The words come from `itemTag`, the one catalog that
 *  names a tag (`content/item-tags.ts`). */
const CELL_TAGS = new Set([
	'ac',
	'dex_cap',
	'str_min',
	'armor',
	'mastery',
	'range',
	'ammo',
	'stealth_disadvantage',
	'attunement',
]);
/** What a labelled tag with no value says, where plain "Yes" would be less than the column said. */
const BARE_TAG_VALUE: Record<string, string> = {
	stealth_disadvantage: 'contentValue.disadvantage',
	attunement: 'contentValue.required',
};

/** A tag's own word: the `itemTag` catalog, with the raw name as the fallback — the same lookup the
 *  attack row's kind line makes, so a tag reads identically in both places. */
const tagWord = (name: string): SaidText => ({ key: `itemTag.${name}`, fallback: name });

/** An item's `tags` cell → meta cells. A tag's VALUE is data unless it is itself a tag word
 *  (`armor:heavy`), which the same lookup covers: `mastery:nick` finds no entry and reads "nick".
 *
 *  A property word a pack DESCRIBES (`propertyRows`, word → its `weapon_property` row) brings that
 *  row with its cell: the mastery reads as the row's own name, and the cell can say what each word
 *  in it does. */
function tagCells(
	raw: unknown,
	propertyRows: ReadonlyMap<string, LoadedRow>,
	locale: string,
): MetaCell[] {
	const labelled: MetaCell[] = [];
	const properties: string[] = [];
	const propertyRules: LoadedRow[] = [];
	for (const [name, value] of parseItemTags(raw)) {
		const rule = propertyRows.get(name === ITEM_TAG.mastery ? value : name);
		if (name === ITEM_TAG.mastery && rule)
			labelled.push([tagWord(name), localizedName(rule, locale), [rule]]);
		else if (CELL_TAGS.has(name))
			labelled.push([
				tagWord(name),
				value
					? {
							// an armour's WEIGHT is its own word: "heavy" agrees with a different noun than a
							// heavy weapon's does, and only one of the two can win a shared key
							key: name === ITEM_TAG.armor ? `armorCategory.${value}` : `itemTag.${value}`,
							fallback: titleCase(value),
						}
					: { key: BARE_TAG_VALUE[name] ?? 'contentValue.yes', fallback: 'Yes' },
			]);
		else {
			properties.push(value ? `${titleCase(name)} (${value})` : titleCase(name));
			if (rule) propertyRules.push(rule);
		}
	}
	return properties.length
		? [[fieldLabel('properties'), properties.join(', '), propertyRules], ...labelled]
		: labelled;
}
const nonEmpty = (v: unknown) => v !== '' && v != null && !(Array.isArray(v) && v.length === 0);
// skip noisy negative/placeholder values ("false", "none", "0") from the meta grid
const meaningful = (v: unknown) => nonEmpty(v) && !/^(false|none|0)$/i.test(String(v));

// Prose columns are localized `<base>_<loc>` — the read itself lives in `./prose`. PROSE_LOC matches
// the suffixed variants so the meta grid can skip them (they're rendered as prose, not as k/v cells).
const localized = localizedCell;

/** A content row's display NAME in `locale`, falling back to EN then the id (AUDIT F9 — the one
 *  localized-name reader). NB translate view deliberately does NOT use this (it wants an empty
 *  string, not an EN fallback, to mark "not yet translated"). */
export const localizedName = (row: LoadedRow, locale: string): string =>
	String(row.data[`name_${locale}`] || row.data.name_en || row.id);

const PROSE_LOC = new RegExp(`^(?:name|text|material|higher_level)_${LOCALE_TAG}$`);

/** One k/v cell: what it is called (always a catalog entry) and what it says — a catalog entry when
 *  the word is the app's own vocabulary, the row's own text when it is data — and, where the words
 *  in it are defined by rows of their own, those rows, for the view to explain the cell with. */
type MetaCell = [label: SaidText, value: Said, explainedBy?: LoadedRow[]];

interface AbilityScore {
	/** The ability id (`str`) — `abilityShortLabel` gives it the reader's word for it. */
	ab: string;
	score: number;
	mod: string; // "+5" / "−1"
	save?: string; // "+6" (monster saving throw), when present
}

/** A monster stat block (the two-table "C" layout), built when type === 'monster'. */
export interface MonsterModel {
	type: Said[]; // eyebrow, e.g. "Huge" + "Dragon (metallic)"
	edition: string; // "5.5e"
	cr: string;
	ac: string;
	initiative: string;
	hp: string;
	hpFormula: string; // "16d12 + 80" — for the dice roller
	speed: string;
	abilities: AbilityScore[];
	hasSaves: boolean; // any save differs from its mod → show the save column
	band: MetaCell[]; // Senses / Skills / Languages / Gear
	defenses: MetaCell[]; // Resistances / Immunities / Vulnerabilities (accent)
}

/** A spell article (the "strip" layout: fixed-size effect block + casting cells). */
export interface SpellModel {
	edition: string;
	ritual: boolean;
	concentration: boolean;
	resChip: 'hit' | 'save' | 'auto' | 'util'; // reuse the spell-list resolution pill colours
	resLabel: SaidText; // "DEX save" | "Attack roll" | "Automatic" | "Utility"
	dice: string; // "8d6" | "2d4" | "" (utility → grey "No roll")
	dmgType: string; // "fire" | "healing" | ""
	cells: MetaCell[]; // Casting / Range / Duration / Components
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

type SpellData = LoadedRowOf<'spell'>['data'];

/** resolution → the short chip label (fallback "util"). */
const RES_CHIP: Record<string, SpellModel['resChip']> = {
	attack: 'hit',
	save: 'save',
	auto: 'auto',
};

/** resolution → the full label; a save shows its ability, through the key that already names it. */
function resolutionLabel(res: string, saveAbility: string): SaidText {
	if (res === 'save') return { key: `combat.roll.save.${saveAbility.toLowerCase()}` };
	return { key: `spellResolution.${res === 'attack' || res === 'auto' ? res : 'utility'}` };
}

/** A spell's damage/heal dice + type, from the `damage` column ("8d6 fire") and nowhere else. Empty
 *  when the column is: a healing spell that never declares its die shows none, rather than the first
 *  die its prose happens to mention. */
function spellDamage(d: SpellData): { dice: string; dmgType: string } {
	const dm = (d.damage ?? '').match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(.*)/);
	if (!dm) return { dice: '', dmgType: '' };
	return { dice: (dm[1] ?? '').replace(/\s/g, ''), dmgType: (dm[2] ?? '').trim() };
}

function buildSpell(
	row: LoadedRowOf<'spell'>,
	availableTo?: SpellModel['availableTo'],
	locale = 'en',
): SpellModel {
	const d = row.data;
	const res = d.resolution ?? 'none';
	const { dice, dmgType } = spellDamage(d);
	const components = (d.components ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
	const conc = d.concentration ?? false;
	return {
		edition: (Array.isArray(d.systems) ? d.systems : [d.systems]).filter(Boolean).join('/'),
		ritual: d.ritual ?? false,
		concentration: conc,
		resChip: RES_CHIP[res] ?? 'util',
		resLabel: resolutionLabel(res, d.save_ability ?? ''),
		dice,
		dmgType,
		cells: (
			[
				[fieldLabel('casting_time'), d.casting_time ?? ''],
				[fieldLabel('range'), withMetric(d.range ?? '')],
				[
					fieldLabel('duration'),
					conc && !/concentration/i.test(d.duration ?? '')
						? {
								key: 'contentValue.concentrationFor',
								values: { duration: String(d.duration) },
								fallback: `Concentration · ${String(d.duration)}`,
							}
						: (d.duration ?? ''),
				],
				[fieldLabel('components'), components],
			] as MetaCell[]
		).filter(([, v]) => v),
		// the raw `classes` column: ids a pack wrote, so they are its words, not the app's
		classes: (d.classes ?? '')
			.split(',')
			.map((c) => titleCase(c.trim()))
			.filter(Boolean)
			.join(', '),
		...(availableTo ? { availableTo } : {}),
		higherLevel: localized(d, 'higher_level', locale),
		material: localized(d, 'material', locale),
	};
}

/** Deep-link path to a compendium entry. `source` is IN the path (encoded) because a slug is unique
 *  only per TYPE, not across sources/editions ("fireball" exists in both 5e and 5.5e) — so the unique
 *  identity is type:source:id. `base` is the app base path ('' on desktop, the repo subpath on Pages).
 *  One builder shared by the compendium row-click and the command-palette jump so the URL can't drift. */
export function compendiumEntryPath(
	base: string,
	type: string,
	source: string,
	id: string,
): string {
	return `${base}/compendium/${type}/${encodeURIComponent(source)}/${id}`;
}

/** User-facing label for a source tag — the raw "SRD 5.1 / 5.2.1" are too technical, show the
 *  game edition. The underlying `source` value stays exact (CC-BY attribution + identity); this is
 *  a DISPLAY map only. Unknown sources (homebrew, third-party) pass through unchanged. */
const SOURCE_LABELS: Record<string, string> = {
	'SRD 5.1': 'D&D 5e',
	'SRD 5.2.1': 'D&D 5.5e',
};
export function sourceLabel(source: string): string {
	return SOURCE_LABELS[source] ?? source;
}

/** Format a row's `systems` array as a short edition label. */
export function editionLabel(systems: unknown): string {
	const arr = Array.isArray(systems)
		? systems.map((s: unknown) => asText(s))
		: [asText(systems)].filter(Boolean);
	return arr.join(' · ');
}

export interface DetailModel {
	/** The row this was built from (`type:source:id`) — what a per-row preference is keyed by, and
	 *  what tells two editions of the same article apart. */
	rowId: string;
	/** The content locale the article was built in — what the view reads any further prose in. */
	locale: string;
	eyebrow: Said[]; // "Level 3" + "Evocation" (spell), or the type name — joined by the view
	title: string;
	abilities: AbilityScore[]; // monster STR..CHA block (empty otherwise)
	meta: MetaCell[]; // k/v cells (Casting time, Range, Components, Duration, …)
	bodyHtml: string; // text_en — rendered as HTML (content may contain markup)
	higherLevel: string; // higher_level, if any
	source: SaidText; // attribution line
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
			ab: a,
			score,
			mod: signed(abilityModifier(score)),
			...(save == null ? {} : { save: signed(save) }),
		};
	});
	const hasSaves = ABILITY_IDS.some((a) => {
		const raw = d[`${a}_save`];
		return raw != null && Number(raw) !== Math.floor((Number(d[a]) - 10) / 2);
	});
	const pair = (key: RowColumn<'monster'>): MetaCell[] =>
		meaningful(d[key]) ? [[fieldLabel(key), cellText(d[key])]] : [];
	return {
		// a size is a closed vocabulary the app already names; a creature type is the row's own word
		type: [
			d.size ? { key: `creatureSize.${String(d.size)}`, fallback: titleCase(String(d.size)) } : '',
			d.creature_type ? titleCase(String(d.creature_type)) : '',
		].filter(Boolean),
		edition: (Array.isArray(d.systems) ? d.systems : [d.systems]).filter(Boolean).join('/'),
		cr: s('cr'),
		ac: s('ac'),
		initiative: s('initiative'),
		hp: s('hp'),
		hpFormula: s('hp_formula'),
		speed: s('speed'),
		abilities,
		hasSaves,
		band: [...pair('senses'), ...pair('skills'), ...pair('languages'), ...pair('gear')],
		defenses: [
			...pair('resistances'),
			...pair('immunities'),
			...pair('condition_immunities'),
			...pair('vulnerabilities'),
		],
	};
}

/** What `buildDetail` is told beyond the row — each of it by a caller that has the graph. */
export interface DetailContext {
	locale?: string;
	/** For a spell: the classes that can take it, from the reverse access index. */
	availableTo?: SpellModel['availableTo'];
	/** For an item: property word → the `weapon_property` row that says what it does, in the item's
	 *  own edition (`weaponPropertyRowsFor`). */
	propertyRows?: ReadonlyMap<string, LoadedRow>;
}

const NO_PROPERTY_ROWS: ReadonlyMap<string, LoadedRow> = new Map();

/** Build the right-pane wiki detail model for a content row. */
export function buildDetail(
	row: LoadedRow,
	type: ContentType,
	{ locale = 'en', availableTo, propertyRows = NO_PROPERTY_ROWS }: DetailContext = {},
): DetailModel {
	const d = row.data;
	// fields every type's DetailModel shares (title/prose/attribution); the branch adds its own
	// eyebrow/meta/higherLevel + the dedicated monster/spell block.
	const common = {
		rowId: row.effectiveId,
		locale,
		title: localized(d, 'name', locale),
		abilities: [] as AbilityScore[],
		bodyHtml: localized(d, 'text', locale),
		// The PACK is named beside the source tag, because the tag is not proof of anything: a pack
		// declares its own `#content-source`, so one stamping `SRD 5.2.1` renders as "D&D 5.5e" exactly
		// like the shipped SRD does. The folder it came from is the fact the app actually knows.
		source: {
			key: 'compendium.sourceLine',
			values: { source: sourceLabel(row.source), pack: packNameOf(row.root) },
			fallback: `Source: ${sourceLabel(row.source)} · ${packNameOf(row.root)}`,
		},
		license: row.license ?? '',
	};
	if (row.type === 'monster')
		return { ...common, eyebrow: [], meta: [], higherLevel: '', monster: buildMonster(row) };
	if (row.type === 'spell') {
		const spell = row.data;
		return {
			...common,
			eyebrow: [
				Number(spell.level) === 0
					? { key: 'compendium.levelCantrip', fallback: 'Cantrip' }
					: {
							key: 'compendium.levelNth',
							values: { level: Number(spell.level) },
							fallback: `Level ${String(spell.level)}`,
						},
				...(spell.school
					? [
							{
								key: `spellSchool.${String(spell.school).toLowerCase()}`,
								fallback: titleCase(String(spell.school)),
							},
						]
					: []),
			],
			meta: [],
			higherLevel: localized(d, 'higher_level', locale),
			spell: buildSpell(row, availableTo, locale),
		};
	}
	// generic types carry no ability-score columns (only monster does, handled above), so the meta
	// grid is the whole story here — every non-identity, non-prose column becomes a k/v cell.
	const skip = new Set(COMMON);
	// A `+1/+2/+3` row is one entry and three items, and its rarity is the rung's: the row's own
	// `rarity` can state only one of them, so where the ladder states each, the ladder is what is
	// said — one cell per rung, in place of a single rarity that is wrong for the other two and of
	// the column's raw grammar.
	const rungs = parseBonusChoices('bonus_choice' in d ? asText(d.bonus_choice) : '').filter(
		(rung) => rung.rarity,
	);
	if (rungs.length) for (const column of ['rarity', 'bonus_choice']) skip.add(column);
	const rungCells = rungs.map((rung): MetaCell => [
		{ key: 'contentField.rarityAtBonus', values: { bonus: rung.bonus } },
		{ key: `itemRarity.${rung.rarity ?? ''}`, fallback: titleCase(rung.rarity ?? '') },
	]);
	const meta = Object.entries(d)
		.filter(([k, v]) => !skip.has(k) && !PROSE_LOC.test(k) && meaningful(v))
		.flatMap(([k, v]): MetaCell[] =>
			k === 'tags'
				? tagCells(v, propertyRows, locale)
				: k === 'cost'
					? [[fieldLabel(k), costSaid(v)]]
					: [
							[
								fieldLabel(k),
								asText(v) === 'true' ? { key: 'contentValue.yes', fallback: 'Yes' } : cellText(v),
							],
						],
		)
		.concat(rungCells);
	return {
		...common,
		eyebrow: [{ key: `contentType.${type}`, fallback: titleCase(type) }],
		meta,
		higherLevel: localized(d, 'higher_level', locale),
	};
}
