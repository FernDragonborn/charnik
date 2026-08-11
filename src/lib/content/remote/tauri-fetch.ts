/*
 * The runtime `RemoteFetcher` — HTTPS through `@tauri-apps/plugin-http`, i.e. a client in RUST.
 *
 * This is the only file in the content layer that imports Tauri (the same exemption
 * `storage/tauri.ts` has, and for the same reason). Doing this with webview `fetch` would mean
 * relaxing the shipped `connect-src` invariant — docs/SECURITY.md §5 — so don't.
 *
 * Which hosts are reachable is declared in `src-tauri/capabilities/default.json`, NOT here: a
 * capability is compiled into the binary and cannot be widened at runtime by config, a bad URL, or
 * a bug up here. The checks in this file are the second layer, not the boundary.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { MAX_REMOTE_BYTES, type FetchResult, type RemoteFetcher } from './types';

/** Refuse anything that isn't plain `https:` before it reaches the client — the capability denies
 *  `http://` too, but failing here gives a message instead of an opaque plugin error. */
function assertHttps(url: string): void {
	if (!URL.parse(url)?.protocol.startsWith('https')) throw new Error(`not an https URL: ${url}`);
}

/** Guard against a body that would blow memory up, using the declared length when there is one and
 *  the actual size when there isn't (a lying or absent `Content-Length` must not get a free pass). */
function tooLarge(res: Response, actual?: number): boolean {
	const declared = Number(res.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_REMOTE_BYTES) return true;
	return actual !== undefined && actual > MAX_REMOTE_BYTES;
}

export const tauriFetcher: RemoteFetcher = {
	async getText(url: string, etag?: string): Promise<FetchResult> {
		try {
			assertHttps(url);
			const res = await tauriFetch(url, {
				method: 'GET',
				// a conditional request: 304 costs no rate-limit quota, which is what makes checking
				// several packs from one repo effectively free in the steady state
				headers: etag === undefined ? {} : { 'If-None-Match': etag },
				connectTimeout: 15_000
			});
			if (res.status === 304) return { kind: 'notModified' };
			if (!res.ok) return { kind: 'error', status: res.status, message: res.statusText };
			if (tooLarge(res)) return { kind: 'error', message: 'response too large' };
			const body = await res.text();
			if (tooLarge(res, body.length)) return { kind: 'error', message: 'response too large' };
			const next = res.headers.get('etag');
			return next === null ? { kind: 'ok', body } : { kind: 'ok', body, etag: next };
		} catch (e) {
			// offline is the common case and must stay quiet (UX-1: an error the user can't act on
			// shouldn't jump at them) — so it is a value, not a throw.
			return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
		}
	},

	async getBytes(url: string) {
		try {
			assertHttps(url);
			const res = await tauriFetch(url, { method: 'GET', connectTimeout: 15_000 });
			if (!res.ok) return { kind: 'error' as const, message: `${res.status} ${res.statusText}` };
			if (tooLarge(res)) return { kind: 'error' as const, message: 'response too large' };
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (tooLarge(res, bytes.length))
				return { kind: 'error' as const, message: 'response too large' };
			return { kind: 'ok' as const, bytes };
		} catch (e) {
			return { kind: 'error' as const, message: e instanceof Error ? e.message : String(e) };
		}
	}
};
