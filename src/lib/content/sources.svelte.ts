/*
 * Source & collision configuration — the user's browse-layer filtering of loaded content, persisted
 * across sessions (localStorage; standalone/offline-safe). This does NOT touch the loader/core graph:
 * the full graph always loads, and `isRowActive` filters what the compendium / search / creation
 * pickers SHOW. So toggling a source or resolving a collision is live (a reactive `$state`), needs no
 * reload, and never drops data — re-enabling brings a row straight back.
 *
 * Two-dimensional source filtering (PLAN invariant): a row is shown iff its FILE is enabled AND its
 * SOURCE tag is enabled. Plus collision resolution: when the same `type:id` exists in several sources
 * that overlap an edition, the user can keep just one source (keep-one) or show them all (keep-all).
 */
import type { ContentGraph, LoadedRow } from './loader';
import { readStored, writeStored } from '$lib/util/persist';

const STORAGE_KEY = 'charnik:sources';

/** A collision group's resolution: `'all'` = keep every source (default), else the one source to keep. */
export type CollisionChoice = 'all' | string;

interface SourceConfigData {
	/** disabled content FILES, as `root/file` paths. */
	disabledFiles: string[];
	/** disabled SOURCE tags (e.g. "SRD 5.1"). */
	disabledSources: string[];
	/** `type:id` article key → which source wins (or 'all'). */
	collisions: Record<string, CollisionChoice>;
}

function load(): SourceConfigData {
	const empty: SourceConfigData = { disabledFiles: [], disabledSources: [], collisions: {} };
	const saved = readStored<Partial<SourceConfigData>>(STORAGE_KEY);
	return saved ? { ...empty, ...saved } : empty;
}

/** Reactive, persisted config. Read `.disabledFiles`/… in derived state; mutate via the helpers below
 *  (each persists). Kept as flat arrays/records so it serializes straight to JSON. */
export const sourceConfig = $state<SourceConfigData>(load());

function persist(): void {
	writeStored(STORAGE_KEY, sourceConfig);
}

function toggleIn(list: string[], value: string): void {
	const i = list.indexOf(value);
	if (i >= 0) list.splice(i, 1);
	else list.push(value);
}

/** Toggle a content file (path `root/file`) on/off. */
export function toggleFile(path: string): void {
	toggleIn(sourceConfig.disabledFiles, path);
	persist();
}
/** Toggle a source tag on/off. */
export function toggleSource(source: string): void {
	toggleIn(sourceConfig.disabledSources, source);
	persist();
}
/** Set a collision group's resolution (which source wins, or 'all'). */
export function setCollision(articleKey: string, choice: CollisionChoice): void {
	if (choice === 'all') delete sourceConfig.collisions[articleKey];
	else sourceConfig.collisions[articleKey] = choice;
	persist();
}

export const filePath = (row: Pick<LoadedRow, 'root' | 'file'>): string =>
	`${row.root}/${row.file}`;
const articleKey = (row: Pick<LoadedRow, 'type' | 'id'>): string => `${row.type}:${row.id}`;

/** Whether a row is currently shown: its file enabled AND its source enabled AND it isn't the losing
 *  side of a resolved collision. Pure over the reactive config, so any list that filters through it
 *  re-derives when the user flips a toggle — no reload. */
export function isRowActive(row: LoadedRow, cfg: SourceConfigData = sourceConfig): boolean {
	if (cfg.disabledFiles.includes(filePath(row))) return false;
	if (cfg.disabledSources.includes(row.source)) return false;
	const choice = cfg.collisions[articleKey(row)];
	if (choice && choice !== 'all' && choice !== row.source) return false;
	return true;
}

export interface CollisionGroup {
	key: string; // `${type}:${id}`
	type: string;
	id: string;
	name: string;
	sources: string[]; // distinct sources in the group
	rows: LoadedRow[];
}

/** Collision groups = the same `type:id` present in 2+ sources whose editions OVERLAP (so both would
 *  be "active" in one edition, an ambiguity worth resolving) — NOT the normal 5e/5.5e SRD pair, whose
 *  editions are disjoint and coexist via the article toggle. */
export function detectCollisions(graph: ContentGraph): CollisionGroup[] {
	const out: CollisionGroup[] = [];
	for (const [key, rows] of graph.articles) {
		const sources = [...new Set(rows.map((r) => r.source))];
		if (sources.length < 2) continue;
		// overlap = some edition appears in 2+ rows (else it's just the disjoint edition pair)
		const perSystem = new Map<string, number>();
		for (const r of rows) for (const s of r.systems) perSystem.set(s, (perSystem.get(s) ?? 0) + 1);
		const overlaps = [...perSystem.values()].some((n) => n >= 2);
		if (!overlaps) continue;
		const first = rows[0];
		if (!first) continue;
		out.push({
			key,
			type: first.type,
			id: first.id,
			name: String(first.data.name_en),
			sources,
			rows
		});
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}
