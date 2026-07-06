/**
 * Content-body hashing for the change/drift detector (DATA-VER-1, docs/PLAN.md).
 *
 * We hash the NORMALISED body only — the CSV column header + data rows, with the `#content-*:`
 * directive block stripped off (so bumping `updated-at` or the hash line itself never changes the
 * hash; only the DATA does). Normalisation (LF newlines, no BOM, trimmed trailing whitespace/blank
 * lines) makes the hash survive an Excel re-save that only touched line endings — but row ORDER is
 * preserved, so a genuine reorder is a real change. The hash is xxHash64 (via `xxhash-wasm`, a fast
 * proven lib — not a hand-rolled hash); the `xxh64:` prefix lets the algorithm be swapped later.
 */
import xxhash from 'xxhash-wasm';
import { parseContentDirectives } from './meta';

export const HASH_PREFIX = 'xxh64:';

type Hasher = Awaited<ReturnType<typeof xxhash>>;
let hasher: Promise<Hasher> | null = null;
/** The WASM module inits once and is reused (async, cached). */
function api(): Promise<Hasher> {
	return (hasher ??= xxhash());
}

/** The canonical form we hash: directive block removed, BOM stripped, CRLF/CR→LF, trailing
 *  whitespace per line trimmed, trailing blank lines dropped. Exported for tests. */
export function normalizeBody(csv: string): string {
	const { body } = parseContentDirectives(csv);
	const noBom = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
	return noBom
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/, ''))
		.join('\n')
		.replace(/\n+$/, '');
}

/** `xxh64:<hex>` of the normalised body. Async because the xxHash WASM inits lazily (once). */
export async function hashBody(csv: string): Promise<string> {
	const { h64ToString } = await api();
	return HASH_PREFIX + h64ToString(normalizeBody(csv));
}
