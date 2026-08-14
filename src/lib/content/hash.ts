/**
 * Content-file hashing for the change/drift detector (DATA-VER-1, docs/PLAN.md).
 *
 * We hash the WHOLE FILE — header directives included — minus two lines that are stamps ABOUT the
 * file rather than part of it (see `UNHASHED_DIRECTIVE`). Hashing only the body, as this did
 * originally, left `#content-source` outside the hash: the identity half of `source:id`, editable
 * with no drift reported, and the value the pack-update guard compares to decide whether an incoming
 * pack is the same pack. A field that decides identity has to be covered by the thing that says
 * "this file was edited".
 *
 * Normalisation (LF newlines, no BOM, trimmed trailing whitespace/blank lines) makes the hash
 * survive an Excel re-save that only touched line endings — but row ORDER is preserved, so a genuine
 * reorder is a real change. The hash is xxHash64 (via `xxhash-wasm`, a fast proven lib — not a
 * hand-rolled hash); the `xxh64:` prefix lets the algorithm be swapped later.
 *
 * The stamp is written FIRST in the header (`stampWithHash`), so verifying a file is "drop the top
 * line, hash the rest" rather than a search through the block.
 */
import xxhash from 'xxhash-wasm';
import {
	parseContentDirectives,
	stampDirectives,
	HASH_STATE,
	type HashState,
	type MetaKey,
} from './meta';

export const HASH_PREFIX = 'xxh64:';

/**
 * Header lines the hash does NOT cover:
 *  - `hash` itself — hashing the hash is not a thing.
 *  - `updated_at` — bumped by the very write that re-stamps the hash, so including it would change
 *    every file's hash on every re-run and defeat the converters' idempotent write. It is also the
 *    complement of the hash in the UI, which reads "changed · declared <date>": one says whether the
 *    data moved, the other says when the author last claimed it did.
 */
const UNHASHED_DIRECTIVE = /^\s*#\s*content-(hash|updated[_-]at)\s*:/i;

type Hasher = Awaited<ReturnType<typeof xxhash>>;
let hasher: Promise<Hasher> | null = null;
/** The WASM module inits once and is reused (async, cached). */
function api(): Promise<Hasher> {
	return (hasher ??= xxhash());
}

/** Drop a leading UTF-8 BOM. By code point rather than a literal, which lints as irregular
 *  whitespace — and an invisible character in a regex is a bad thing to have to trust. */
const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** The canonical form we hash: BOM stripped, CRLF/CR→LF, the two stamp lines dropped, trailing
 *  whitespace per line trimmed, trailing blank lines dropped. Exported for tests. */
export function hashInput(csv: string): string {
	return stripBom(csv)
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.filter((line) => !UNHASHED_DIRECTIVE.test(line))
		.map((line) => line.replace(/[ \t]+$/, ''))
		.join('\n')
		.replace(/\n+$/, '');
}

/** `xxh64:<hex>` of the normalised file. Async because the xxHash WASM inits lazily (once). */
export async function hashFile(csv: string): Promise<string> {
	const { h64ToString } = await api();
	return HASH_PREFIX + h64ToString(hashInput(csv));
}

/** The pre-header-hashing rule: the BODY only, with the whole directive block stripped. Kept ONLY so
 *  a file stamped by an older build still verifies instead of being reported as hand-edited (which,
 *  under the overwrite guard, would freeze it forever). Delete once a release has re-stamped
 *  everything. */
async function hashLegacyBody(csv: string): Promise<string> {
	const { h64ToString } = await api();
	const { body } = parseContentDirectives(csv);
	return (
		HASH_PREFIX +
		h64ToString(
			stripBom(body)
				.replace(/\r\n?/g, '\n')
				.split('\n')
				.map((line) => line.replace(/[ \t]+$/, ''))
				.join('\n')
				.replace(/\n+$/, ''),
		)
	);
}

/**
 * Does this file still hash to what its own header claims? The ONE verifier — both consumers (the
 * drift panel and the overwrite guard) read the same answer and only differ in what they do with
 * `unstamped`.
 */
export async function fileHashState(csv: string): Promise<HashState> {
	const stored = parseContentDirectives(csv).directives.get('hash');
	if (stored === undefined) return HASH_STATE.unstamped;
	if (stored === (await hashFile(csv))) return HASH_STATE.match;
	if (stored === (await hashLegacyBody(csv))) return HASH_STATE.match;
	return HASH_STATE.drift;
}

/**
 * Assemble a content file and stamp its `#content-hash` in one step — the only supported way to
 * write one, because the hash now covers the header and computing it by hand is a two-step dance
 * every caller would get subtly differently. The stamp is emitted FIRST (`stampDirectives` orders
 * it), and the input is the same file with the stamp lines absent, so writing and verifying agree
 * by construction.
 */
export async function stampWithHash(
	directives: Map<MetaKey, string>,
	body: string,
): Promise<string> {
	const withoutHash = new Map(directives);
	withoutHash.delete('hash');
	const hash = await hashFile(stampDirectives(withoutHash, body));
	return stampDirectives(new Map([['hash', hash], ...withoutHash]), body);
}
