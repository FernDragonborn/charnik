import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseToken, splitGuard } from '../effects/token-parser';
import { readPackFile, loadPacks } from '../../test-support/real-content';
import { newCharacter, characterSchema } from '../character/schema';
import { deriveSheet } from '../character/derive';

/*
 * Guards the SHIPPED magic-item data (MAGIC-ITEM-EFX authoring): the `effects` tokens we filled must
 * load cleanly, re-hash without drift, and be KNOWN kinds — a typo'd token silently degrades to an
 * inert note, which is exactly the failure this data is meant to fix. Reads the real shipped files.
 *
 * The VALUES are hand-checked against each edition's own SRD text, so they're asserted literally: a
 * converter re-run that wipes the column (the class_features/conditions failure mode) fails here.
 */
const EDITIONS = [
	['5.5e', 'srd-2024'],
	['5e', 'srd-2014'],
] as const;

async function loadEdition(pack: string) {
	const s = new MemoryStorage();
	await s.write('c/items_srd.csv', readPackFile(pack, 'items_srd.csv'));
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

			// A known KIND with a dead TARGET is the other half of the same failure: it parses, then
			// folds onto nothing. That check lives at derive (which owns the consumers), so run every
			// shipped item token through a real sheet and demand no `unknown target` — this is the gate
			// that catches the next authoring typo, whatever item it lands on.
			it('every authored token has a target the derive actually consumes', async () => {
				const g = await loadPacks(path);
				const c = newCharacter('probe', 'Probe', edition);
				c.play.effects = g
					.list('item')
					.filter((r) => (r.data.effects ?? []).length > 0)
					.map((r, i) => ({
						iid: `i${i}`,
						label: String(r.data.name_en),
						effects: r.data.effects ?? [],
						positive: true,
					}));
				const issues = deriveSheet(characterSchema.parse(c), g).deriveIssues;
				expect(issues.filter((i) => /unknown target/.test(i.detail ?? ''))).toEqual([]);
			});

			it("the Robe of the Archmagi's base AC is a GUARDED set, so armour still wins", async () => {
				const g = await loadPacks(path);
				const robe = g.list('item').find((r) => r.id === 'robe_of_the_archmagi')?.data.effects;
				const c = newCharacter('probe', 'Probe', edition);
				c.play.effects = [{ iid: 'r', label: 'Robe', effects: robe ?? [], positive: true }];
				const s = deriveSheet(characterSchema.parse(c), g);
				// unarmoured, DEX 10 (+0) on a fresh character: base AC 15 + DEX. Proves the guard AND
				// the `15+dex_mod` expression resolve — a set_override is not limited to a literal.
				expect(s.ac.value).toBe(15);
			});

			it('the second tranche folds: resistances, unqualified advantage, a floored Speed', async () => {
				const g = await loadEdition(path);
				const byId = (id: string) => g.list('item').find((r) => r.id === id)?.data.effects;
				// the type is NAMED, so it folds; 2014's Armor of Invulnerability says "nonmagical
				// damage", which is not a type the vocabulary can name — it stays a note (see PLAN).
				expect(byId('staff_of_fire')).toEqual(['damage_sensitivity:resist:fire']);
				expect(byId('cloak_of_arachnida')?.[0]).toBe('damage_sensitivity:resist:poison');
				expect(byId('robe_of_eyes')?.[0]).toBe('advantage:skill.perception');
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

describe('shipped charged items · the first consumers of the two-axis recharge (RECHARGE-3)', () => {
	// A charged item says its pool in its OWN effects cell — no `charges` column — so it inherits the
	// whole resource subsystem: pips, spend, the chip, and a rest that knows dawn is not a rest.
	const poolOf = async (dir: string, source: string, system: '5e' | '5.5e', id: string) => {
		const graph = await loadPacks(dir);
		const c = newCharacter('vex', 'Vex', system);
		c.build.inventory = [{ item: `item:${source}:${id}`, qty: 1, equipped: true, attuned: true }];
		const sheet = deriveSheet(characterSchema.parse(c), graph);
		return sheet.resources.find((r) => r.id === id);
	};

	it.each([
		['srd-2024', 'SRD 5.2.1', '5.5e'],
		['srd-2014', 'SRD 5.1', '5e'],
	] as const)(
		'%s: a Gem of Seeing carries 3 charges that come back 1d3 at dawn',
		async (d, s, y) => {
			expect(await poolOf(d, s, y, 'gem_of_seeing')).toMatchObject({
				max: 3,
				recharge: { trigger: 'dawn', amount: '1d3' },
			});
		},
	);

	it('an item that regains ALL of them says so as a bare trigger, not as an amount', async () => {
		expect(await poolOf('srd-2024', 'SRD 5.2.1', '5.5e', 'eyes_of_charming')).toMatchObject({
			max: 3,
			recharge: { trigger: 'dawn' },
		});
	});

	it("a pool only exists while the item is carried — it is the ITEM's pool, not the character's", async () => {
		const graph = await loadPacks('srd-2024');
		const bare = deriveSheet(characterSchema.parse(newCharacter('vex', 'Vex', '5.5e')), graph);
		expect(bare.resources.find((r) => r.id === 'gem_of_seeing')).toBeUndefined();
	});
});
