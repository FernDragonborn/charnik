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
