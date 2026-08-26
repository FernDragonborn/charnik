/*
 * The runtime `RemoteFetcher` — HTTPS through `@tauri-apps/plugin-http`, i.e. a client in RUST.
 *
 * This is the only file in the content layer that imports Tauri (the same exemption
 * `storage/tauri.ts` has, and for the same reason). Doing this with webview `fetch` would mean
 * relaxing the shipped `connect-src` invariant — docs/internals/security.md §5 — so don't.
 *
 * Which hosts are reachable is declared in `src-tauri/capabilities/default.json`, NOT here: a
 * capability is compiled into the binary and cannot be widened at runtime by config, a bad URL, or
 * a bug up here. The checks in this file are the second layer, not the boundary.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { MAX_REMOTE_BYTES, type FetchResult, type RemoteFetcher } from './types';

/** Refuse anything that isn't plain `https:` before it reaches the client — the capability denies
 *  `http://` too, but failing here gives a message instead of an opaque plugin error.
 *  An EXACT scheme match: `startsWith` also accepted `httpsx:`, in the one function whose whole job
 *  is to be the second line of defence. */
function assertHttps(url: string): void {
	if (URL.parse(url)?.protocol !== 'https:') throw new Error(`not an https URL: ${url}`);
}

/**
 * Wall-clock ceiling for one request, not just for the handshake.
 *
 * `connectTimeout` covers reaching the host; a server that ACCEPTS the connection and then says
 * nothing is not covered by it, and the request never settles. That is not one slow check: every
 * pack operation shares a single queue (`serialised` in updates.svelte.ts), so one hung request
 * wedges checking, installing, applying and the launch-time restore until the app is restarted.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** The cheap refusal: a body that ADMITS to being too big never gets read at all. */
function declaredTooLarge(res: Response): boolean {
	const declared = Number(res.headers.get('content-length'));
	return Number.isFinite(declared) && declared > MAX_REMOTE_BYTES;
}

/**
 * Read a body with a hard ceiling, `null` when it is crossed.
 *
 * The header check above is a courtesy — `Content-Length` can be absent (chunked) or simply a lie,
 * and the previous version answered that by buffering the WHOLE body and refusing it afterwards,
 * which bounds what we use and not what we hold. This counts as it goes and cancels the stream.
 *
 * Cancelling is worth something here: `plugin-http` pulls the body over IPC chunk by chunk and
 * releases the Rust-side resources when the stream is dropped, so the transfer actually stops rather
 * than finishing into a buffer nobody wanted.
 */
async function readCapped(res: Response): Promise<Uint8Array | null> {
	const reader = res.body?.getReader();
	if (!reader) return new Uint8Array(); // a null-body status (204/304) is legitimately empty
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done || value === undefined) break;
		total += value.byteLength;
		if (total > MAX_REMOTE_BYTES) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
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
				connectTimeout: 15_000,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (res.status === 304) return { kind: 'notModified' };
			if (!res.ok) return { kind: 'error', status: res.status, message: res.statusText };
			if (declaredTooLarge(res)) return { kind: 'error', message: 'response too large' };
			const bytes = await readCapped(res);
			if (bytes === null) return { kind: 'error', message: 'response too large' };
			const body = new TextDecoder().decode(bytes);
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
			const res = await tauriFetch(url, {
				method: 'GET',
				connectTimeout: 15_000,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!res.ok) return { kind: 'error' as const, message: `${res.status} ${res.statusText}` };
			if (declaredTooLarge(res)) return { kind: 'error' as const, message: 'response too large' };
			const bytes = await readCapped(res);
			if (bytes === null) return { kind: 'error' as const, message: 'response too large' };
			return { kind: 'ok' as const, bytes };
		} catch (e) {
			return { kind: 'error' as const, message: e instanceof Error ? e.message : String(e) };
		}
	},
};
