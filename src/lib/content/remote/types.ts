/*
 * The remote-fetch seam (REL-4 slice 2). Everything above it — the check/diff/apply logic and the
 * GitHub adapter — talks to this interface and never knows that the real implementation is an HTTP
 * client in Rust. Same shape as the `Storage` seam, and for the same two reasons: the webview must
 * not be given network reach (docs/SECURITY.md §5), and the logic has to be testable without one.
 */

/** A conditional GET result. `notModified` is the case worth designing for: a `304` from an `ETag`
 *  costs no GitHub rate-limit quota, so a steady state where nothing changed is free forever. */
export type FetchResult =
	| { kind: 'ok'; body: string; etag?: string }
	| { kind: 'notModified' }
	| { kind: 'error'; status?: number; message: string };

export interface RemoteFetcher {
	/** Conditional GET of a text resource (the repo tree listing). `etag` replays as `If-None-Match`. */
	getText(url: string, etag?: string): Promise<FetchResult>;
	/** GET one file's exact bytes — content files are stored byte-for-byte (BOM/EOL matter). */
	getBytes(
		url: string
	): Promise<{ kind: 'ok'; bytes: Uint8Array } | { kind: 'error'; message: string }>;
}

/** Bytes above this are refused rather than buffered — a content CSV is measured in hundreds of KB,
 *  and an unbounded read of a remote body is a memory-blowup waiting to happen (SECURITY.md §8). */
export const MAX_REMOTE_BYTES = 8 * 1024 * 1024;

/**
 * …and the same question asked of a whole PACK, which `MAX_REMOTE_BYTES` cannot answer: it bounds one
 * response, so fifty thousand small files pass it fifty thousand times over. `download` mode fetches
 * without asking, so a repo like that is an automatic unbounded download — the cap has to be read off
 * the tree listing, which arrives in one request and states every path and size, and it has to be
 * read BEFORE the first file is asked for.
 *
 * Sized against the thing we ship: the SRD pack is 15 files and about 2 MB, so this leaves roughly a
 * factor of thirty for a large third-party compendium with illustrations or plugins. Raise them here
 * if a legitimate pack ever hits one — they are a guard against a runaway, not a statement about how
 * big content is allowed to be.
 */
export const MAX_PACK_FILES = 200;
export const MAX_PACK_BYTES = 50 * 1024 * 1024;

/**
 * A failure the UI can show. Two kinds on purpose: `i18n` is copy WE author (translatable, values
 * interpolated by the component), `raw` is what the network stack handed us — a machine string we
 * must not pretend to have written. Keeping them apart is what stops new untranslated English
 * leaking into the UI, and leaves the UX-1 copy sweep dealing with keys only.
 */
export type UpdateError =
	// numbers stay numbers: a plural rule can't work on "3"
	| { kind: 'i18n'; key: string; values: Record<string, string | number> }
	| { kind: 'raw'; message: string };
