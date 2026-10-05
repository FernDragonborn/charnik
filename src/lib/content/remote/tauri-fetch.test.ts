/*
 * The Tauri fetcher without a Tauri: what it hands to Rust, and how it reads the answer back.
 *
 * The method, the hosts, the time limit and the size ceiling are Rust's and are tested there
 * (`src-tauri/src/remote.rs`). What is left up here is the seam's own contract — a 304 is "not
 * modified", an error status is a value and not a throw, offline stays quiet — and the second line
 * of defence on the scheme.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriFetcher } = await import('./tauri-fetch');

const TREE = 'https://api.github.com/repos/o/r/git/trees/main?recursive=1';
const FILE = 'https://raw.githubusercontent.com/o/r/main/a.csv';

describe('the desktop pack fetcher', () => {
	beforeEach(() => invoke.mockReset());

	it('asks Rust for an address and an ETag, and nothing else', async () => {
		invoke.mockResolvedValueOnce({ status: 200, etag: 'W/"2"', body: '{}' });
		const out = await tauriFetcher.getText(TREE, 'W/"1"');
		expect(invoke).toHaveBeenCalledExactlyOnceWith('fetch_pack_text', { url: TREE, etag: 'W/"1"' });
		expect(out).toEqual({ kind: 'ok', body: '{}', etag: 'W/"2"' });
	});

	it('reads a 304 as not modified, and an error status as a value', async () => {
		invoke.mockResolvedValueOnce({ status: 304, etag: null, body: null });
		expect(await tauriFetcher.getText(TREE, 'W/"1"')).toEqual({ kind: 'notModified' });
		invoke.mockResolvedValueOnce({ status: 403, etag: null, body: null });
		expect(await tauriFetcher.getText(TREE)).toEqual({
			kind: 'error',
			status: 403,
			message: 'HTTP 403',
		});
	});

	it('answers a refusal or a dead network with an error, never a throw', async () => {
		invoke.mockRejectedValueOnce('response too large');
		expect(await tauriFetcher.getText(TREE)).toEqual({
			kind: 'error',
			message: 'response too large',
		});
		invoke.mockRejectedValueOnce(new Error('offline'));
		expect(await tauriFetcher.getBytes(FILE)).toEqual({ kind: 'error', message: 'offline' });
	});

	it('hands a file back byte for byte', async () => {
		invoke.mockResolvedValueOnce(new Uint8Array([239, 187, 191, 13, 10]).buffer);
		expect(await tauriFetcher.getBytes(FILE)).toEqual({
			kind: 'ok',
			bytes: new Uint8Array([239, 187, 191, 13, 10]),
		});
	});

	it('refuses a URL whose scheme merely STARTS with https', async () => {
		const out = await tauriFetcher.getText('httpsx://evil.example/x');
		expect(out.kind).toBe('error');
		expect(invoke).not.toHaveBeenCalled();
	});
});
