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
import { HASH_STATE } from './meta';
import { contentPacks, packDir } from '../../../tools/content-repo.mjs';
import { hasContentRepo, readPackFile } from '../../test-support/real-content';

describe.runIf(hasContentRepo)('shipped content stamps', () => {
	const files = hasContentRepo
		? contentPacks().flatMap((pack: string) =>
				readdirSync(packDir(pack))
					.filter((file: string) => file.endsWith('.csv'))
					.map((file: string) => [pack, file] as const)
			)
		: [];

	it('there are shipped CSVs to check at all', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)('%s/%s verifies its own hash', async (pack, file) => {
		expect(await fileHashState(readPackFile(pack, file))).toBe(HASH_STATE.match);
	});
});
