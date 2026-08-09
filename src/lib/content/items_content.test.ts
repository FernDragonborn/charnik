import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseToken, splitGuard } from '../effects/token-parser';

/*
 * Guards the SHIPPED magic-item data (MAGIC-ITEM-EFX authoring): the `effects` tokens we filled must
 * load cleanly, re-hash without drift, and be KNOWN kinds — a typo'd token silently degrades to an
 * inert note, which is exactly the failure this data is meant to fix. Reads the real content/ files.
 *
 * The VALUES are hand-checked against each edition's own SRD text, so they're asserted literally: a
 * converter re-run that wipes the column (the class_features/conditions failure mode) fails here.
 */
const EDITIONS = [
	['5.5e', 'content/srd-2024/items_srd.csv'],
	['5e', 'content/srd-2014/items_srd.csv']
] as const;

async function loadEdition(path: string) {
	const csv = readFileSync(`${process.cwd()}/${path}`, 'utf8');
	const s = new MemoryStorage();
	await s.write('c/items_srd.csv', csv);
	return loadContent(s, ['c']);
}

describe('shipped magic items · effects column is engine-valid', () => {
	for (const [edition, path] of EDITIONS) {
		describe(edition, () => {
			it('loads with no errors and no hash drift (the re-stamp is correct)', async () => {
				const g = await loadEdition(path);
				expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
				expect(g.driftItems).toEqual([]);
			});

			it('every authored token is a KNOWN kind (no typo degrading to an inert note)', async () => {
				const g = await loadEdition(path);
				const withEffects = g.list('item').filter((r) => (r.data.effects ?? []).length > 0);
				expect(withEffects.length).toBeGreaterThan(5);
				for (const row of withEffects)
					for (const raw of row.data.effects ?? []) {
						const kind = parseToken(splitGuard(raw).token).kind;
						expect(kind, `${row.id}: "${raw}"`).not.toBe('unknown');
					}
			});

			it('the protective items carry their +1 AC AND +1 saves (the DEMO-1 gap)', async () => {
				const g = await loadEdition(path);
				for (const id of ['cloak_of_protection', 'ring_of_protection']) {
					const row = g.list('item').find((r) => r.id === id);
					expect(row?.data.effects, id).toEqual(['flat_bonus:ac+1', 'flat_bonus:saves+1']);
				}
			});

			it('an ability-setting item uses a FLOOR set, so a higher score is never dragged down', async () => {
				const g = await loadEdition(path);
				const byId = (id: string) => g.list('item').find((r) => r.id === id)?.data.effects;
				// RAW: "…is 19. It has no effect if your <ability> is already 19 or higher."
				expect(byId('amulet_of_health')).toEqual(['set_override:con:19:floor']);
				expect(byId('headband_of_intellect')).toEqual(['set_override:int:19:floor']);
				expect(byId('gauntlets_of_ogre_power')).toEqual(['set_override:str:19:floor']);
			});

			it('Bracers of Defense carry the no-armour-no-shield GUARD, not a bare +2 AC', async () => {
				const g = await loadEdition(path);
				const [token] =
					g.list('item').find((r) => r.id === 'bracers_of_defense')?.data.effects ?? [];
				const { guard, token: effect } = splitGuard(token ?? '');
				expect(guard).toBe('not is_wearing_armor and not is_wearing_shield');
				expect(effect).toBe('flat_bonus:ac+2');
			});
		});
	}
});
