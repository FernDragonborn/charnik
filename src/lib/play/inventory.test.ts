/*
 * What play does to what is carried, as actions, with no view-model: the list changes the builder's
 * own helpers make, the attunement cap as a wall or a note, and a consumable used up.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character, classRow, inventoryRow } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { setAutoCalc } from './effects';
import {
	attune,
	changeQuantity,
	disownItem,
	dropItem,
	ownItem,
	reorderInventory,
	setCoin,
	setItemAnswers,
	toggleEquip,
	useItem,
} from './inventory';
import type { PlayContext } from './outcome';

const EDITIONS = {
	'5e': { pack: 'srd-2014', source: 'SRD 5.1' },
	'5.5e': { pack: 'srd-2024', source: 'SRD 5.2.1' },
} as const;
type System = keyof typeof EDITIONS;

const graphs = {} as Record<System, ContentGraph>;
beforeAll(async () => {
	graphs['5e'] = await loadPacks('srd-2014');
	graphs['5.5e'] = await loadPacks('srd-2024');
});

describe.each(['5e', '5.5e'] as const)('inventory actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const item = (id: string) => `item:${source}:${id}`;
	const derive = (character: Character) => deriveSheet(character, graphs[system]);
	const ctx: PlayContext = {
		derive,
		locale: 'en',
		// read when asked: the packs are loaded after this block is collected
		get graph() {
			return graphs[system];
		},
	};
	const carrying = (...ids: string[]) => {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [classRow({ class: `class:${source}:fighter`, level: 3 })];
		c.play.hp.current = 10;
		c.build.inventory = ids.map((id) =>
			inventoryRow({
				item: item(id),
				qty: 1,
				equipped: false,
				attuned: false,
			}),
		);
		return c;
	};
	const entryOf = (c: Character, id: string) => c.build.inventory.find((e) => e.item === item(id));
	/** The row a character carries that item on, by the row's own id — what an action is told. */
	const rowOf = (c: Character, id: string) => entryOf(c, id)?.iid ?? '';

	it('a shield in hand is counted by the Armor Class, and taken off it is not', () => {
		const c = carrying('shield');
		const bare = derive(c).ac.value;
		const armed = toggleEquip(c, { row: rowOf(c, 'shield') }, ctx).character;
		expect(derive(armed).ac.value).toBe(bare + 2);
		expect(derive(toggleEquip(armed, { row: rowOf(c, 'shield') }, ctx).character).ac.value).toBe(
			bare,
		);
		expect(entryOf(c, 'shield')?.equipped).toBe(false);
	});

	it('one shield and one suit of armour at a time: putting on another takes the first off', () => {
		const leather = system === '5e' ? 'leather' : 'leather_armor'; // the two SRDs' ids for it
		const c = carrying('shield', 'shield_1_2_or_3', leather, 'chain_mail', 'dagger');
		c.build.inventory = c.build.inventory.map((e) =>
			e.item === item('shield_1_2_or_3') ? { ...e, bonus: 2 } : e,
		);
		const wear = (from: Character, id: string) =>
			toggleEquip(from, { row: rowOf(from, id) }, ctx).character;
		const worn = ['shield', leather, 'dagger', 'shield_1_2_or_3', 'chain_mail'].reduce(wear, c);
		const on = (id: string) => entryOf(worn, id)?.equipped;
		expect([on('shield'), on('shield_1_2_or_3')]).toEqual([false, true]);
		expect([on(leather), on('chain_mail')]).toEqual([false, true]);
		expect(on('dagger')).toBe(true); // a weapon is not worn in either slot
		// and the Armor Class counts the one shield it now holds: its base 2 and its +2, once
		const bare = derive(wear(worn, 'shield_1_2_or_3')).ac.value;
		expect(derive(worn).ac.value).toBe(bare + 4);
	});

	it('owning, counting, using up and putting back', () => {
		const c = carrying('dagger');
		const owned = ownItem(c, { item: item('torch') }, ctx).character;
		const torch = rowOf(owned, 'torch');
		const more = changeQuantity(owned, { row: torch, by: 2 }, ctx).character;
		expect(entryOf(more, 'torch')?.qty).toBe(3);
		const used = useItem(more, { row: torch, count: 2 }, ctx);
		expect(entryOf(used.character, 'torch')?.qty).toBe(1);
		expect(used.notices[0]).toMatchObject({
			description: { values: { count: 1 } },
			rows: { name: item('torch') },
		});
		// the last one leaves the list, and a count past the stack spends only what is there
		expect(
			entryOf(useItem(used.character, { row: torch, count: 9 }, ctx).character, 'torch'),
		).toBeUndefined();
		expect(
			dropItem(more, { row: rowOf(more, 'dagger') }, ctx).character.build.inventory.map(
				(e) => e.item,
			),
		).toEqual([item('torch')]);
	});

	it('a fourth attunement is a wall in Strict and a note in Free; stopping is always allowed', () => {
		const c = carrying('dagger', 'shield', 'torch', 'rope');
		c.build.inventory = c.build.inventory.map((e, i) => ({ ...e, attuned: i < 3 }));
		c.ui.strict = true;
		const wall = attune(c, { row: rowOf(c, 'rope') }, ctx);
		expect(wall.refused).toBe(true);
		expect(wall.character).toBe(c);
		const free = attune({ ...c, ui: { ...c.ui, strict: false } }, { row: rowOf(c, 'rope') }, ctx);
		expect(entryOf(free.character, 'rope')?.attuned).toBe(true);
		expect(free.notices[0]?.text).toMatchObject({ key: 'combat.notice.overAttunement' });
		expect(entryOf(attune(c, { row: rowOf(c, 'dagger') }, ctx).character, 'dagger')?.attuned).toBe(
			false,
		);
	});

	it('an answer a row asks for is kept on the entry, and taking it back removes it', () => {
		const c = carrying('dagger');
		const row = rowOf(c, 'dagger');
		const answers = { base: item('shield'), bonus: 2, choice: 'fire' };
		const answered = setItemAnswers(c, { row, answers }, ctx).character;
		expect(entryOf(answered, 'dagger')).toMatchObject({
			base: item('shield'),
			bonus: 2,
			choice: 'fire',
		});
		// answered again with only the bonus: the base and the kind are taken back
		const rebonused = setItemAnswers(answered, { row, answers: { bonus: 3 } }, ctx).character;
		expect(entryOf(rebonused, 'dagger')).toMatchObject({ bonus: 3 });
		expect(entryOf(rebonused, 'dagger')?.base).toBeUndefined();
		const cleared = setItemAnswers(answered, { row, answers: {} }, ctx).character;
		// the row it was before it was asked anything — the same row, by its own id
		expect(entryOf(cleared, 'dagger')).toEqual(entryOf(c, 'dagger'));
	});

	it('the same item on two rows is two rows: a change to one leaves the other alone', () => {
		const c = carrying('dagger');
		const first = c.build.inventory[0];
		if (!first) throw new Error('carrying a dagger');
		const twice = {
			...c,
			build: { ...c.build, inventory: [first, inventoryRow({ item: first.item })] },
		};
		const [one, other] = twice.build.inventory.map((e) => e.iid);
		const armed = toggleEquip(twice, { row: other ?? '' }, ctx).character.build.inventory;
		expect(armed.map((e) => e.equipped)).toEqual([first.equipped, !first.equipped]);
		const more = changeQuantity(twice, { row: one ?? '', by: 4 }, ctx).character.build.inventory;
		expect(more.map((e) => e.qty)).toEqual([5, 1]);
		expect(
			dropItem(twice, { row: one ?? '' }, ctx).character.build.inventory.map((e) => e.iid),
		).toEqual([other]);
		// the picker's "put it back" is about the ITEM, and takes both
		expect(disownItem(twice, { item: first.item }, ctx).character.build.inventory).toEqual([]);
	});

	it('a reorder keeps what it was not told about, at the end', () => {
		const c = carrying('dagger', 'shield', 'torch');
		const order = reorderInventory(
			c,
			{ rows: [rowOf(c, 'torch'), rowOf(c, 'dagger')] },
			ctx,
		).character;
		expect(order.build.inventory.map((e) => e.item)).toEqual([
			item('torch'),
			item('dagger'),
			item('shield'),
		]);
	});

	it('the purse holds whole, non-negative coins', () => {
		const c = carrying();
		expect(setCoin(c, { coin: 'gp', count: 12.9 }).character.play.currency).toEqual({ gp: 12 });
		expect(setCoin(c, { coin: 'gp', count: -3 }).character.play.currency).toEqual({ gp: 0 });
	});

	it('switching effects-auto off pulls hit points down to the maximum the effects were raising', () => {
		const c = carrying();
		const max = derive(c).maxHp.value;
		c.play.effects = [{ iid: 'a', label: 'Aid', effects: ['flat_bonus:hp_max+5'], positive: true }];
		c.play.hp.current = max + 5;
		expect(setAutoCalc(c, { on: false }, ctx).character.play.hp.current).toBe(max);
	});
});
