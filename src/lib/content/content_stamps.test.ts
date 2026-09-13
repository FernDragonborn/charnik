/*
 * Every shipped CSV must verify its own `#content-hash`.
 *
 * This is the check that catches the most-repeated mistake in this repo: hand-editing a content CSV
 * and committing it without re-stamping (`pnpm restamp <file>`). Without it the miss is silent here
 * and loud in the app — the file shows up as "changed · declared <date>" in content health, and,
 * since the overwrite guard reads the same signal, the seed and every pack update stop touching it
 * forever, freezing that file at whatever the user has on disk.
 *
 * It also pins the writer/verifier agreement across the two implementations of the rule: the app's
 * `hashInput` and the converters' copy in `tools/srd/lib.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileHashState } from './hash';
import { HASH_STATE, parseContentDirectives } from './meta';
import { CONTENT_SEED_VERSION } from '$lib/schema/version';
import { contentPacks, packDir } from '../../../tools/content-repo.mjs';
import { hasContentRepo, readPackFile } from '../../test-support/real-content';

describe.runIf(hasContentRepo)('shipped content stamps', () => {
	const files = hasContentRepo
		? contentPacks().flatMap((pack: string) =>
				readdirSync(packDir(pack))
					.filter((file: string) => file.endsWith('.csv'))
					.map((file: string) => [pack, file] as const),
			)
		: [];

	it('there are shipped CSVs to check at all', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)('%s/%s verifies its own hash', async (pack, file) => {
		expect(await fileHashState(readPackFile(pack, file))).toBe(HASH_STATE.match);
	});
});

/*
 * The shipped SET, as one line: every pack's files with the hash each declares. A desktop install only
 * re-seeds when `CONTENT_SEED_VERSION` is HIGHER than the marker on disk, so shipped content that
 * changes without a bump can never reach an existing install — which has now happened twice, once for
 * a whole new file. The signature below is what makes the miss loud HERE instead of silent in the app:
 * when it changes, bump the constant and paste the new one in.
 */
const SEEDED_CONTENT = { version: 6, signature: 'c86e5c0ee24f8f9d' };

describe.runIf(hasContentRepo)('the shipped set and the seed version move together', () => {
	it('content that changed since the last bump is a bump', () => {
		const parts = contentPacks().map((pack: string) => {
			const files = readdirSync(packDir(pack))
				.filter((file: string) => file.endsWith('.csv'))
				.sort();
			const hashes = files.map(
				(file: string) =>
					parseContentDirectives(readPackFile(pack, file)).directives.get('hash') ?? '',
			);
			return `${pack}:${files.length}/${files.join(',')}/${hashes.join(',')}`;
		});
		expect({ version: CONTENT_SEED_VERSION, signature: digest(parts.join('|')) }).toEqual(
			SEEDED_CONTENT,
		);
	});
});

/** A short stable fingerprint of the whole shipped set — its files and the hash each declares. */
function digest(text: string): string {
	let h = 0n;
	for (const ch of text) h = (h * 1099511628211n + BigInt(ch.codePointAt(0) ?? 0)) % (1n << 64n);
	return h.toString(16);
}
