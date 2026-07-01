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

export async function loadContent(storage: Storage, roots: string[]): Promise<ContentGraph> {
	const rows: LoadedRow[] = [];
	const issues: ContentIssue[] = [];
	const localeSet = new Set<string>(['en']);
	const typeByFilebase = Object.entries(CONTENT_TYPES).map(
		([t, d]) => [d.filebase, t as ContentType] as const
	);

	for (const root of roots) {
		// pack manifest (optional defaults)
		let pack: PackManifest = {};
		if (await storage.exists(`${root}/_pack.json`)) {
			try {
				pack = JSON.parse(await storage.read(`${root}/_pack.json`));
			} catch (e) {
				issues.push({
					level: 'error',
					root,
					file: '_pack.json',
					message: `invalid _pack.json: ${(e as Error).message}`
				});
			}
		}

		for (const entry of await storage.list(root)) {
			if (entry.isDir || !entry.name.endsWith('.csv')) continue;
			const base = entry.name.replace(/\.csv$/, '');
			// type = the filebase that the name equals or starts with (e.g. species_srd → species)
			const match = typeByFilebase.find(([fb]) => base === fb || base.startsWith(fb + '_'));
			if (!match) {
				issues.push({
					level: 'warn',
					root,
					file: entry.name,
					message: 'unknown content type for file'
				});
				continue;
			}
			const type = match[1];
			const csv = await storage.read(`${root}/${entry.name}`);
			const parsed = Papa.parse<Record<string, string>>(csv, {
				header: true,
				skipEmptyLines: true
			});

			for (const h of parsed.meta.fields ?? []) {
				const m = LOCALE_COL.exec(h);
				if (m) localeSet.add(m[1].toLowerCase());
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
						id: raw.id,
						message: res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')
					});
					continue;
				}
				const data = res.data as Record<string, unknown>;
				const source = (data.source as string) || pack.source || 'unknown';
				const id = data.id as string;
				rows.push({
					type,
					source,
					id,
					effectiveId: `${type}:${source}:${id}`,
					systems: data.systems as string[],
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

	return {
		rows,
		byType,
		byEffectiveId,
		articles,
		locales: [...localeSet].sort(),
		issues,
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
