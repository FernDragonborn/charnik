/*
 * Content loader: scan content roots → parse+validate CSVs → merge → index → link.
 *
 * Storage-agnostic (works over Tauri fs, node-fs, in-memory, or a read-only fetch source —
 * so the same loader serves the desktop app AND the web build). Nothing here imports Tauri.
 *
 * Robustness is a first-class output, not an afterthought (see docs/SECURITY.md +
 * "missing content" invariant):
 *   - Invalid rows / unknown files / malformed locale columns are collected as
 *     `issues` (content-health) — never thrown. A bad row is skipped, the rest load.
 *   - `get()` returns `undefined` for a missing `source:id` (never throws), and
 *     `resolveRefs()` reports which referenced ids are missing, so the character/render
 *     layer can "render what's possible + flag it" instead of crashing.
 */
import Papa from 'papaparse';
import type { Storage } from '../storage/types';
import {
	CONTENT_TYPES,
	parseRow,
	PROSE_BASES,
	LOC_STATUS_COL_BASE,
	type ContentType,
	type RowData,
	type ProseBase
} from './schemas';
import {
	parseContentDirectives,
	checkFileMeta,
	isHashDrift,
	type MetaIssue,
	type DriftItem
} from './meta';
import { hashBody } from './hash';

/** Identity + provenance a loaded row carries regardless of its content type. */
interface LoadedRowCommon {
	/** Owning source tag (row's own `source` column, else the file's `#content-source` header). */
	source: string;
	/** Local slug. */
	id: string;
	/** Effective identity `type:source:id` — unique across the whole graph. (Slugs are
	 *  unique per TYPE, not globally: e.g. "shield" is both a spell and an item, so the
	 *  type must scope the identity — refines the docs' original `source:id`.) */
	effectiveId: string;
	systems: string[];
	/** The file's `#content-license` (CC-BY-4.0 for shipped SRD, the user's choice for homebrew), or
	 *  undefined for a legacy file with no header. Drives the source-line's license label. */
	license?: string | undefined;
	/** The language the row's content was authored IN — its file's `#content-source-lang` (default
	 *  `en`). The source language is always "reviewed" for localization status: there's nothing to
	 *  translate it into. Per file, so a homebrew CSV authored in Ukrainian can stamp `source-lang: uk`. */
	sourceLang: string;
	root: string;
	file: string;
}

/** A loaded row of a KNOWN content type `T`: the common identity + the zod-validated, coerced model
 *  for `T` (Spell, Monster, …) — not an untyped bag. `graph.list('spell')` yields `LoadedRowOf<'spell'>`,
 *  so `row.data.level` is `number`. */
export interface LoadedRowOf<T extends ContentType> extends LoadedRowCommon {
	type: T;
	data: RowData<T>;
}

/** A loaded content row — a discriminated union on `type`. Narrowing on `row.type` (or reaching a row
 *  via `list(type)`) narrows `row.data` to that type's model; the shared `base` columns
 *  (name_en/text_en/systems/source/effects) read without narrowing since every member has them. */
export type LoadedRow = { [T in ContentType]: LoadedRowOf<T> }[ContentType];

/** A row's bounded-vocab effect tokens (empty for lookup tables, which carry no `effects` column).
 *  The ONE accessor every consumer (derive gather, combat cast, content-health lint) reads. */
export const tokensOf = (row: LoadedRow | undefined): string[] => {
	// `effects` rides on every browsable type but not the lookup tables; read it only where present
	const effects = row && 'effects' in row.data ? row.data.effects : undefined;
	return Array.isArray(effects) ? effects : [];
};

/** The data payload of SOME loaded row — the union of every type's model. Used only at the loader's
 *  parse boundary, where a row's type is a runtime value, not a static `T`; typed reads elsewhere use
 *  `RowData<T>` via a narrowed `LoadedRowOf<T>`. */
type AnyRowData = { [T in ContentType]: RowData<T> }[ContentType];

/** The loaded-row member(s) for a type `T`. Distributes: `LoadedRowByType<'spell'>` is one member,
 *  `LoadedRowByType<ContentType>` is the whole `LoadedRow` union — so `list(runtimeType)` stays
 *  assignable to `LoadedRow[]` while `list('spell')` narrows to the spell member. */
export type LoadedRowByType<T extends ContentType> = Extract<LoadedRow, { type: T }>;

interface ContentIssue {
	level: 'error' | 'warn';
	root: string;
	file?: string;
	id?: string;
	message: string;
}

interface ListOptions {
	system?: string;
}

export interface ContentGraph {
	rows: LoadedRow[];
	byType: Map<ContentType, LoadedRow[]>;
	byEffectiveId: Map<string, LoadedRow>;
	/** `${type}:${id}` → every version (across sources/editions) — powers the 5e/5.5e toggle. */
	articles: Map<string, LoadedRow[]>;
	/** Discovered content locales (always includes `en`). */
	locales: string[];
	issues: ContentIssue[];
	/** Files missing REQUIRED metadata (source/license) → drive the ContentMetaModal (DATA-VER-1). */
	metaIssues: MetaIssue[];
	/** Files whose body no longer matches their recorded `#content-hash` → drive the HashDriftModal. */
	driftItems: DriftItem[];

	/** Rows of one type, precisely typed: `list('spell')` → `Spell` rows; a runtime `ContentType`
	 *  yields the full `LoadedRow` union (the return distributes over `T`). */
	list<T extends ContentType>(type: T, opts?: ListOptions): LoadedRowByType<T>[];
	get(effectiveId: string): LoadedRow | undefined;
	/** All editions/sources of one article (same type + slug). */
	editionsOf(type: ContentType, id: string): LoadedRow[];
	/** Base-class features for a class row (same source, matching class_id). */
	featuresForClass(classRow: LoadedRow): LoadedRow[];
	/** Resolve referenced `source:id`s; report which are missing (render-what-you-can). */
	resolveRefs(effectiveIds: string[]): { found: LoadedRow[]; missing: string[] };
}

/** A BCP-47-ish locale code (guardrail vs phantom locales): a 2–3 letter base + optional subtags
 *  (`pt-BR`). The ONE grammar every locale-column regex is built from (AUDIT F11). */
export const LOCALE_TAG = '[a-z]{2,3}(?:-[A-Za-z0-9]+)*';

/** Locale column grammar: name_/text_ + a locale code. */
const LOCALE_COL = new RegExp(`^(?:name|text)_(${LOCALE_TAG})$`);

/** Localized PROSE columns (`<base>_<loc>`). The strict per-type schema declares only name_/text_
 *  en+uk, so `safeParse` STRIPS extra locales (name_de) and other prose fields (material_uk,
 *  higher_level_uk). We re-attach these from the raw row so localized render + translation survive —
 *  narrow to the prose bases so genuine junk columns still don't leak into `data` (→ the meta grid).
 *  Generated from PROSE_BASES so the base list has one source (shared with the translate write path). */
const PROSE_LOCALE_COL = new RegExp(`^(?:${PROSE_BASES.join('|')})_${LOCALE_TAG}$`);

/** Type guard for the re-attach: narrows a raw header to the prose-locale key type, so writing it onto
 *  the typed `RowData` needs no cast (the key is provably a `${ProseBase}_${string}`). */
function isProseLocaleColumn(column: string): column is `${ProseBase}_${string}` {
	return PROSE_LOCALE_COL.test(column);
}

/** Tracked-status columns (`loc_status_<loc>`) — the strict schema strips them, so the loader re-attaches
 *  them exactly like the prose columns (isProseLocaleColumn). The guard narrows the key to the
 *  `${typeof LOC_STATUS_COL_BASE}_${string}` template type so the re-attach writes onto `data` cast-free. */
const LOC_STATUS_COL = new RegExp(`^${LOC_STATUS_COL_BASE}_${LOCALE_TAG}$`);
function isLocStatusColumn(column: string): column is `${typeof LOC_STATUS_COL_BASE}_${string}` {
	return LOC_STATUS_COL.test(column);
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, val: V): void {
	const arr = map.get(key);
	if (arr) arr.push(val);
	else map.set(key, [val]);
}

const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * Content-health: flag rows that are PARTIALLY translated into a locale — some `<base>_<loc>` prose is
 * filled but a `<base>_<loc>` is missing where the English is present. That's the "someone mis-filled
 * the table" signal. A fully-untranslated row stays silent: EN fallback is the normal, intended case,
 * so it isn't an error. Reads only prose-locale columns (typed via the ProseLocaleColumns index).
 */
function collectTranslationGaps(rows: LoadedRow[], locales: string[]): ContentIssue[] {
	const gaps: ContentIssue[] = [];
	for (const locale of locales) {
		if (locale === 'en') continue;
		for (const row of rows) {
			const expected = PROSE_BASES.filter((base) => nonEmptyString(row.data[`${base}_en`]));
			if (expected.length === 0) continue; // nothing in English to translate
			const missing = expected.filter((base) => !nonEmptyString(row.data[`${base}_${locale}`]));
			// partial = started (at least one base translated) but not finished
			if (missing.length > 0 && missing.length < expected.length)
				gaps.push({
					level: 'warn',
					root: row.root,
					file: row.file,
					id: row.id,
					message: `locale "${locale}": partial translation — missing ${missing
						.map((base) => `${base}_${locale}`)
						.join(', ')}`
				});
		}
	}
	return gaps;
}

/** One content root paired with the storage it lives in. Bundled SRD roots read from the
 *  read-only fetch/asset source; user homebrew reads from the writable user storage — the loader
 *  merges them into one graph (docs/PLAN.md "content merged from many files/roots"). */
export interface ContentSource {
	storage: Storage;
	root: string;
}

/** Load + merge content. The 2-arg form (one storage, many roots) is the common case; `extra`
 *  adds roots backed by a DIFFERENT storage (e.g. homebrew in user storage while SRD ships as
 *  fetched assets). All sources merge by type exactly the same way. */
export async function loadContent(
	storage: Storage,
	roots: string[],
	extra: ContentSource[] = []
): Promise<ContentGraph> {
	const rows: LoadedRow[] = [];
	const issues: ContentIssue[] = [];
	const metaIssues: MetaIssue[] = [];
	const driftItems: DriftItem[] = [];
	const localeSet = new Set<string>(['en']);
	// longest filebase first, so a specific type wins over a type whose filebase is its prefix
	// (e.g. `species_options_*` must match `species_option`, not `species`)
	const typeByFilebase = Object.entries(CONTENT_TYPES)
		.map(([t, d]) => [d.filebase, t as ContentType] as const)
		.sort((a, b) => b[0].length - a[0].length);

	const sources: ContentSource[] = [...roots.map((root) => ({ storage, root })), ...extra];
	for (const { storage: st, root } of sources) {
		for (const entry of await st.list(root)) {
			if (entry.isDir || !entry.name.endsWith('.csv')) continue;
			const raw = await st.read(`${root}/${entry.name}`);
			// A `#content-<key>:` header block (any order, before the CSV) declares the file's metadata.
			// `#content-type:` lets a freely-named file declare its type (the loader is otherwise
			// filename-only); `#content-source:` / `#content-systems:` are the file-level source tag and
			// editions, stamped onto every row (the per-row columns are legacy fallbacks). Explicit wins.
			const { directives, body } = parseContentDirectives(raw);
			const declaredType = directives.get('type');
			let type: ContentType;
			if (declaredType) {
				if (!(declaredType in CONTENT_TYPES)) {
					issues.push({
						level: 'error',
						root,
						file: entry.name,
						message: `#content-type: unknown content type "${declaredType}"`
					});
					continue;
				}
				type = declaredType as ContentType;
			} else {
				const base = entry.name.replace(/\.csv$/, '');
				// type = the filebase that the name equals or starts with (e.g. species_srd → species)
				const match = typeByFilebase.find(([fb]) => base === fb || base.startsWith(fb + '_'));
				if (!match) {
					issues.push({
						level: 'warn',
						root,
						file: entry.name,
						message:
							'unknown content type for file (name matches no type — add a "#content-type: <type>" first line to declare it)'
					});
					continue;
				}
				type = match[1];
			}
			// DATA-VER-1 detection (surfaced, never thrown): (a) a REQUIRED metadata key missing →
			// ContentMetaModal; (b) a recorded hash that no longer matches the body → HashDriftModal.
			const fileLabel = `${root}/${entry.name}`;
			const metaIssue = checkFileMeta(fileLabel, directives);
			if (metaIssue) metaIssues.push(metaIssue);
			const storedHash = directives.get('hash');
			if (storedHash && isHashDrift(storedHash, await hashBody(raw))) {
				driftItems.push({
					file: fileLabel,
					declaredDate: directives.get('updated-at'),
					changedAt: entry.mtime ? new Date(entry.mtime).toISOString().slice(0, 10) : undefined
				});
			}

			// file-level source/systems from the header, applied to every row (row columns override for
			// legacy files that still carry them; else the `#content-` header, else a fallback).
			const fileSource = directives.get('source');
			const fileLicense = directives.get('license');
			// the language this file's rows are authored in (default en) — always "reviewed" for l10n status
			const fileSourceLang = (directives.get('source-lang') ?? 'en').toLowerCase();
			const fileSystems = directives
				.get('systems')
				?.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			const parsed = Papa.parse<Record<string, string>>(body, {
				header: true,
				skipEmptyLines: true
			});

			for (const h of parsed.meta.fields ?? []) {
				const m = LOCALE_COL.exec(h);
				if (m?.[1]) localeSet.add(m[1].toLowerCase());
				else if (/^(?:name|text)_/.test(h))
					issues.push({
						level: 'warn',
						root,
						file: entry.name,
						message: `malformed locale column "${h}" (expected name_<bcp47>)`
					});
			}

			for (const rawRow of parsed.data) {
				const res = parseRow(type, rawRow);
				if (!res.success) {
					issues.push({
						level: 'error',
						root,
						file: entry.name,
						...(rawRow.id ? { id: String(rawRow.id) } : {}),
						message: res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')
					});
					continue;
				}
				// `data` shares every type's `base` columns (id/source/systems/name_en/…), so those read
				// typed with no narrowing; type-specific reads happen after the row is narrowed by `.type`.
				const data: AnyRowData = res.data;
				// re-attach the localized columns the strict schema stripped — prose (name_uk, …) and the
				// tracked translation status (loc_status_uk). Each guard narrows the key to its template
				// type so the write needs no cast; a blank/absent cell is left off (EN-fallback / unset).
				for (const [column, value] of Object.entries(rawRow)) {
					if (value === '' || value == null) continue;
					if (isProseLocaleColumn(column) && data[column] === undefined) data[column] = value;
					else if (isLocStatusColumn(column) && data[column] === undefined) data[column] = value;
				}
				// precedence: per-row column (legacy) → file `#content-` header → fallback
				const source = data.source || fileSource || 'unknown';
				const systems = data.systems?.length ? data.systems : (fileSystems ?? []);
				const id = data.id;
				// parseRow already validated `data` against `type`, but TS can't correlate the runtime
				// `type` union with the per-type `data` union into a single `LoadedRow` member without an
				// assertion — the same generic-indexing seam as `parseRow`. ONE localized cast at the parse
				// boundary; every read past here is fully typed.
				rows.push({
					type,
					source,
					id,
					effectiveId: `${type}:${source}:${id}`,
					systems,
					...(fileLicense ? { license: fileLicense } : {}),
					sourceLang: fileSourceLang,
					data,
					root,
					file: entry.name
				} as LoadedRow);
			}
		}
	}

	// indices
	const byType = new Map<ContentType, LoadedRow[]>();
	const byEffectiveId = new Map<string, LoadedRow>();
	const articles = new Map<string, LoadedRow[]>();
	for (const r of rows) {
		pushMap(byType, r.type, r);
		if (byEffectiveId.has(r.effectiveId)) {
			issues.push({
				level: 'error',
				root: r.root,
				file: r.file,
				id: r.id,
				message: `duplicate source:id "${r.effectiveId}"`
			});
		} else {
			byEffectiveId.set(r.effectiveId, r);
		}
		pushMap(articles, `${r.type}:${r.id}`, r);
	}

	// validate additive spell_lists joins: an unknown class_id/spell_id is likely a typo → WARN
	// (the join is harmless — it just resolves to nothing — but surfaced so the user can fix it).
	const systemsById = (type: ContentType): Map<string, string[]> => {
		const m = new Map<string, string[]>();
		for (const r of byType.get(type) ?? []) m.set(r.id, [...(m.get(r.id) ?? []), ...r.systems]);
		return m;
	};
	const classSystems = systemsById('class');
	const spellSystems = systemsById('spell');
	const joinResolves = (map: Map<string, string[]>, id: unknown, systems: string[]) =>
		(map.get(String(id)) ?? []).some((s) => systems.includes(s));
	for (const r of byType.get('spell_lists') ?? []) {
		if (r.type !== 'spell_lists') continue; // byType guarantees it; the guard narrows the union for TS
		if (!joinResolves(classSystems, r.data.class_id, r.systems))
			issues.push({
				level: 'warn',
				root: r.root,
				file: r.file,
				id: r.id,
				message: `spell_lists: unknown class "${r.data.class_id}" (no class with that id in this edition)`
			});
		if (!joinResolves(spellSystems, r.data.spell_id, r.systems))
			issues.push({
				level: 'warn',
				root: r.root,
				file: r.file,
				id: r.id,
				message: `spell_lists: unknown spell "${r.data.spell_id}" (no spell with that id in this edition)`
			});
	}

	// content-health: surface partially-translated rows (mis-filled tables), never throw
	issues.push(...collectTranslationGaps(rows, [...localeSet]));

	return {
		rows,
		byType,
		byEffectiveId,
		articles,
		locales: [...localeSet].sort(),
		issues,
		metaIssues,
		driftItems,
		list<T extends ContentType>(type: T, opts?: ListOptions): LoadedRowByType<T>[] {
			// byType is keyed by `type`, so every row under it is a LoadedRowByType<T>; the Map value
			// widens to the union, so narrow it back here — the single seam that keeps `list` precise.
			const all = (byType.get(type) ?? []) as LoadedRowByType<T>[];
			const system = opts?.system;
			return system ? all.filter((r) => r.systems.includes(system)) : all;
		},
		get(effectiveId) {
			return byEffectiveId.get(effectiveId);
		},
		editionsOf(type, id) {
			return articles.get(`${type}:${id}`) ?? [];
		},
		featuresForClass(classRow) {
			return (byType.get('class_feature') ?? []).filter(
				(f) =>
					f.type === 'class_feature' &&
					f.source === classRow.source &&
					f.data.class_id === classRow.id
			);
		},
		resolveRefs(effectiveIds) {
			const found: LoadedRow[] = [];
			const missing: string[] = [];
			for (const eid of effectiveIds) {
				const row = byEffectiveId.get(eid);
				if (row) found.push(row);
				else missing.push(eid);
			}
			return { found, missing };
		}
	};
}
