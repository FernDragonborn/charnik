/*
 * Re-stamp a content file's `#content-*` header in place — the write half of DATA-VER-1 (task 6).
 *
 * Both callers (the drift pop-up and the metadata pop-up) mean the same thing to the file: keep the
 * BODY as it is, fix the header, recompute the hash over the result.
 *
 * **It may write a file the app did not create**, against the neighbouring "the app writes only
 * files it owns". The user has ASKED, and only the stamp lines move — without this a drifted file is
 * unfixable from inside the app, since `isProtectedFromOverwrite` refuses to refresh anything
 * failing its own hash.
 *
 * **The original BOM and line endings survive byte-for-byte** (packs are LF/no-BOM, app-written
 * homebrew is CRLF/BOM). A pack diff compares git blob SHAs, so normalising them would report the
 * whole file as changed against a repo where nothing moved.
 */
import { CONTENT_SCHEMA_VERSION } from '#lib/schema/version.ts';
import type { Storage } from '#lib/storage/types.ts';
import { fileHashState, stampWithHash } from './hash';
import { HOMEBREW_ROOT } from './homebrew';
import {
	HASH_STATE,
	META_KEYS,
	parseContentDirectives,
	type FilledMeta,
	type MetaKey,
} from './meta';

/** Machine keys filled only when ABSENT. `schema` is deliberately not bumped on an existing value:
 *  claiming a file sits at the current schema without migrating it would be a lie the loader
 *  believes (see `content/migrations.ts`). `hash` is always recomputed and so is not listed here. */
function fillMachineKeys(directives: Map<MetaKey, string>, today: string): void {
	if (!directives.has('id')) directives.set('id', crypto.randomUUID());
	if (!directives.has('schema')) directives.set('schema', String(CONTENT_SCHEMA_VERSION));
	if (!directives.has('updated_at')) directives.set('updated_at', today);
}

/** Restore the file's original BOM/EOL style — `stampWithHash` always emits BOM + CRLF. The BOM goes
 *  by code point, not by a regex literal: an invisible character in a pattern lints as irregular
 *  whitespace and is a bad thing to have to trust (same call as `hash.ts`). */
export function matchStyle(stamped: string, original: string): string {
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
	today: string = new Date().toISOString().slice(0, 10),
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

/** Who is asking for the re-stamp — which decides whether a file the user changed stays theirs. */
export const RESTAMP_FOR = {
	/** The maintainer's terminal (`pnpm restamp`): the file is the pack's own and stays replaceable. */
	pack: 'pack',
	/** The user, from inside the app: a file that drifted or was never stamped is theirs, and the
	 *  stamp records that before the hash goes clean (audit-oct-27 D1). */
	user: 'user',
} as const;
export type RestampFor = (typeof RESTAMP_FOR)[keyof typeof RESTAMP_FOR];

/** The text with `#content-adopted` set when the user is restamping a file the pack would not
 *  recognise as its own; a pristine file is left replaceable. */
async function adoptedIfUsers(
	file: string,
	raw: string,
	set: Partial<Record<MetaKey, string>> | undefined,
	today: string,
): Promise<Partial<Record<MetaKey, string>>> {
	const own = (await fileHashState(raw)) !== HASH_STATE.match;
	// homebrew is never a pack's to replace, so there is nothing to claim it from
	const already = parseContentDirectives(raw).directives.has('adopted');
	const homebrew = file.startsWith(`${HOMEBREW_ROOT}/`);
	return own && !already && !homebrew ? { ...set, adopted: today } : { ...set };
}

/** Take the user's claim off a file: updates may replace it again. */
export async function releaseAdoptedText(raw: string): Promise<string> {
	const { directives, body } = parseContentDirectives(raw);
	directives.delete('adopted');
	return matchStyle(await stampWithHash(directives, body), raw);
}

/**
 * The IO half: re-stamp each file through the `Storage` seam (atomic temp→rename in the real impls).
 * A file that throws does NOT stop the rest — one unreadable file must not leave the others frozen —
 * and comes back in the failure list for the caller to show.
 */
export async function restampFiles(
	storage: Storage,
	files: readonly string[],
	sets: FilledMeta = {},
	restampFor: RestampFor = RESTAMP_FOR.pack,
): Promise<RestampFailure[]> {
	const failures: RestampFailure[] = [];
	const today = new Date().toISOString().slice(0, 10);
	for (const file of files) {
		try {
			const raw = await storage.read(file);
			const set =
				restampFor === RESTAMP_FOR.user
					? await adoptedIfUsers(file, raw, sets[file], today)
					: sets[file];
			await storage.write(file, await restampText(raw, set, today));
		} catch (e) {
			failures.push({ file, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return failures;
}
