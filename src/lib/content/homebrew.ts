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
import type { LoadedRow } from './loader';
import { parseContentDirectives, stampDirectives, type MetaKey } from './meta';
import { hashBody } from './hash';
import { slugify } from '$lib/util/slug';
import { titleCase } from '$lib/util/format';
import { CONTENT_SCHEMA_VERSION } from '$lib/schema/version';
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

type FieldKind = 'text' | 'textarea' | 'number' | 'bool' | 'enum' | 'systems' | 'slug';

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
const label = (name: string): string => LABELS[name] ?? titleCase(name);

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
function columnsFor(type: ContentType): string[] {
	const shape = (CONTENT_TYPES[type].schema as z.ZodObject).shape as Record<string, unknown>;
	return Object.keys(shape);
}

/** Column order for a rewrite: schema columns first, then any extra columns present in `rows`
 *  (localized prose, etc.) so writing back never drops columns the loader would otherwise keep. */
function columnsWithExtras(type: ContentType, rows: Record<string, string>[]): string[] {
	const cols = columnsFor(type);
	const extras = [...new Set(rows.flatMap(Object.keys))].filter((c) => !cols.includes(c));
	return [...cols, ...extras];
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
/** Which file a type's homebrew rows live in (e.g. `content/homebrew/items_hb.csv`). */
export function homebrewFile(type: ContentType): string {
	return `${HOMEBREW_ROOT}/${CONTENT_TYPES[type].filebase}_hb.csv`;
}

/** A new homebrew file for a type + a user-chosen name part — always in the safe homebrew root. */
export function newHomebrewFile(type: ContentType, namePart: string): string {
	return `${HOMEBREW_ROOT}/${CONTENT_TYPES[type].filebase}_${slugify(namePart) || 'custom'}.csv`;
}

/** True when `file` ships with the app (lives under a seeded content root), so an update can
 *  overwrite it → unsafe to write. Root-based on the passed `shippedRoots` (provider's CONTENT_ROOTS),
 *  so it extends to any FUTURE default pack we ship — not hardcoded to SRD. */
export function isShippedFile(file: string, shippedRoots: readonly string[]): boolean {
	return shippedRoots.some((r) => file === r || file.startsWith(`${r}/`));
}

export interface TargetFile {
	/** dataDir-relative CSV path a homebrew row can be saved to. */
	file: string;
	/** true when the file ships with the app (writing there warns; a Charnik update may clobber it). */
	shipped: boolean;
}

/** Existing CSV files that can hold `type` (filename matches its filebase), across the shipped roots +
 *  the homebrew root — the choices offered for WHERE to save a homebrew row. */
export async function listTypeTargets(
	storage: Storage,
	type: ContentType,
	shippedRoots: readonly string[]
): Promise<TargetFile[]> {
	const fb = CONTENT_TYPES[type].filebase;
	const out: TargetFile[] = [];
	for (const root of [...shippedRoots, HOMEBREW_ROOT]) {
		for (const e of await storage.list(root)) {
			if (e.isDir || !e.name.endsWith('.csv')) continue;
			const base = e.name.replace(/\.csv$/, '');
			if (base === fb || base.startsWith(`${fb}_`))
				out.push({ file: e.path, shipped: isShippedFile(e.path, shippedRoots) });
		}
	}
	return out;
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
function buildRow(
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

/** `buildRow` + carry over any columns the schema doesn't declare (localized prose like `text_uk`,
 *  `material_de`, …) that the strict build drops. Used by EVERY write path so a new row preserves its
 *  extra columns exactly like an edited one — otherwise a fresh homebrew entry could silently lose a
 *  translation column the loader would have kept. */
function buildRowWithExtras(
	type: ContentType,
	draft: Record<string, string>,
	existingIds: Set<string>
): { ok: true; row: Record<string, string> } | { ok: false; issues: string[] } {
	const built = buildRow(type, draft, existingIds);
	if (!built.ok) return built;
	const row = { ...built.row };
	for (const [k, v] of Object.entries(draft)) if (!(k in row)) row[k] = (v ?? '').trim();
	return { ok: true, row };
}

/** Seed an editor draft from an existing row — every column as a string cell (`systems` from the
 *  stamped `row.systems`, arrays joined). Copies ALL of `row.data`, incl. locale-prose columns beyond
 *  the schema (name_uk/text_uk/…), so an edit round-trips without dropping them. */
export function rowToDraft(row: LoadedRow): Record<string, string> {
	const d = blankDraft(row.type);
	for (const [k, v] of Object.entries(row.data as Record<string, unknown>)) {
		if (k === 'source') continue;
		d[k] = v == null ? '' : Array.isArray(v) ? v.join(',') : String(v);
	}
	d.systems = row.systems.join(',');
	d.id = row.id;
	return d;
}

/**
 * Editor-mode save (UPSERT). Validates the edited draft, then REPLACES the same-id row in `targetFile`
 * (or appends it). Homebrew authoring forces `source=Homebrew`, so editing a shipped SRD row and
 * pointing `targetFile` at the homebrew CSV forks it (same id → sorts above the original via
 * `compareRows`); editing a homebrew row in its own file edits in place. Columns beyond the schema
 * (localized prose, etc.) present in the file or the draft are preserved, never dropped.
 */
export async function upsertHomebrewRow(
	storage: Storage,
	type: ContentType,
	draft: Record<string, string>,
	targetFile: string = homebrewFile(type)
): Promise<SaveResult> {
	const id = (draft.id ?? '').trim() || slugify(draft.name_en ?? '');

	const { rows: existing, directives } = await readHomebrewFile(storage, targetFile);

	// validate through the schema (buildRow forces source + slugs a blank id); pass no existingIds so
	// the id is KEPT (an upsert reuses it), not de-duplicated like a fresh add.
	const built = buildRowWithExtras(type, { ...draft, id }, new Set());
	if (!built.ok) return { ok: false, issues: built.issues };
	const finalRow = built.row;

	const columns = columnsWithExtras(type, [...existing, finalRow]);

	const idx = existing.findIndex((r) => r.id === id);
	if (idx >= 0) existing[idx] = finalRow;
	else existing.push(finalRow);

	await writeStampedHomebrew(storage, targetFile, columns, existing, directives);
	return { ok: true, id };
}

/** Delete a homebrew row (by id) from its CSV — the only content the app may remove (never a shipped
 *  file). Rewrites the file without that row (re-stamping the header); if it was the file's last row,
 *  the whole file is removed. No-op if absent. (A fork doesn't hide the shipped original by default —
 *  both coexist, homebrew just sorts on top — so removing it changes nothing about the original.) */
export async function removeHomebrewRow(
	storage: Storage,
	type: ContentType,
	targetFile: string,
	id: string
): Promise<void> {
	if (!(await storage.exists(targetFile))) return;
	const { rows, directives } = await readHomebrewFile(storage, targetFile);
	const remaining = rows.filter((r) => r.id !== id);
	if (remaining.length === rows.length) return; // nothing matched
	if (remaining.length === 0) {
		await storage.remove(targetFile); // last row gone → drop the empty file
		return;
	}
	const columns = columnsWithExtras(type, remaining);
	await writeStampedHomebrew(storage, targetFile, columns, remaining, directives);
}

/** Default license stamped on app-authored homebrew. "Custom" = the user's own content on their own
 *  terms — not presuming an open license on their work; they can refine it via the content-metadata
 *  dialog. Only needs to be PRESENT so the metadata-check pop-up doesn't nag on every save. */
const HOMEBREW_LICENSE = 'Custom';

/**
 * Write a homebrew CSV WITH a `#content-*` header, so the app's own files never trip the
 * metadata-check or hash-drift dialogs (the DATA-VER-1 "in-app authoring stamp"). Preserves an
 * existing header (a stable `id`/source/license carries across saves), fills the required
 * `source`+`license` when absent, and re-stamps `schema`/`updated-at`/`hash` to match the body just
 * written — exactly like {@link saveTranslation}, so an app write is never seen as external drift.
 */
async function writeStampedHomebrew(
	storage: Storage,
	file: string,
	columns: string[],
	rows: Record<string, string>[],
	prior: Map<MetaKey, string>
): Promise<void> {
	const body = Papa.unparse({ fields: columns, data: rows }, { newline: '\r\n' });
	const d = new Map(prior);
	if (!d.has('source')) d.set('source', HOMEBREW_SOURCE);
	if (!d.has('license')) d.set('license', HOMEBREW_LICENSE);
	if (!d.has('id')) d.set('id', crypto.randomUUID());
	d.set('schema', String(CONTENT_SCHEMA_VERSION));
	d.set('updated_at', new Date().toISOString().slice(0, 10));
	d.set('hash', await hashBody(body));
	await storage.write(file, stampDirectives(d, body));
}

/** Read a homebrew CSV's existing rows + header directives (the directive block is stripped before
 *  Papa so it isn't mistaken for the column header). Empty when the file doesn't exist yet. */
async function readHomebrewFile(
	storage: Storage,
	file: string
): Promise<{ rows: Record<string, string>[]; directives: Map<MetaKey, string> }> {
	if (!(await storage.exists(file))) return { rows: [], directives: new Map() };
	const { directives, body } = parseContentDirectives(await storage.read(file));
	const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
	return { rows: parsed.data, directives };
}

/**
 * Validate a draft and append it to its homebrew CSV (rewriting the file atomically). Reads any
 * existing rows first so ids stay unique and the file keeps a stable column order. Returns the
 * saved id or the validation issues; never throws on invalid input.
 */
export async function saveHomebrewRow(
	storage: Storage,
	type: ContentType,
	draft: Record<string, string>,
	targetFile: string = homebrewFile(type)
): Promise<SaveResult> {
	const file = targetFile;

	// existing rows + header (if the file exists) — to keep ids unique, preserve prior entries + header
	const { rows: existing, directives } = await readHomebrewFile(storage, file);
	const existingIds = new Set(existing.map((r) => r.id).filter((id): id is string => Boolean(id)));

	const built = buildRowWithExtras(type, draft, existingIds);
	if (!built.ok) return { ok: false, issues: built.issues };

	const rows = [...existing, built.row];
	await writeStampedHomebrew(storage, file, columnsWithExtras(type, rows), rows, directives);
	return built.row.id ? { ok: true, id: built.row.id } : { ok: true };
}
