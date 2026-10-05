/*
 * The runtime `RemoteFetcher` — HTTPS through a client in RUST (`src-tauri/src/remote.rs`).
 *
 * This is the only file in the content layer that imports Tauri (the same exemption
 * `storage/tauri.ts` has, and for the same reason). Doing this with webview `fetch` would mean
 * relaxing the shipped `connect-src` invariant — docs/internals/security.md §5 — so don't.
 *
 * Which hosts are reachable, that the method is `GET`, the size ceiling and the time limit are all
 * decided in Rust, NOT here: they are compiled into the binary and cannot be widened at runtime by
 * config, a bad URL, or a bug up here. The page hands over an address and, for a listing, the
 * `ETag` to replay — nothing else. The check in this file is the second layer, not the boundary.
 */
import { invoke } from '@tauri-apps/api/core';
import type { FetchResult, RemoteFetcher } from './types';

/** Refuse anything that isn't plain `https:` before it reaches the client — Rust refuses it too,
 *  but failing here gives a message that names the address.
 *  An EXACT scheme match: `startsWith` also accepted `httpsx:`, in the one function whose whole job
 *  is to be the second line of defence. */
function assertHttps(url: string): void {
	if (URL.parse(url)?.protocol !== 'https:') throw new Error(`not an https URL: ${url}`);
}

/** What `fetch_pack_text` answers. A 304 and an error status carry no body. */
interface TextReply {
	status: number;
	etag: string | null;
	body: string | null;
}

const NOT_MODIFIED = 304;

export const tauriFetcher: RemoteFetcher = {
	async getText(url: string, etag?: string): Promise<FetchResult> {
		try {
			assertHttps(url);
			// a conditional request: 304 costs no rate-limit quota, which is what makes checking
			// several packs from one repo effectively free in the steady state
			const res = await invoke<TextReply>('fetch_pack_text', { url, etag: etag ?? null });
			if (res.status === NOT_MODIFIED) return { kind: 'notModified' };
			if (res.body === null)
				return { kind: 'error', status: res.status, message: `HTTP ${res.status}` };
			return res.etag === null
				? { kind: 'ok', body: res.body }
				: { kind: 'ok', body: res.body, etag: res.etag };
		} catch (e) {
			// offline is the common case and must stay quiet (UX-1: an error the user can't act on
			// shouldn't jump at them) — so it is a value, not a throw.
			return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
		}
	},

	async getBytes(url: string) {
		try {
			assertHttps(url);
			const bytes = await invoke<ArrayBuffer>('fetch_pack_bytes', { url });
			return { kind: 'ok' as const, bytes: new Uint8Array(bytes) };
		} catch (e) {
			return { kind: 'error' as const, message: e instanceof Error ? e.message : String(e) };
		}
	},
};
