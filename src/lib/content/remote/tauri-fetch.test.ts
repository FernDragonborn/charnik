/*
 * The one thing in the Tauri fetcher worth a test without a Tauri: the SIZE CEILING.
 *
 * It used to be checked after `res.text()`, which bounds what we use and not what we hold — a body
 * with no `Content-Length` (or a lying one) was fully buffered and only then refused. The plugin
 * streams the body over IPC chunk by chunk, so counting as it arrives is both possible and the only
 * version that actually protects memory.
 */
import { describe, it, expect, vi } from 'vitest';
import { MAX_REMOTE_BYTES } from './types';

const tauriFetch = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: unknown[]) => tauriFetch(...args) }));

const { tauriFetcher } = await import('./tauri-fetch');

/** A response whose body arrives in chunks and declares NO length — the case the header check
 *  cannot answer. `cancelled` records whether the reader stopped it early. */
function streamed(
	chunkCount: number,
	chunkSize: number
): { res: Response; cancelled: () => boolean } {
	let cancelled = false;
	let sent = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent++ >= chunkCount) return controller.close();
			controller.enqueue(new Uint8Array(chunkSize));
		},
		cancel() {
			cancelled = true;
		}
	});
	return { res: new Response(body, { status: 200 }), cancelled: () => cancelled };
}

describe('the response size ceiling', () => {
	it('refuses a body that goes over it, and stops pulling the rest', async () => {
		const mb = 1024 * 1024;
		const { res, cancelled } = streamed(MAX_REMOTE_BYTES / mb + 2, mb);
		tauriFetch.mockResolvedValueOnce(res);

		const out = await tauriFetcher.getText('https://raw.githubusercontent.com/o/r/main/big.csv');

		expect(out).toEqual({ kind: 'error', message: 'response too large' });
		expect(cancelled()).toBe(true); // the transfer is stopped, not just the result discarded
	});

	it('reads an ordinary body through', async () => {
		const { res } = streamed(1, 16);
		tauriFetch.mockResolvedValueOnce(res);

		const out = await tauriFetcher.getBytes('https://raw.githubusercontent.com/o/r/main/a.csv');

		expect(out).toEqual({ kind: 'ok', bytes: new Uint8Array(16) });
	});

	it('refuses a body that ADMITS to being too big without reading a byte', async () => {
		const { res, cancelled } = streamed(1, 16);
		Object.defineProperty(res, 'headers', {
			value: new Headers({ 'content-length': String(MAX_REMOTE_BYTES + 1) })
		});
		tauriFetch.mockResolvedValueOnce(res);

		expect(
			await tauriFetcher.getBytes('https://raw.githubusercontent.com/o/r/main/big.csv')
		).toEqual({ kind: 'error', message: 'response too large' });
		expect(cancelled()).toBe(false); // never started
	});

	it('refuses a URL whose scheme merely STARTS with https', async () => {
		tauriFetch.mockClear();
		const out = await tauriFetcher.getText('httpsx://evil.example/x');

		expect(out.kind).toBe('error');
		expect(tauriFetch).not.toHaveBeenCalled();
	});
});
