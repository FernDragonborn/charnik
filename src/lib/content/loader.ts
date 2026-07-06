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
import { CONTENT_TYPES, parseRow, type ContentType } from './schemas';
import {
	parseContentDirectives,
	checkFileMeta,
	isHashDrift,
	type MetaIssue,
	type DriftItem
} from './meta';
import { hashBody } from './hash';

export interface PackManifest {
	source?: string;
	systems?: string[];
	license?: string;
	attribution?: string;
	schemaVersion?: number;
}

export interface LoadedRow {
	type: ContentType;
	/** Owning source tag (row's own `source`, else the pack default). */
	source: string;
	/** Local slug. */
	id: string;
	/** Effective identity `type:source:id` — unique across the whole graph. (Slugs are
	 *  unique per TYPE, not globally: e.g. "shield" is both a spell and an item, so the
	 *  type must scope the identity — refines the docs' original `source:id`.) */
	effectiveId: string;
	systems: string[];
	/** The zod-validated, coerced row. */
	data: Record<string, unknown>;
	root: string;
	file: string;
}

export interface ContentIssue {
	level: 'error' | 'warn';
	root: string;
	file?: string;
	id?: string;
	message: string;
}

export interface ListOptions {
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

	list(type: ContentType, opts?: ListOptions): LoadedRow[];
	get(effectiveId: string): LoadedRow | undefined;
	/** All editions/sources of one article (same type + slug). */
	editionsOf(type: ContentType, id: string): LoadedRow[];
	/** Base-class features for a class row (same source, matching class_id). */
	featuresForClass(classRow: LoadedRow): LoadedRow[];
	/** Resolve referenced `source:id`s; report which are missing (render-what-you-can). */
	resolveRefs(effectiveIds: string[]): { found: LoadedRow[]; missing: string[] };
}

/** Locale column grammar: name_/text_ + a BCP-47-ish code (guardrail vs phantom locales). */
const LOCALE_COL = /^(?:name|text)_([a-z]{2,3}(?:-[A-Za-z0-9]+)*)$/;

function pushMap<K, V>(map: Map<K, V[]>, key: K, val: V): void {
	const arr = map.get(key);
	if (arr) arr.push(val);
	else map.set(key, [val]);
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
		// pack manifest (optional defaults)
		let pack: PackManifest = {};
		if (await st.exists(`${root}/_pack.json`)) {
			try {
				pack = JSON.parse(await st.read(`${root}/_pack.json`));
			} catch (e) {
				issues.push({
					level: 'error',
					root,
					file: '_pack.json',
					message: `invalid _pack.json: ${(e as Error).message}`
				});
			}
		}

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
			// legacy files that still carry them; header → pack default → fallback).
			const fileSource = directives.get('source');
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

			for (const raw of parsed.data) {
				const res = parseRow(type, raw);
				if (!res.success) {
					issues.push({
						level: 'error',
						root,
						file: entry.name,
						...(raw.id ? { id: String(raw.id) } : {}),
						message: res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')
					});
					continue;
				}
				const data = res.data as Record<string, unknown>;
				// precedence: per-row column (legacy) → file header → pack default → fallback
				const source = (data.source as string) || fileSource || pack.source || 'unknown';
				const rowSystems = data.systems as string[] | undefined;
				const systems = rowSystems?.length ? rowSystems : (fileSystems ?? pack.systems ?? []);
				const id = data.id as string;
				rows.push({
					type,
					source,
					id,
					effectiveId: `${type}:${source}:${id}`,
					systems,
					data,
					root,
					file: entry.name
				});
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

	return {
		rows,
		byType,
		byEffectiveId,
		articles,
		locales: [...localeSet].sort(),
		issues,
		metaIssues,
		driftItems,
		list(type, opts) {
			const all = byType.get(type) ?? [];
			return opts?.system ? all.filter((r) => r.systems.includes(opts.system!)) : all;
		},
		get(effectiveId) {
			return byEffectiveId.get(effectiveId);
		},
		editionsOf(type, id) {
			return articles.get(`${type}:${id}`) ?? [];
		},
		featuresForClass(classRow) {
			return (byType.get('class_feature') ?? []).filter(
				(f) => f.source === classRow.source && f.data.class_id === classRow.id
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
