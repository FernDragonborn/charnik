/*
 * Re-stamp a content file's `#content-*` header in place — the write half of DATA-VER-1 (task 6).
 *
 * Two callers, one function: the drift pop-up ("this file was hand-edited — adopt my version") and
 * the metadata pop-up ("here is the source/license you were missing"). Both mean the same thing to
 * the file: keep the BODY exactly as it is, fix the header, recompute the hash over the result.
 *
 * Why this may write a file the app did not create. The invariant next door is "the app writes only
 * files it owns", and it exists so a hand-edited CSV is never silently clobbered. Here the user has
 * ASKED, and only the two stamp lines move — the rows are the ones already on disk. Without it a
 * drifted file is unfixable from inside the app: `isProtectedFromOverwrite` refuses to refresh
 * anything that fails its own hash, so the file would stay frozen at whatever it drifted to, forever,
 * and the only cure would be a terminal command in a project built for people who do not have one.
 *
 * The original BOM and line endings are preserved BYTE-FOR-BYTE (shipped packs are LF/no-BOM,
 * app-written homebrew is CRLF/BOM). That is not cosmetic: a pack diff compares git blob SHAs, so
 * rewriting 2000 line endings to fix one header line would report the whole file as changed against
 * a repo where nothing moved — the `core.autocrlf` bug from REL-4 slice 11, re-created by us.
 */
import { CONTENT_SCHEMA_VERSION } from '$lib/schema/version';
import type { Storage } from '$lib/storage/types';
import { stampWithHash } from './hash';
import { META_KEYS, parseContentDirectives, type FilledMeta, type MetaKey } from './meta';

/** Machine keys filled only when ABSENT. `schema` is deliberately not bumped on an existing value:
 *  claiming a file sits at the current schema without migrating it would be a lie the loader
 *  believes (see `content/migrations.ts`). `hash` is always recomputed and so is not listed here. */
function fillMachineKeys(directives: Map<MetaKey, string>, today: string): void {
	if (!directives.has('id')) directives.set('id', crypto.randomUUID());
	if (!directives.has('schema')) directives.set('schema', String(CONTENT_SCHEMA_VERSION));
	if (!directives.has('updated_at')) directives.set('updated_at', today);
}

/** Restore the file's original BOM/EOL style — `stampWithHash` always emits BOM + CRLF. The BOM is
 *  dropped by code point rather than by a regex literal: an invisible character inside a pattern is
 *  a bad thing to have to trust, and it lints as irregular whitespace (same call as `hash.ts`). */
function matchStyle(stamped: string, original: string): string {
	const hadBom = original.charCodeAt(0) === 0xfeff;
	const body = hadBom || stamped.charCodeAt(0) !== 0xfeff ? stamped : stamped.slice(1);
	return original.includes('\r\n') ? body : body.replace(/\r\n/g, '\n');
}

/**
 * The pure half: a content file's text in, the re-stamped text out. `set` wins over what the file
 * declares (the values the modal collected); absent machine keys are filled; the hash is recomputed
 * over the final header + body. A file with NO header at all gets one — that is exactly the case the
 * metadata prompt exists for.
 */
export async function restampText(
	raw: string,
	set: Partial<Record<MetaKey, string>> = {},
	today: string = new Date().toISOString().slice(0, 10)
): Promise<string> {
	const { directives, body } = parseContentDirectives(raw);
	const next = new Map(directives);
	for (const key of META_KEYS) {
		const value = set[key];
		// an empty field means "the user left it blank", never "erase what the file already says"
		if (value !== undefined && value !== '') next.set(key, value);
	}
	fillMachineKeys(next, today);
	return matchStyle(await stampWithHash(next, body), raw);
}

/** One file that could not be re-stamped, with the reason — surfaced, never swallowed. */
export interface RestampFailure {
	file: string;
	error: string;
}

/**
 * The IO half: re-stamp each file through the `Storage` seam (atomic temp→rename in the real impls).
 * A file that throws does NOT stop the rest — one unreadable file must not leave the others frozen —
 * and comes back in the failure list for the caller to show.
 */
export async function restampFiles(
	storage: Storage,
	files: readonly string[],
	sets: FilledMeta = {}
): Promise<RestampFailure[]> {
	const failures: RestampFailure[] = [];
	for (const file of files) {
		try {
			await storage.write(file, await restampText(await storage.read(file), sets[file]));
		} catch (e) {
			failures.push({ file, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return failures;
}
