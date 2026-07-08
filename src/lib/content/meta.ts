/**
 * Content-file metadata directives (the `#content-<key>: <value>` header block) + the
 * required-field check that drives the "content meta review" modal (DATA-VER-1, docs/PLAN.md).
 *
 * The header is a run of leading `#content-<key>: <value>` comment lines before the CSV column
 * header, in any order. This module is the single parser + the pure classifier of what's missing;
 * it does NO IO and imports no Svelte/Tauri (thin-component + pure-core rules).
 */

/** One directive line: `#content-<key>: <value>` (key kebab, value the rest of the line trimmed). */
const DIRECTIVE = /^\s*#\s*content-([a-z][a-z-]*)\s*:\s*(.*)$/i;

export type MetaKey =
	| 'type'
	| 'id'
	| 'source'
	| 'url'
	| 'license'
	| 'author'
	| 'author-url'
	| 'systems'
	| 'schema'
	| 'updated-at'
	| 'hash';

/** Keys the app can fill with NO human input — generate/compute + write back (DATA-VER-1). */
export const AUTOFILL_KEYS: readonly MetaKey[] = ['id', 'hash', 'updated-at', 'schema'];

/** Keys only a human knows the semantics of — REQUIRED, must be prompted (or collected by the
 *  authoring form). `type` falls back to the filename so it's not here. */
export const HUMAN_KEYS: readonly MetaKey[] = ['source', 'license'];

/** Keys we OFFER to fill when the modal is already open, but whose absence does NOT trigger it on its
 *  own — all have a safe fallback (`systems` → both editions; the rest are simply optional metadata).
 *  Shown as optional inputs so the user can see every field that could be filled. */
export const OPTIONAL_KEYS: readonly MetaKey[] = ['systems', 'url', 'author', 'author-url'];

/** Every key the user can type/pick in the modal (required first, then optional). Any of these that
 *  the file already declares is passed back in `MetaIssue.values` so the form shows it PRE-FILLED. */
export const EDITABLE_KEYS: readonly MetaKey[] = [...HUMAN_KEYS, ...OPTIONAL_KEYS];

export interface ParsedDirectives {
	/** Directive key → raw value, lowercased keys. Only `#content-*` lines are captured. */
	directives: Map<MetaKey, string>;
	/** The CSV with the directive block stripped off — a clean body for Papa. */
	body: string;
}

/** Split the leading `#content-<key>:` directive block off the top of a CSV. Consumes every such
 *  line (and skips blank lines between them); the first non-directive, non-blank line begins the
 *  body. A leading BOM on the first line is tolerated. */
export function parseContentDirectives(csv: string): ParsedDirectives {
	const directives = new Map<MetaKey, string>();
	const lines = csv.split('\n');
	let i = 0;
	for (; i < lines.length; i++) {
		let line = lines[i]!.replace(/\r$/, '');
		if (i === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1); // strip a leading BOM
		if (line.trim() === '') continue; // allow blank spacer lines inside the header block
		const m = DIRECTIVE.exec(line);
		if (!m) break; // first real (non-directive) line → body starts here
		directives.set(m[1]!.toLowerCase() as MetaKey, m[2]!.trim());
	}
	return { directives, body: lines.slice(i).join('\n') };
}

/** Inverse of {@link parseContentDirectives}: re-assemble a full CSV file from a directive map + a
 *  body. Emits UTF-8 BOM + CRLF (Excel/Cyrillic safety) and keeps the map's insertion order, so an
 *  in-place rewrite (e.g. a saved translation re-stamping hash/updated-at) preserves the header shape. */
export function stampDirectives(directives: Map<MetaKey, string>, body: string): string {
	const BOM = String.fromCharCode(0xfeff);
	const head = [...directives].map(([k, v]) => `#content-${k}: ${v}`).join('\r\n');
	const crlfBody = body.replace(/\r\n?|\n/g, '\r\n');
	return `${BOM}${head}\r\n${crlfBody}`;
}

export interface MetaIssue {
	/** Display path of the offending file (root-relative). */
	file: string;
	/** REQUIRED human-semantic keys the app cannot guess — these drive the prompt. */
	missingHuman: MetaKey[];
	/** Machine-fillable keys — the app will auto-fill these, shown as FYI not a question. */
	missingAuto: MetaKey[];
	/** OPTIONAL keys absent — offered as optional inputs while the modal is open (never the reason it
	 *  opened). Empty unless the modal was already triggered by a missing required/auto key. */
	missingOptional: MetaKey[];
	/** Editable keys the file ALREADY declares → the form shows these fields pre-filled. */
	values: Partial<Record<MetaKey, string>>;
}

/** Classify a file's directives. Returns null unless a REQUIRED human key (source/license) is
 *  missing — that's the ONLY thing this modal exists to collect. Missing machine keys alone (id /
 *  hash / updated-at / schema) do NOT open it: they're auto-filled silently, and a stale-but-present
 *  hash is a DRIFT case handled by the separate "data changed, bump the date?" pop-up, not here.
 *  Never throws and never blocks loading — the caller degrades with fallbacks and surfaces this. */
export function checkFileMeta(file: string, directives: Map<MetaKey, string>): MetaIssue | null {
	const missingHuman = HUMAN_KEYS.filter((k) => !directives.has(k));
	if (missingHuman.length === 0) return null;
	const missingAuto = AUTOFILL_KEYS.filter((k) => !directives.has(k));
	const missingOptional = OPTIONAL_KEYS.filter((k) => !directives.has(k));
	const values: Partial<Record<MetaKey, string>> = {};
	for (const k of EDITABLE_KEYS) {
		const v = directives.get(k);
		if (v !== undefined) values[k] = v;
	}
	return { file, missingHuman, missingAuto, missingOptional, values };
}

/** A file whose body no longer matches its recorded `#content-hash:` — the DATA was edited outside the
 *  app after the header was last stamped. Drives the separate "data changed, bump the date?" pop-up. */
export interface DriftItem {
	file: string;
	/** what the header claims as the revision date (`#content-updated-at`), or undefined if absent. */
	declaredDate?: string | undefined;
	/** filesystem mtime — when the file was ACTUALLY last touched (ISO date); undefined where the
	 *  storage can't report it (e.g. the read-only web/fetch source). */
	changedAt?: string | undefined;
}

/** Drift = a hash was recorded AND it no longer matches the freshly-recomputed body hash. An ABSENT
 *  stored hash is "missing" (auto-filled silently), NOT drift — so this returns false for it. This is
 *  the single detector; the recompute lives with the hasher, this just compares. */
export function isHashDrift(storedHash: string | undefined, recomputedHash: string): boolean {
	return storedHash !== undefined && storedHash !== recomputedHash;
}
