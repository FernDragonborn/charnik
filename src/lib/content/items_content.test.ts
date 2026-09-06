import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseToken, splitGuard } from '../effects/token-parser';
import { readPackFile, loadPacks } from '../../test-support/real-content';
import { newCharacter, characterSchema } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { computeAttacks, rollEffectsFor } from '../combat/helpers';

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

describe('shipped magic items · the third tranche (the +N families)', () => {
	/** One equipped/attuned item on an otherwise plain level-5 fighter (STR 16 → +3, PB +3). */
	const withItem = async (dir: string, source: string, system: '5e' | '5.5e', ids: string[]) => {
		const graph = await loadPacks(dir);
		const c = newCharacter('vax', 'Vax', system);
		c.build.classes = [{ class: `class:${source}:fighter`, level: 5 }];
		c.build.abilities = { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 };
		c.build.inventory = ids.map((id) => ({
			item: `item:${source}:${id}`,
			qty: 1,
			equipped: true,
			attuned: true,
		}));
		const parsed = characterSchema.parse(c);
		const sheet = deriveSheet(parsed, graph);
		return { sheet, attacks: computeAttacks(parsed, sheet, graph) };
	};

	it.each([
		['srd-2024', 'SRD 5.2.1', '5.5e'],
		['srd-2014', 'SRD 5.1', '5e'],
	] as const)(
		'%s: a +2 weapon adds 2 to ITS to-hit and damage, and to no other weapon',
		async (d, src, sys) => {
			const { attacks } = await withItem(d, src, sys, ['sun_blade', 'longsword']);
			const sun = attacks.find((a) => a.name === 'Sun Blade');
			const plain = attacks.find((a) => a.name === 'Longsword');
			// STR +3, PB +3 → a plain longsword is +6; the Sun Blade is +8 and its damage mod is 5, not 3
			expect([plain?.toHit, sun?.toHit]).toEqual([6, 8]);
			expect(sun?.damageParts[0]?.mod).toBe(5);
			expect(plain?.damageParts[0]?.mod).toBe(3);
		},
	);

	it('a Staff of Power pays out on every stat its text names, not only the weapon half', async () => {
		const bare = await withItem('srd-2024', 'SRD 5.2.1', '5.5e', []);
		const staff = await withItem('srd-2024', 'SRD 5.2.1', '5.5e', ['staff_of_power']);
		// "+2 bonus to Armor Class, saving throws, and spell attack rolls" — three targets, one row
		expect([bare.sheet.ac.value, staff.sheet.ac.value]).toEqual([10, 12]);
		// CON +1 and a fighter's CON save proficiency (+3) make 4; the staff makes it 6
		expect([bare.sheet.abilities.con.save.value, staff.sheet.abilities.con.save.value]).toEqual([
			4, 6,
		]);
	});

	it.each([
		['srd-2024', 'SRD 5.2.1', '5.5e' as const],
		['srd-2014', 'SRD 5.1', '5e' as const],
	])(
		'%s: the Belt of Dwarvenkind adds 2 Constitution, to a maximum of 20',
		async (dir, src, sys) => {
			const graph = await loadPacks(dir);
			const conWith = (score: number) => {
				const c = newCharacter('grog', 'Grog', sys);
				c.build.classes = [{ class: `class:${src}:fighter`, level: 1 }];
				c.build.abilities = { str: 10, dex: 10, con: score, int: 10, wis: 10, cha: 10 };
				c.build.inventory = [
					{ item: `item:${src}:belt_of_dwarvenkind`, qty: 1, equipped: true, attuned: true },
				];
				return deriveSheet(characterSchema.parse(c), graph).abilities.con.score.value;
			};
			// RAW is an add and THEN a ceiling — which is exactly what `cap` folding last buys
			expect([conWith(14), conWith(19), conWith(20)]).toEqual([16, 20, 20]);
		},
	);

	it.each([
		['srd-2024', 'SRD 5.2.1', '5.5e'],
		['srd-2014', 'SRD 5.1', '5e'],
	] as const)(
		'%s: Bracers of Archery make a longbow proficient and pay their +2 on it alone',
		async (d, src, sys) => {
			const graph = await loadPacks(d);
			const c = newCharacter('vex', 'Vex', sys);
			c.build.classes = [{ class: `class:${src}:wizard`, level: 5 }]; // no martial weapons
			c.build.abilities = { str: 10, dex: 16, con: 12, int: 16, wis: 10, cha: 10 };
			c.build.inventory = [
				{ item: `item:${src}:bracers_of_archery`, qty: 1, equipped: true, attuned: true },
				{ item: `item:${src}:longbow`, qty: 1, equipped: true, attuned: false },
				{ item: `item:${src}:dagger`, qty: 1, equipped: true, attuned: false },
			];
			const parsed = characterSchema.parse(c);
			const sheet = deriveSheet(parsed, graph);
			const attacks = computeAttacks(parsed, sheet, graph);
			// the grant is what makes a wizard proficient with a longbow at all: DEX +3 + PB +3
			expect(attacks.find((a) => a.name === 'Longbow')?.toHit).toBe(6);
			// and the +2 damage is SCOPED to those two weapons — it folds at the roll, so it is read
			// there rather than off the attack row, and the dagger must not pick it up
			const dmgOf = (name: string) => {
				const at = attacks.find((a) => a.name === name)!;
				return rollEffectsFor(sheet.facts, 'damage', new Set(at.scopes)).flat;
			};
			expect([dmgOf('Longbow'), dmgOf('Dagger')]).toEqual([2, 0]);
		},
	);

	it('every +N weapon in both packs carries BOTH halves of its bonus', async () => {
		for (const dir of ['srd-2024', 'srd-2014']) {
			const graph = await loadPacks(dir);
			for (const row of graph.list('item')) {
				const fx = row.data.effects ?? [];
				const attack = fx.find((t) => t.startsWith('flat_bonus:attack+'));
				if (!attack) continue;
				const n = attack.slice('flat_bonus:attack+'.length);
				expect(fx, `${dir}/${row.id}`).toContain(`flat_bonus:damage+${n}`);
			}
		}
	});
});

describe('shipped magic items · every one of them has its description', () => {
	// ITEM-TEXT-2014: the 2014 extractor dropped every paragraph containing an `<em>`, and in SRD 5.1
	// the description usually shares the paragraph with the italic type line — so 89 magic rows shipped
	// with an empty text and could never be tokenized. This is the guard that a converter re-run keeps
	// them: a count, not a sample, because the failure was silent and wholesale.
	it.each([
		['srd-2024', 'SRD 5.2.1'],
		['srd-2014', 'SRD 5.1'],
	])('%s: no magic item ships with an empty description', async (dir) => {
		const graph = await loadPacks(dir);
		const blank = graph
			.list('item')
			.filter((r) => r.data.rarity && !String(r.data.text_en ?? '').trim())
			.map((r) => r.id);
		expect(blank).toEqual([]);
	});

	it('a charged wand carries the pool its text states, and it comes back at dawn', async () => {
		const graph = await loadPacks('srd-2014');
		const c = newCharacter('vex', 'Vex', '5e');
		c.build.inventory = [
			{ item: 'item:SRD 5.1:wand_of_fireballs', qty: 1, equipped: true, attuned: true },
		];
		expect(
			deriveSheet(characterSchema.parse(c), graph).resources.find(
				(r) => r.id === 'wand_of_fireballs',
			),
		).toMatchObject({ max: 7, recharge: { trigger: 'dawn', amount: '1d6+1' } });
	});

	it('a pool with no recharge in its text is CONSUMABLE, never a silent dawn', async () => {
		const graph = await loadPacks('srd-2024');
		const row = graph.list('item').find((r) => r.id === 'ring_of_three_wishes');
		expect(row?.data.effects?.[0]).toBe('grant_resource:ring_of_three_wishes:3:consumable');
	});
});
