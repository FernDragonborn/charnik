/*
 * Content loader: scan content roots → parse+validate CSVs → merge → index → link.
 *
 * Storage-agnostic (works over Tauri fs, node-fs, in-memory, or a read-only fetch source —
 * so the same loader serves the desktop app AND the web build). Nothing here imports Tauri.
 *
 * Robustness is a first-class output, not an afterthought (see docs/internals/security.md +
 * "missing content" invariant):
 *   - Invalid rows / unknown files / malformed locale columns are collected as
 *     `issues` (content-health) — never thrown. A bad row is skipped, the rest load.
 *   - `get()` returns `undefined` for a missing `source:id` (never throws), and
 *     `resolveRefs()` reports which referenced ids are missing, so the character/render
 *     layer can "render what's possible + flag it" instead of crashing.
 */
import Papa from 'papaparse';
import type { Storage, FileEntry } from '../storage/types';
import {
	CONTENT_TYPES,
	parseRow,
	PROSE_BASES,
	LOC_STATUS_COL_BASE,
	type ContentType,
	type RowData,
	type ProseBase,
} from './schemas';
import {
	parseContentDirectives,
	checkFileMeta,
	HASH_STATE,
	type MetaIssue,
	type DriftItem,
} from './meta';
import { fileHashState } from './hash';
import { declaredSchema, migrateRows } from './migrations';
import { CONTENT_SCHEMA_VERSION } from '../schema/version';
import { issueText } from './issue-text';
import type { SaidValue } from '../util/say';
import {
	collectTranslationGaps,
	validateItemTags,
	validateSpellListJoins,
} from './loader-validate';

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

/** A row's English name — the label a trace, toast or list shows. The ONE accessor for it, because on
 *  the `LoadedRow` UNION `data.name_en` is legitimately `string | undefined`: the lookup tables
 *  (spell slots, XP thresholds) have no `name_en` column at all. Callers used to paper over that by
 *  coercing the read to a string, which renders the literal "undefined" for exactly those rows; the
 *  id is the honest fallback. A row narrowed to a type that HAS the column should just read it. */
export const rowName = (row: LoadedRow): string =>
	('name_en' in row.data ? row.data.name_en : undefined) ?? row.id;

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

export interface ContentIssue {
	level: 'error' | 'warn';
	root: string;
	file?: string;
	id?: string;
	/** What happened / what it means / what to change, in the reader's words — as the catalog KEY and
	 *  its values, because the loader has no locale and the panel is re-read in whichever language the
	 *  app is switched to. Which sentence a fault gets is `issue-text.ts`; the exact token, column or
	 *  id goes in `detail`, never in the sentence (UX-1). Say it with `sayText`. */
	key: string;
	values?: Record<string, SaidValue>;
	/** The particulars, rendered demoted under the sentence — the panel is the author's debugger too. */
	detail?: string;
}

type ListOptions = { system?: string };

export interface ContentGraph {
	rows: LoadedRow[];
	/** The content-pack roots this graph was loaded from — every root EXCEPT the writable homebrew
	 *  one (that arrives as an `extra` source). A file under one of these is managed by a pack and an
	 *  update may overwrite it, so homebrew authoring must fork rather than write into it. */
	packRoots: string[];
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
	featuresForClass(classRow: LoadedRow): LoadedRowByType<'class_feature'>[];
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

/** One content root paired with the storage it lives in. Bundled SRD roots read from the
 *  read-only fetch/asset source; user homebrew reads from the writable user storage — the loader
 *  merges them into one graph (docs/plan.md "content merged from many files/roots"). */
export interface ContentSource {
	storage: Storage;
	root: string;
}

/** Mutable accumulators + the read-only type lookup, shared across the per-file load loop. */
interface LoadAcc {
	rows: LoadedRow[];
	issues: ContentIssue[];
	metaIssues: MetaIssue[];
	driftItems: DriftItem[];
	localeSet: Set<string>;
	/** longest filebase first, so a specific type wins over a type whose filebase is its prefix
	 *  (e.g. `species_options_*` must match `species_option`, not `species`). */
	typeByFilebase: readonly (readonly [string, ContentType])[];
}

/** One CSV file being loaded: the storage it lives in + its root + directory entry. */
interface FileRef {
	st: Storage;
	root: string;
	entry: FileEntry;
}

/** File-level `#content-` header values stamped onto every row of the file. */
interface FileHeader {
	type: ContentType;
	source: string | undefined;
	license: string | undefined;
	sourceLang: string;
	systems: string[] | undefined;
}

/** Resolve a file's content type from an explicit `#content-type:` directive or (fallback) its
 *  filename; push an issue + return null when neither yields a known type. */
function resolveFileType(
	file: FileRef,
	directives: Map<string, string>,
	acc: LoadAcc,
): ContentType | null {
	const { root, entry } = file;
	const declaredType = directives.get('type');
	if (declaredType) {
		if (declaredType in CONTENT_TYPES) return declaredType as ContentType;
		acc.issues.push({
			level: 'error',
			root,
			file: entry.name,
			...issueText.unknownDeclaredType(declaredType, Object.keys(CONTENT_TYPES)),
		});
		return null;
	}
	const base = entry.name.replace(/\.csv$/, '');
	// type = the filebase that the name equals or starts with (e.g. species_srd → species)
	const match = acc.typeByFilebase.find(([fb]) => base === fb || base.startsWith(fb + '_'));
	if (match) return match[1];
	acc.issues.push({
		level: 'warn',
		root,
		file: entry.name,
		...issueText.unknownFileType(),
	});
	return null;
}

/** Parse+validate ONE raw CSV row against its type, re-attach the localized prose/status columns the
 *  strict schema stripped, and assemble the LoadedRow (precedence: row column → file header →
 *  fallback). Returns a ContentIssue instead when the row fails validation. */
function buildLoadedRow(
	rawRow: Record<string, string>,
	header: FileHeader,
	file: FileRef,
): LoadedRow | ContentIssue {
	const res = parseRow(header.type, rawRow);
	if (!res.success)
		return {
			level: 'error',
			root: file.root,
			file: file.entry.name,
			...(rawRow.id ? { id: String(rawRow.id) } : {}),
			...issueText.badRow(
				[...new Set(res.error.issues.map((i) => i.path.join('.')).filter(Boolean))],
				header.type,
				res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
			),
		};
	// `data` shares every type's `base` columns (id/source/systems/name_en/…), so those read typed
	// with no narrowing; type-specific reads happen after the row is narrowed by `.type`.
	const data: AnyRowData = res.data;
	// re-attach the localized columns the strict schema stripped — prose (name_uk, …) and the tracked
	// translation status (loc_status_uk); each guard narrows the key to its template type (no cast); a
	// blank/absent cell is left off (EN-fallback / unset).
	for (const [column, value] of Object.entries(rawRow)) {
		if (value === '' || value == null) continue;
		if (isProseLocaleColumn(column) && data[column] === undefined) data[column] = value;
		else if (isLocStatusColumn(column) && data[column] === undefined) data[column] = value;
	}
	// precedence: per-row column (legacy) → file `#content-` header → fallback
	const source = data.source || header.source || 'unknown';
	const systems = data.systems?.length ? data.systems : (header.systems ?? []);
	const id = data.id;
	// parseRow validated `data` against `type`; TS can't correlate the runtime `type` union with the
	// per-type `data` union into one LoadedRow member without an assertion — ONE localized cast here.
	// It is on the assembled VARIABLE, not the literal: the literal is checked field-by-field against
	// the common shape first, so a missing/mistyped `effectiveId` still fails, and only the
	// type↔data correlation is asserted (`consistent-type-assertions`, PLAN · LINT-1).
	const row: LoadedRowCommon & { type: ContentType; data: AnyRowData } = {
		type: header.type,
		source,
		id,
		effectiveId: `${header.type}:${source}:${id}`,
		systems,
		...(header.license ? { license: header.license } : {}),
		sourceLang: header.sourceLang,
		data,
		root: file.root,
		file: file.entry.name,
	};
	return row as LoadedRow;
}

/** B11: byte cap per CSV, checked BEFORE `Papa.parse` (the freeze/OOM step — parse builds an object
 *  graph, read is a flat buffer). A char-length proxy for a row cap: rows only exist post-parse, so
 *  we can't count them without running the parse we're guarding. Generous — a DoS backstop against a
 *  corrupt/hostile file, not a functional limit (our whole SRD is ~2.7k rows; homebrew may be large).
 *  Over cap → skip the file with a visible content-health error, never a silent truncate. */
const MAX_CSV_BYTES = 20 * 1024 * 1024;

/** Read + parse one CSV file, resolving its type/meta/header and folding every valid row + any
 *  content-health issue into `acc`. A non-CSV / directory entry is skipped. */
async function processFile(file: FileRef, acc: LoadAcc, preRead?: string): Promise<void> {
	const { st, root, entry } = file;
	if (entry.isDir || !entry.name.endsWith('.csv')) return;
	// the caller reads bodies ahead in parallel (SMELL-5); fall back to a direct read for any caller
	// that doesn't (keeps this callable standalone).
	const raw = preRead ?? (await st.read(`${root}/${entry.name}`));
	if (raw.length > MAX_CSV_BYTES) {
		acc.issues.push({
			level: 'error',
			root,
			file: entry.name,
			...issueText.oversizedFile(raw.length, MAX_CSV_BYTES),
		});
		return;
	}
	// A `#content-<key>:` header block (any order, before the CSV) declares the file's metadata.
	// `#content-type:` lets a freely-named file declare its type; `#content-source:` / `-systems:` are
	// the file-level source tag / editions stamped onto every row. Explicit wins.
	const { directives, body } = parseContentDirectives(raw);
	const type = resolveFileType(file, directives, acc);
	if (!type) return;

	// DATA-VER-1 detection (surfaced, never thrown): (a) a REQUIRED metadata key missing →
	// ContentMetaModal; (b) a recorded hash that no longer matches the body → HashDriftModal.
	const fileLabel = `${root}/${entry.name}`;
	const metaIssue = checkFileMeta(fileLabel, directives);
	if (metaIssue) acc.metaIssues.push(metaIssue);
	// only DRIFT belongs in this list: an unstamped file has nothing to have drifted from, and it is
	// already reported (and silently auto-filled) as missing metadata above
	if ((await fileHashState(raw)) === HASH_STATE.drift)
		acc.driftItems.push({
			file: fileLabel,
			declaredDate: directives.get('updated_at'),
			changedAt: entry.mtime ? new Date(entry.mtime).toISOString().slice(0, 10) : undefined,
		});

	const header: FileHeader = {
		type,
		source: directives.get('source'),
		license: directives.get('license'),
		// the language this file's rows are authored in (default en) — always "reviewed" for l10n status
		sourceLang: (directives.get('source_lang') ?? 'en').toLowerCase(),
		systems: directives
			.get('systems')
			?.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
	};
	const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
	for (const h of parsed.meta.fields ?? []) {
		const m = LOCALE_COL.exec(h);
		if (m?.[1]) acc.localeSet.add(m[1].toLowerCase());
		else if (/^(?:name|text)_/.test(h))
			acc.issues.push({
				level: 'warn',
				root,
				file: entry.name,
				...issueText.malformedLocaleColumn(h),
			});
	}
	// A file authored against another schema version is brought forward before anything reads its
	// columns; one that cannot be (no step registered, or written by a NEWER build than this one) is
	// reported and its rows are loaded as-is — flagged beats silently reinterpreted.
	const declared = declaredSchema(directives.get('schema'));
	const migrated = migrateRows(type, parsed.data, declared);
	if (migrated.error)
		acc.issues.push({
			level: 'warn',
			root,
			file: entry.name,
			...issueText.schemaMismatch(declared, CONTENT_SCHEMA_VERSION, migrated.error),
		});
	for (const rawRow of migrated.rows) {
		const built = buildLoadedRow(rawRow, header, file);
		if ('level' in built) acc.issues.push(built);
		else acc.rows.push(built);
	}
}

interface ContentIndices {
	byType: Map<ContentType, LoadedRow[]>;
	byEffectiveId: Map<string, LoadedRow>;
	articles: Map<string, LoadedRow[]>;
	uniqueRows: LoadedRow[];
}

/** Build the id / type / article indices from the loaded rows. An EXACT source:id duplicate is a real
 *  error AND must not APPLY twice: drop it from every collection the derive scans read (rows / byType /
 *  articles), keeping only the first — else the class-feature scan + condition expansion (which iterate
 *  `graph.rows`) fold its tokens ×2 while `get()` sees one row (B22). */
function buildIndices(rows: LoadedRow[], issues: ContentIssue[]): ContentIndices {
	const byType = new Map<ContentType, LoadedRow[]>();
	const byEffectiveId = new Map<string, LoadedRow>();
	const articles = new Map<string, LoadedRow[]>();
	const uniqueRows: LoadedRow[] = [];
	for (const r of rows) {
		const kept = byEffectiveId.get(r.effectiveId);
		if (kept) {
			issues.push({
				level: 'error',
				root: r.root,
				file: r.file,
				id: r.id,
				...issueText.duplicateId(r.id, r.effectiveId, `${kept.root}/${kept.file}`),
			});
			continue;
		}
		byEffectiveId.set(r.effectiveId, r);
		uniqueRows.push(r);
		pushMap(byType, r.type, r);
		pushMap(articles, `${r.type}:${r.id}`, r);
	}
	return { byType, byEffectiveId, articles, uniqueRows };
}

/** Load + merge content. The 2-arg form (one storage, many roots) is the common case; `extra`
 *  adds roots backed by a DIFFERENT storage (e.g. homebrew in user storage while SRD ships as
 *  fetched assets). All sources merge by type exactly the same way. */
export async function loadContent(
	storage: Storage,
	roots: string[],
	extra: ContentSource[] = [],
): Promise<ContentGraph> {
	const acc: LoadAcc = {
		rows: [],
		issues: [],
		metaIssues: [],
		driftItems: [],
		localeSet: new Set<string>(['en']),
		typeByFilebase: Object.entries(CONTENT_TYPES)
			.map(([t, d]) => [d.filebase, t as ContentType] as const)
			.sort((a, b) => b[0].length - a[0].length),
	};

	const sources: ContentSource[] = [...roots.map((root) => ({ storage, root })), ...extra];
	// SMELL-5: overlap the per-file READS (I/O) but keep ACCUMULATION sequential in list order — the
	// dedup / source:id merge is order-sensitive, so processing order must stay identical to before.
	const files: FileRef[] = [];
	for (const { storage: st, root } of sources)
		for (const entry of await st.list(root)) files.push({ st, root, entry });
	const withRaw = await Promise.all(
		files.map(async (file) => ({
			file,
			raw:
				file.entry.isDir || !file.entry.name.endsWith('.csv')
					? null
					: await file.st.read(`${file.root}/${file.entry.name}`),
		})),
	);
	for (const { file, raw } of withRaw) if (raw != null) await processFile(file, acc, raw);

	// same references as `acc.*` — phases below read/push through these bindings unchanged
	const { rows, issues, metaIssues, driftItems, localeSet } = acc;

	const { byType, byEffectiveId, articles, uniqueRows } = buildIndices(rows, issues);

	validateSpellListJoins(byType, issues);
	validateItemTags(byType, issues);

	// content-health: surface partially-translated rows (mis-filled tables), never throw
	issues.push(...collectTranslationGaps(uniqueRows, [...localeSet]));

	return {
		rows: uniqueRows,
		packRoots: roots,
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
			// The ONE "which class_feature rows belong to this class row" query (D18) — derive's gather
			// AND tests read it. Matches on class_id + edition OVERLAP, NOT on source: a homebrew/PHB
			// feature a user adds for an SRD class carries its OWN source tag, and must still attach
			// (B26 — "users add non-SRD content themselves"). Callers layer the per-character gates
			// (exact system, level ≤ class level, isRowActive, the chosen subclass) on top.
			return (byType.get('class_feature') ?? []).filter(
				(f): f is LoadedRowByType<'class_feature'> =>
					f.type === 'class_feature' &&
					f.data.class_id === classRow.id &&
					f.systems.some((s) => classRow.systems.includes(s)),
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
		},
	};
}
