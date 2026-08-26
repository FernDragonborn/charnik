/**
 * Content-file metadata directives (the `#content-<key>: <value>` header block) + the
 * required-field check that drives the "content meta review" modal (DATA-VER-1, docs/plan.md).
 *
 * The header is a run of leading `#content-<key>: <value>` comment lines before the CSV column
 * header, in any order. This module is the single parser + the pure classifier of what's missing;
 * it does NO IO and imports no Svelte/Tauri (thin-component + pure-core rules).
 */

/** One directive line: `#content-<key>: <value>`. The key is snake_case (matching the CSV columns);
 *  a legacy hyphen is accepted and normalized to `_` on read, so pre-snake files still parse. */
const DIRECTIVE = /^\s*#\s*content-([a-z][a-z_-]*)\s*:\s*(.*)$/i;

/** Every directive key, as ONE list the type is derived from — so code that has to ITERATE the keys
 *  (the re-stamper folding in collected values) walks the same set the type admits, with no cast and
 *  no second copy to drift. */
export const META_KEYS = [
	'type',
	'id',
	'source',
	'url',
	'license',
	'author',
	'author_url',
	'systems',
	'source_lang',
	'schema',
	'updated_at',
	'hash',
] as const;

export type MetaKey = (typeof META_KEYS)[number];

/** What the metadata prompt hands back: file → the directive values the user typed or picked.
 *  Lives here rather than in the modal because the write-back consumes it (`content/restamp.ts`). */
export type FilledMeta = Record<string, Partial<Record<MetaKey, string>>>;

/** Keys the app can fill with NO human input — generate/compute + write back (DATA-VER-1). */
const AUTOFILL_KEYS: readonly MetaKey[] = ['id', 'hash', 'updated_at', 'schema'];

/** Keys only a human knows the semantics of — REQUIRED, must be prompted (or collected by the
 *  authoring form). `type` falls back to the filename so it's not here. */
const HUMAN_KEYS: readonly MetaKey[] = ['source', 'license'];

/** Keys we OFFER to fill when the modal is already open, but whose absence does NOT trigger it on its
 *  own — all have a safe fallback (`systems` → both editions; the rest are simply optional metadata).
 *  Shown as optional inputs so the user can see every field that could be filled. */
export const OPTIONAL_KEYS: readonly MetaKey[] = ['systems', 'url', 'author', 'author_url'];

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
		let line = (lines[i] ?? '').replace(/\r$/, '');
		if (i === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1); // strip a leading BOM
		if (line.trim() === '') continue; // allow blank spacer lines inside the header block
		const m = DIRECTIVE.exec(line);
		const key = m?.[1];
		const value = m?.[2];
		if (key === undefined || value === undefined) break; // first real (non-directive) line → body
		// normalize a legacy kebab key to snake (`updated-at` → `updated_at`) so pre-snake files parse
		directives.set(key.toLowerCase().replace(/-/g, '_') as MetaKey, value.trim());
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

/**
 * The three states a file's `#content-hash` can be in. THREE, not two: the two consumers want
 * opposite defaults for the missing case, and a boolean forced one of them to be wrong.
 *
 * The drift detector wants "no hash yet" to be quiet — it is an unstamped file, auto-filled without
 * a word (see `checkFileMeta`), not data that changed. The overwrite guard wants the opposite: it
 * cannot verify the file, so it must not touch it. Naming the third state lets each say what it
 * means at the call site instead of one of them living with the wrong default.
 */
export const HASH_STATE = {
	/** the body still hashes to what the header claims */
	match: 'match',
	/** a hash was recorded and no longer matches — the DATA was edited after the last stamp */
	drift: 'drift',
	/** no `#content-hash` at all: nothing to compare, so nothing is known */
	unstamped: 'unstamped',
} as const;
export type HashState = (typeof HASH_STATE)[keyof typeof HASH_STATE];
