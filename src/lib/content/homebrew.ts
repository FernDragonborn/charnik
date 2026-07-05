/*
 * Homebrew authoring pipeline — turn a form draft into a validated CSV row and write it into the
 * user's homebrew content root (the "everything is doable from the UI" invariant, docs/PLAN.md).
 *
 * The mechanics are pure/testable; only `saveHomebrewRow` touches Storage. A draft is a flat
 * `Record<string,string>` of CSV cell values (the form binds to it); we validate it through the
 * SAME zod schema the loader uses (`parseRow`), so a saved row is by construction a loadable row.
 * Writes go through the writable user Storage — IndexedDB on web, Tauri fs on desktop — never the
 * bundled SRD (we only ever write files we created). CSV is emitted UTF-8-BOM + CRLF (Excel/Cyrillic
 * safety) and the whole file is rewritten atomically (Storage.write is temp→rename in real impls).
 */
import Papa from 'papaparse';
import type { Storage } from '$lib/storage/types';
import {
	CONTENT_TYPES,
	parseRow,
	EFFECT_KINDS,
	SIZES,
	ABILITIES,
	HIT_DICE,
	CASTER_TYPES,
	CASTER_SHARES,
	PREPARE_STYLES,
	SCHOOLS,
	RESOLUTIONS,
	ITEM_CATEGORIES,
	RARITIES,
	FEAT_CATEGORIES,
	type ContentType
} from './schemas';
import type { z } from 'zod';

/** The content root user homebrew is written to (a source merged into the graph like any other). */
export const HOMEBREW_ROOT = 'content/homebrew';
/** The source tag every homebrew row carries. */
export const HOMEBREW_SOURCE = 'Homebrew';

export type FieldKind = 'text' | 'textarea' | 'number' | 'bool' | 'enum' | 'systems' | 'slug';

export interface FieldDesc {
	name: string;
	label: string;
	kind: FieldKind;
	options?: readonly string[];
	required: boolean;
}

/** Enum-valued columns → their option list (single-sourced from the schemas). */
const ENUM_OPTS: Record<string, readonly string[]> = {
	size: SIZES,
	hit_die: HIT_DICE,
	caster: CASTER_TYPES,
	caster_share: CASTER_SHARES,
	prepare_style: PREPARE_STYLES,
	school: SCHOOLS,
	resolution: RESOLUTIONS,
	category: ITEM_CATEGORIES,
	rarity: RARITIES,
	save_ability: ABILITIES,
	spell_ability: ABILITIES,
	kind: EFFECT_KINDS,
	category_feat: FEAT_CATEGORIES // feat.category (disambiguated below)
};
const BOOL_FIELDS = new Set([
	'concentration',
	'ritual',
	'attunement',
	'stealth_disadvantage',
	'negative',
	'repeatable'
]);
const NUMBER_FIELDS = new Set([
	'speed',
	'level',
	'subclass_level',
	'skills_choose',
	'languages',
	'weight_lb',
	'ac',
	'str_min',
	'caster_from_level',
	'cantrips_known',
	'prepared_known',
	'duration_rounds'
]);

// nicer labels (mirror the compendium's), falling back to Title Case of the column name
const LABELS: Record<string, string> = {
	name_en: 'Name',
	name_uk: 'Name (uk)',
	text_en: 'Description',
	text_uk: 'Description (uk)',
	hit_die: 'Hit die',
	primary_ability: 'Primary ability',
	spell_ability: 'Spellcasting ability',
	save_ability: 'Save',
	item_type: 'Type',
	weight_lb: 'Weight (lb)',
	armor_dex_cap: 'Dex cap',
	str_min: 'Str min',
	casting_time: 'Casting time',
	higher_level: 'At higher levels',
	creature_type: 'Creature type',
	skills_choose: 'Skill choices',
	skills_from: 'Skill list',
	subclass_level: 'Subclass at level',
	caster_share: 'Caster share (multiclass)',
	caster_from_level: 'Casting from level',
	prepare_style: 'Prepare style'
};
const label = (name: string): string =>
	LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

function kindOf(type: ContentType, name: string): FieldKind {
	if (name === 'systems') return 'systems';
	if (name === 'id') return 'slug';
	if (name === 'text_en' || name === 'text_uk') return 'textarea';
	if (name === 'category' && type === 'feat') return 'enum';
	if (ENUM_OPTS[name]) return 'enum';
	if (BOOL_FIELDS.has(name)) return 'bool';
	if (NUMBER_FIELDS.has(name)) return 'number';
	return 'text';
}
function optionsOf(type: ContentType, name: string): readonly string[] | undefined {
	if (name === 'category' && type === 'feat') return ENUM_OPTS.category_feat;
	return ENUM_OPTS[name];
}

/** Canonical column order for a type = its schema's declared field order. */
export function columnsFor(type: ContentType): string[] {
	const shape = (CONTENT_TYPES[type].schema as z.ZodObject).shape as Record<string, unknown>;
	return Object.keys(shape);
}

/** Every editable field for a type, in schema order, with the input kind the form should render. */
export function fieldsFor(type: ContentType): FieldDesc[] {
	return columnsFor(type)
		.filter((name) => name !== 'source') // source is fixed to Homebrew
		.map((name) => {
			const options = optionsOf(type, name);
			return {
				name,
				label: label(name),
				kind: kindOf(type, name),
				...(options ? { options } : {}),
				required: name === 'name_en' || name === 'systems'
			};
		});
}

/** A blank draft for a type (all cells empty; systems defaults to nothing until the user picks). */
export function blankDraft(type: ContentType): Record<string, string> {
	const d: Record<string, string> = {};
	for (const name of columnsFor(type)) d[name] = '';
	return d;
}

/** Slugify a display name into an id (lowercase, a-z0-9 + hyphens) — matches the loader's id rule. */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Which file a type's homebrew rows live in (e.g. `content/homebrew/items_hb.csv`). */
export function homebrewFile(type: ContentType): string {
	return `${HOMEBREW_ROOT}/${CONTENT_TYPES[type].filebase}_hb.csv`;
}

export interface SaveResult {
	ok: boolean;
	/** The final id written (may be de-duplicated), when ok. */
	id?: string;
	/** Validation problems ("path: message"), when not ok. */
	issues?: string[];
}

/** Fill identity + validate a draft against the type's schema. Returns the row object (all columns)
 *  ready for unparse, or the validation issues. `id` is auto-slugged from the name when blank. */
export function buildRow(
	type: ContentType,
	draft: Record<string, string>,
	existingIds: Set<string> = new Set()
): { ok: true; row: Record<string, string> } | { ok: false; issues: string[] } {
	const cols = columnsFor(type);
	const row: Record<string, string> = {};
	for (const c of cols) row[c] = (draft[c] ?? '').trim();
	row.source = HOMEBREW_SOURCE;
	if (!row.id) row.id = slugify(row.name_en ?? '');
	// de-duplicate the id within the homebrew file so two "My Item"s coexist
	if (row.id && existingIds.has(row.id)) {
		let n = 2;
		while (existingIds.has(`${row.id}-${n}`)) n++;
		row.id = `${row.id}-${n}`;
	}
	const res = parseRow(type, row);
	if (!res.success) {
		return {
			ok: false,
			issues: res.error.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`)
		};
	}
	return { ok: true, row };
}

/** UTF-8 byte-order mark — prepended to CSV writes (Excel/Cyrillic safety, per the invariant). */
const BOM = String.fromCharCode(0xfeff);

/** Emit CSV text (UTF-8 BOM + CRLF) for a header + rows, with a fixed column order. */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
	return BOM + Papa.unparse({ fields: columns, data: rows }, { newline: '\r\n' });
}

/**
 * Validate a draft and append it to its homebrew CSV (rewriting the file atomically). Reads any
 * existing rows first so ids stay unique and the file keeps a stable column order. Returns the
 * saved id or the validation issues; never throws on invalid input.
 */
export async function saveHomebrewRow(
	storage: Storage,
	type: ContentType,
	draft: Record<string, string>
): Promise<SaveResult> {
	const file = homebrewFile(type);
	const columns = columnsFor(type);

	// existing rows (if the file exists) — to keep ids unique and preserve prior entries
	let existing: Record<string, string>[] = [];
	if (await storage.exists(file)) {
		const prev = Papa.parse<Record<string, string>>(await storage.read(file), {
			header: true,
			skipEmptyLines: true
		});
		existing = prev.data;
	}
	const existingIds = new Set(existing.map((r) => r.id).filter(Boolean));

	const built = buildRow(type, draft, existingIds);
	if (!built.ok) return { ok: false, issues: built.issues };

	await storage.write(file, toCsv(columns, [...existing, built.row]));
	return { ok: true, id: built.row.id };
}
