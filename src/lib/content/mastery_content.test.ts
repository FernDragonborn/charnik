/*
 * Weapon mastery, against the shipped packs (MASTERY-HALF).
 *
 * `mastery:<name>` has been on every 2024 weapon since the pack was written and was read by nothing.
 * This is the half that reads it: the ladder each class grants, and the rule that the property does
 * NOTHING until one of those picks unlocks that kind of weapon.
 *
 * The ladders are the SRD's own — the Weapon Mastery column of the Barbarian and Fighter Features
 * tables, and a flat two for the three classes whose feature names no table.
 */
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { masteryBudget } from '../build/derive';
import { newCharacter, characterSchema } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { attackMeta, attackNotes, attackPropertyRows, computeAttacks } from '../combat/attacks';
import { ITEM_TAG, parseItemTags, weaponCategoryOf } from './item-tags';

const S = 'SRD 5.2.1';
/** The plain weapon properties both editions define and a weapon's tags name. */
const PLAIN_PROPERTIES = [
	'ammunition',
	'finesse',
	'heavy',
	'light',
	'loading',
	'reach',
	'thrown',
	'two_handed',
	'versatile',
];
const entry = (classId: string, level: number) => [
	{ classId: `class:${S}:${classId}`, subclassId: null, level },
];

describe('weapon mastery · the ladder is shipped data', () => {
	it('each class unlocks what its own SRD table says, and 2014 has no such rule', async () => {
		const g2024 = await loadPacks('srd-2024');
		const at = (classId: string, level: number) =>
			masteryBudget(entry(classId, level), g2024, '5.5e');
		expect([at('barbarian', 1), at('barbarian', 4), at('barbarian', 10)]).toEqual([2, 3, 4]);
		expect([at('fighter', 1), at('fighter', 4), at('fighter', 10), at('fighter', 16)]).toEqual([
			3, 4, 5, 6,
		]);
		// the three whose feature names no table stay flat
		for (const classId of ['paladin', 'ranger', 'rogue'])
			expect([at(classId, 1), at(classId, 20)]).toEqual([2, 2]);
		expect(at('wizard', 20)).toBe(0);

		const g2014 = await loadPacks('srd-2014');
		expect(masteryBudget(entry('fighter', 20), g2014, '5e')).toBe(0);
	});

	it('every 2024 weapon carries a mastery property, and no 2014 weapon does', async () => {
		const withMastery = async (pack: string, system: '5e' | '5.5e') => {
			const graph = await loadPacks(pack);
			const weapons = graph
				.list('item', { system })
				.filter((r) => r.data.category === 'weapon' && !r.data.base_item_id);
			return weapons.filter((r) => parseItemTags(r.data.tags).get(ITEM_TAG.mastery)).length;
		};
		expect(await withMastery('srd-2024', '5.5e')).toBeGreaterThan(0);
		expect(await withMastery('srd-2014', '5e')).toBe(0);
	});
});

describe('weapon mastery · the attack row says it only when the character may use it', () => {
	it('a greataxe prints its mastery once the kind is drilled, and not before', async () => {
		const graph = await loadPacks('srd-2024');
		const character = characterSchema.parse(newCharacter('grog', 'Grog', '5.5e'));
		character.build.classes = [{ class: `class:${S}:barbarian`, level: 1 }];
		character.build.inventory = [
			{ item: `item:${S}:greataxe`, qty: 1, equipped: true, attuned: false },
		];

		const rowFor = () => {
			const sheet = deriveSheet(character, graph);
			return computeAttacks(character, sheet, graph).find((a) => a.id === 'greataxe');
		};
		const before = rowFor();
		expect(before, 'the greataxe is an attack row').toBeDefined();
		expect(before?.meta.mastery).toBeUndefined();

		// a weapon whose ONLY property is its mastery (mace, flail, morningstar) says nothing extra
		// rather than advertising a property the character cannot use
		expect(before?.meta.property).toBeDefined(); // the greataxe has `heavy`/`two_handed` besides

		character.build.masteries = ['greataxe'];
		// the shipped property, whatever the pack says it is — not a name from memory
		const greataxe = graph.get(`item:${S}:greataxe`);
		const shipped =
			greataxe?.type === 'item' ? parseItemTags(greataxe.data.tags).get(ITEM_TAG.mastery) : '';
		expect(rowFor()?.meta.mastery?.id).toBe(shipped);
	});

	it('a weapon whose only property IS the mastery advertises nothing until it is drilled', async () => {
		const graph = await loadPacks('srd-2024');
		const character = characterSchema.parse(newCharacter('grog', 'Grog', '5.5e'));
		character.build.classes = [{ class: `class:${S}:fighter`, level: 1 }];
		character.build.inventory = [
			{ item: `item:${S}:mace`, qty: 1, equipped: true, attuned: false },
		];
		const rowFor = () =>
			computeAttacks(character, deriveSheet(character, graph), graph).find((a) => a.id === 'mace');

		expect(rowFor()?.meta.property).toBeUndefined();
		expect(rowFor()?.meta.mastery).toBeUndefined();

		character.build.masteries = ['mace'];
		expect(rowFor()?.meta.mastery).toBeTruthy();
	});
});

/*
 * What a mastery property DOES is the pack's own text: SRD 5.2.1 ▸ Equipment ▸ Mastery Properties
 * defines eight, and every `mastery:<word>` a weapon carries must find its definition — a word with
 * no row is a player reading `vex` on their attack row with no way to learn what it means.
 */
describe('weapon mastery · every property a weapon names says what it does', () => {
	it('2024 ships the eight properties, and no weapon names a ninth', async () => {
		const graph = await loadPacks('srd-2024');
		// the type also holds the plain properties (Light, Finesse, …); a mastery is one a weapon's
		// `mastery:` tag names
		const rows = graph
			.list('weapon_property', { system: '5.5e' })
			.filter((r) => !PLAIN_PROPERTIES.includes(r.id));
		expect(rows.map((r) => r.id).sort()).toEqual([
			'cleave',
			'graze',
			'nick',
			'push',
			'sap',
			'slow',
			'topple',
			'vex',
		]);
		for (const row of rows) expect(row.data.text_en, row.id).toBeTruthy();

		const named = new Set(
			graph
				.list('item', { system: '5.5e' })
				.map((r) => parseItemTags(r.data.tags).get(ITEM_TAG.mastery))
				.filter((word): word is string => !!word),
		);
		expect([...named].sort()).toEqual(rows.map((r) => r.id).sort());
	});

	/*
	 * The plain properties, from each SRD's own Properties section (SRD 5.1 ▸ Equipment ▸ Weapon
	 * Properties, SRD 5.2.1 ▸ Equipment ▸ Properties). Range is defined there too and ships no row:
	 * no weapon carries it as a word — the numbers ride on `thrown` and `ammunition`.
	 */
	it.each([
		['srd-2014', '5e', [...PLAIN_PROPERTIES, 'special'].sort()],
		['srd-2024', '5.5e', PLAIN_PROPERTIES],
	] as const)(
		'%s: every property word a weapon carries is described, and nothing else is',
		async (pack, system, plain) => {
			const graph = await loadPacks(pack);
			const rows = graph.list('weapon_property', { system });
			const masteries = system === '5.5e' ? 8 : 0; // 2014 has no mastery rule
			expect(rows).toHaveLength(plain.length + masteries);
			expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([...plain]));
			for (const row of rows) expect(row.data.text_en, row.id).toBeTruthy();

			const kinds: string[] = [ITEM_TAG.simple, ITEM_TAG.martial, ITEM_TAG.melee, ITEM_TAG.ranged];
			// the mundane weapons: a magic one inherits these words from its base row
			const carried = new Set(
				graph
					.list('item', { system })
					.map((r) => parseItemTags(r.data.tags))
					.filter((tags) => weaponCategoryOf(tags) !== undefined)
					.flatMap((tags) => [...tags.keys()])
					.filter((word) => !kinds.includes(word) && word !== ITEM_TAG.mastery),
			);
			// `ammo` says WHICH ammunition a weapon fires — a pointer at an item, not a property
			carried.delete(ITEM_TAG.ammo);
			expect([...carried].sort()).toEqual([...plain]);
		},
	);

	it('a drilled weapon carries the property under its own name, with the row that explains it', async () => {
		const graph = await loadPacks('srd-2024');
		const character = characterSchema.parse(newCharacter('grog', 'Grog', '5.5e'));
		character.build.classes = [{ class: `class:${S}:barbarian`, level: 1 }];
		character.build.inventory = [
			{ item: `item:${S}:greataxe`, qty: 1, equipped: true, attuned: false },
		];
		character.build.masteries = ['greataxe'];
		const row = computeAttacks(character, deriveSheet(character, graph), graph).find(
			(a) => a.id === 'greataxe',
		);
		const rule = graph
			.list('weapon_property', { system: '5.5e' })
			.find((r) => r.id === row?.meta.mastery?.id);
		expect(rule).toBeDefined();
		expect(row?.meta.mastery).toMatchObject({ id: rule?.id, name: rule?.data.name_en, row: rule });
		// the row prints the property's NAME, not the tag's bare word
		expect(row && attackMeta(row)).toContain(String(rule?.data.name_en));
	});
});

/*
 * Two properties state a NUMBER about the attack, and SRD 5.2.1 gives each its formula: Graze deals
 * "damage … equal to the ability modifier you used to make the attack roll", Topple forces "a
 * Constitution saving throw (DC 8 plus the ability modifier used to make the attack roll and your
 * Proficiency Bonus)". The row prints the number, worked out for the weapon it is on.
 */
describe('weapon mastery · a property that states a number states it for this attack', () => {
	/** A level-1 fighter with STR 16 (+3) and DEX 12 (+1), wielding and drilled in one weapon. */
	const rowWith = async (mastery: string) => {
		const graph = await loadPacks('srd-2024');
		const weapon = graph
			.list('item', { system: '5.5e' })
			.find(
				(r) =>
					parseItemTags(r.data.tags).get(ITEM_TAG.mastery) === mastery &&
					parseItemTags(r.data.tags).has(ITEM_TAG.melee) &&
					!parseItemTags(r.data.tags).has(ITEM_TAG.finesse),
			);
		expect(weapon, `a melee weapon with ${mastery}`).toBeDefined();
		const c = newCharacter('grog', 'Grog', '5.5e');
		c.build.classes = [{ class: `class:${S}:fighter`, level: 1 }];
		c.build.abilities = { str: 16, dex: 12, con: 10, int: 10, wis: 10, cha: 10 };
		c.build.inventory = [
			{ item: weapon?.effectiveId ?? '', qty: 1, equipped: true, attuned: false },
		];
		c.build.masteries = [weapon?.id ?? ''];
		const character = characterSchema.parse(c);
		const row = computeAttacks(character, deriveSheet(character, graph), graph).find(
			(a) => a.id === weapon?.id,
		);
		expect(row, 'the weapon is an attack row').toBeDefined();
		return row;
	};

	it('Graze states the damage a miss still deals: the ability modifier of the attack', async () => {
		const row = await rowWith('graze');
		expect(row?.meta.mastery?.values).toEqual([{ id: 'miss_damage', amount: 3 }]);
		expect(row && attackMeta(row)).toMatch(/Graze Miss Damage 3$/);
	});

	it('Topple states the DC of the save it forces: 8 + that modifier + the proficiency bonus', async () => {
		const row = await rowWith('topple');
		expect(row?.meta.mastery?.values).toEqual([{ id: 'save_dc.con', amount: 13 }]);
	});

	it('a property with nothing to compute states no number', async () => {
		const row = await rowWith('cleave');
		expect(row?.meta.mastery?.values).toEqual([]);
		expect(row?.notes ?? []).toEqual([]);
	});
});

/*
 * The extra attack a weapon's property allows, per edition. SRD 5.1 ▸ Combat ▸ Two-Weapon Fighting:
 * "attack with a light melee weapon … use a bonus action to attack with a different light melee
 * weapon … You don't add your ability modifier to the damage of the bonus attack, unless that
 * modifier is negative." SRD 5.2.1 says the same of the Light property without the word melee, lets
 * Nick make it "part of the Attack action instead of as a Bonus Action", gives Cleave an attack of
 * its own with the same weapon, and has Two-Weapon Fighting put the modifier back.
 */
describe('weapon properties · the extra attack a weapon allows', () => {
	/** A fighter with STR 16 (+3) wielding the given weapons; `drilled` are the kinds mastered. */
	const rowsFor = async (
		pack: 'srd-2014' | 'srd-2024',
		weapons: [id: string, qty: number][],
		{ drilled = [] as string[], feats = [] as string[] } = {},
	) => {
		const [source, system] =
			pack === 'srd-2014' ? (['SRD 5.1', '5e'] as const) : ([S, '5.5e'] as const);
		const graph = await loadPacks(pack);
		const c = newCharacter('grog', 'Grog', system);
		c.build.classes = [{ class: `class:${source}:fighter`, level: 1 }];
		c.build.abilities = { str: 16, dex: 12, con: 10, int: 10, wis: 10, cha: 10 };
		c.build.inventory = weapons.map(([id, qty]) => ({
			item: `item:${source}:${id}`,
			qty,
			equipped: true,
			attuned: false,
		}));
		c.build.masteries = drilled;
		c.build.feats = feats.map((id) => `feat:${source}:${id}`);
		const character = characterSchema.parse(c);
		return computeAttacks(character, deriveSheet(character, graph), graph);
	};
	const extraOf = (rows: Awaited<ReturnType<typeof rowsFor>>, id: string) =>
		rows.find((a) => a.id === id)?.extras?.[0];

	it.each(['srd-2014', 'srd-2024'] as const)(
		'%s: one Light weapon allows nothing; a second one allows a Bonus Action attack without the modifier',
		async (pack) => {
			expect(extraOf(await rowsFor(pack, [['handaxe', 1]]), 'handaxe')).toBeUndefined();

			const rows = await rowsFor(pack, [
				['handaxe', 1],
				['club', 1],
			]);
			const handaxe = rows.find((a) => a.id === 'handaxe');
			expect(handaxe?.damageParts[0]?.mod).toBe(3);
			expect(extraOf(rows, 'handaxe')).toMatchObject({
				property: 'light',
				name: 'Light',
				cost: 'bonus',
				addsModifier: false,
			});
			expect(extraOf(rows, 'handaxe')?.damageParts[0]?.mod).toBe(0);
			// two of one kind are two weapons
			expect(extraOf(await rowsFor(pack, [['handaxe', 2]]), 'handaxe')).toBeDefined();
		},
	);

	it('2014 asks for two light MELEE weapons, so a hand crossbow is no partner', async () => {
		const rows = await rowsFor('srd-2014', [
			['handaxe', 1],
			['crossbow_hand', 1],
		]);
		expect(extraOf(rows, 'handaxe')).toBeUndefined();
		expect(extraOf(rows, 'crossbow_hand')).toBeUndefined();
	});

	it('2024: a drilled Nick makes the Light attack free, and names it', async () => {
		const weapons: [string, number][] = [
			['dagger', 1],
			['handaxe', 1],
		];
		expect(extraOf(await rowsFor('srd-2024', weapons), 'dagger')?.cost).toBe('bonus');
		const drilled = await rowsFor('srd-2024', weapons, { drilled: ['dagger'] });
		expect(extraOf(drilled, 'dagger')).toMatchObject({
			property: 'light',
			name: 'Nick',
			cost: 'free',
		});
		expect(extraOf(drilled, 'handaxe')?.cost).toBe('bonus'); // the handaxe is not the Nick weapon
	});

	it('2024: Cleave is an extra attack with the same weapon, once it is drilled', async () => {
		expect(extraOf(await rowsFor('srd-2024', [['greataxe', 1]]), 'greataxe')).toBeUndefined();
		const rows = await rowsFor('srd-2024', [['greataxe', 1]], { drilled: ['greataxe'] });
		expect(extraOf(rows, 'greataxe')).toMatchObject({ property: 'cleave', cost: 'free' });
		expect(extraOf(rows, 'greataxe')?.damageParts[0]?.mod).toBe(0);
	});

	it('2024: Two-Weapon Fighting puts the modifier back on the Light attack, and not on Cleave', async () => {
		const light = await rowsFor(
			'srd-2024',
			[
				['handaxe', 1],
				['club', 1],
			],
			{ feats: ['two_weapon_fighting'] },
		);
		expect(extraOf(light, 'handaxe')?.damageParts[0]?.mod).toBe(3);
		const cleave = await rowsFor('srd-2024', [['greataxe', 1]], {
			drilled: ['greataxe'],
			feats: ['two_weapon_fighting'],
		});
		expect(extraOf(cleave, 'greataxe')?.damageParts[0]?.mod).toBe(0);
	});
});

/*
 * Heavy, per edition. SRD 5.2.1: "You have Disadvantage on attack rolls with a Heavy weapon if it's
 * a Melee weapon and your Strength score isn't at least 13 or if it's a Ranged weapon and your
 * Dexterity score isn't at least 13." SRD 5.1: "Small creatures have disadvantage on attack rolls
 * with heavy weapons."
 */
describe('weapon properties · Heavy puts disadvantage on the attacks its rule names', () => {
	const modesOf = async (
		pack: 'srd-2014' | 'srd-2024',
		weapon: string,
		{ str = 10, dex = 10, species = '', autoCalc = true } = {},
	) => {
		const [source, system] =
			pack === 'srd-2014' ? (['SRD 5.1', '5e'] as const) : ([S, '5.5e'] as const);
		const graph = await loadPacks(pack);
		const c = newCharacter('grog', 'Grog', system);
		c.build.classes = [{ class: `class:${source}:fighter`, level: 1 }];
		c.build.abilities = { str, dex, con: 10, int: 10, wis: 10, cha: 10 };
		if (species) c.build.species = `species:${source}:${species}`;
		c.build.inventory = [
			{ item: `item:${source}:${weapon}`, qty: 1, equipped: true, attuned: false },
		];
		c.play.autoCalc = autoCalc;
		const character = characterSchema.parse(c);
		const row = computeAttacks(character, deriveSheet(character, graph), graph).find(
			(a) => a.id === weapon,
		);
		expect(row, `${weapon} is an attack row`).toBeDefined();
		return row?.rollModes ?? [];
	};
	const heavy = [{ mode: 'disadvantage', source: 'Heavy' }];

	it('2024: a melee one asks for Strength 13, a ranged one for Dexterity 13', async () => {
		expect(await modesOf('srd-2024', 'greataxe', { str: 12, dex: 18 })).toEqual(heavy);
		expect(await modesOf('srd-2024', 'greataxe', { str: 13, dex: 8 })).toEqual([]);
		expect(await modesOf('srd-2024', 'longbow', { str: 18, dex: 12 })).toEqual(heavy);
		expect(await modesOf('srd-2024', 'longbow', { str: 8, dex: 13 })).toEqual([]);
		// a weapon that is not Heavy is asked nothing
		expect(await modesOf('srd-2024', 'dagger', { str: 8, dex: 8 })).toEqual([]);
	});

	it('2014: a Small creature, whatever its Strength', async () => {
		expect(await modesOf('srd-2014', 'greataxe', { str: 18, species: 'halfling' })).toEqual(heavy);
		expect(await modesOf('srd-2014', 'greataxe', { str: 8, species: 'human' })).toEqual([]);
	});

	it('the row says it, and the effects switch turns it off with every other effect', async () => {
		const graph = await loadPacks('srd-2024');
		const c = newCharacter('grog', 'Grog', '5.5e');
		c.build.classes = [{ class: `class:${S}:fighter`, level: 1 }];
		c.build.abilities = { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		c.build.inventory = [{ item: `item:${S}:greataxe`, qty: 1, equipped: true, attuned: false }];
		const character = characterSchema.parse(c);
		const row = computeAttacks(character, deriveSheet(character, graph), graph)[0];
		expect(row && attackNotes(row)).toBe('Disadvantage (Heavy)');
		expect(await modesOf('srd-2024', 'greataxe', { str: 8, autoCalc: false })).toEqual([]);
	});
});

describe('weapon properties · an attack row can explain every property its weapon carries', () => {
	it('a dagger brings the rows of all three plain properties, and its mastery once drilled', async () => {
		const graph = await loadPacks('srd-2024');
		const rowsOf = (drilled: string[]) => {
			const c = newCharacter('grog', 'Grog', '5.5e');
			c.build.classes = [{ class: `class:${S}:fighter`, level: 1 }];
			c.build.inventory = [{ item: `item:${S}:dagger`, qty: 1, equipped: true, attuned: false }];
			c.build.masteries = drilled;
			const character = characterSchema.parse(c);
			const row = computeAttacks(character, deriveSheet(character, graph), graph)[0];
			return row ? attackPropertyRows(row).map((r) => r.id) : [];
		};
		expect(rowsOf([])).toEqual(['finesse', 'light', 'thrown']);
		expect(rowsOf(['dagger'])).toEqual(['finesse', 'light', 'thrown', 'nick']);
	});
});
