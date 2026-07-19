import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseToken, splitGuard } from '../effects/token-parser';

/*
 * Guards the SHIPPED condition data (CONDITIONS-1 authoring): the `effects` column we filled must
 * load cleanly, re-hash without drift, and contain only KNOWN effect tokens — a typo'd token would
 * silently become an inert note, so pin it here. Reads the real content/ files, not a fixture.
 */
const EDITIONS = [
	['5.5e', 'content/srd-2024/conditions_srd.csv'],
	['5e', 'content/srd-2014/conditions_srd.csv']
] as const;

async function loadEdition(path: string) {
	const csv = readFileSync(`${process.cwd()}/${path}`, 'utf8');
	const s = new MemoryStorage();
	await s.write('c/conditions_srd.csv', csv);
	return loadContent(s, ['c']);
}

describe('shipped conditions · effects column is engine-valid', () => {
	for (const [edition, path] of EDITIONS) {
		describe(edition, () => {
			it('loads with no errors and no hash drift (the re-stamp is correct)', async () => {
				const g = await loadEdition(path);
				expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
				expect(g.driftItems).toEqual([]);
			});

			it('every effect token is a KNOWN kind (no typo degrading to an inert note)', async () => {
				const g = await loadEdition(path);
				const rows = g.list('condition');
				expect(rows.length).toBeGreaterThan(10);
				for (const row of rows)
					for (const raw of row.data.effects ?? []) {
						const kind = parseToken(splitGuard(raw).token).kind;
						expect(kind, `${row.id}: "${raw}"`).not.toBe('unknown');
					}
			});

			it('wires the key mechanics (paralyzed / incapacitated / prone)', async () => {
				const g = await loadEdition(path);
				const effectsOf = (id: string) =>
					g.list('condition').find((r) => r.id === id)?.data.effects ?? [];
				// paralyzed: chains incapacitated, drops speed, auto-fails STR/DEX saves
				expect(effectsOf('paralyzed')).toEqual(
					expect.arrayContaining([
						'apply_condition:incapacitated',
						'set_override:speed:0',
						'auto_fail:save.str',
						'auto_fail:save.dex'
					])
				);
				// prone carries at least one display-only note (attacks against you)
				expect(effectsOf('prone').some((t) => t.startsWith('note:'))).toBe(true);
			});
		});
	}
});
