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
	dropItem,
	ownItem,
	reorderInventory,
	setCoin,
	setItemBase,
	setItemBonus,
	setItemChoice,
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

	it('a shield in hand is counted by the Armor Class, and taken off it is not', () => {
		const c = carrying('shield');
		const bare = derive(c).ac.value;
		const armed = toggleEquip(c, { item: item('shield') }, ctx).character;
		expect(derive(armed).ac.value).toBe(bare + 2);
		expect(derive(toggleEquip(armed, { item: item('shield') }, ctx).character).ac.value).toBe(bare);
		expect(entryOf(c, 'shield')?.equipped).toBe(false);
	});

	it('owning, counting, using up and putting back', () => {
		const c = carrying('dagger');
		const more = changeQuantity(
			ownItem(c, { item: item('torch') }, ctx).character,
			{ item: item('torch'), by: 2 },
			ctx,
		).character;
		expect(entryOf(more, 'torch')?.qty).toBe(3);
		const used = useItem(more, { item: item('torch'), count: 2 }, ctx);
		expect(entryOf(used.character, 'torch')?.qty).toBe(1);
		expect(used.notices[0]).toMatchObject({
			description: { values: { count: 1 } },
			rows: { name: item('torch') },
		});
		// the last one leaves the list, and a count past the stack spends only what is there
		expect(
			entryOf(useItem(used.character, { item: item('torch'), count: 9 }, ctx).character, 'torch'),
		).toBeUndefined();
		expect(
			dropItem(more, { item: item('dagger') }, ctx).character.build.inventory.map((e) => e.item),
		).toEqual([item('torch')]);
	});

	it('a fourth attunement is a wall in Strict and a note in Free; stopping is always allowed', () => {
		const c = carrying('dagger', 'shield', 'torch', 'rope');
		c.build.inventory = c.build.inventory.map((e, i) => ({ ...e, attuned: i < 3 }));
		c.ui.strict = true;
		const wall = attune(c, { item: item('rope') }, ctx);
		expect(wall.refused).toBe(true);
		expect(wall.character).toBe(c);
		const free = attune({ ...c, ui: { ...c.ui, strict: false } }, { item: item('rope') }, ctx);
		expect(entryOf(free.character, 'rope')?.attuned).toBe(true);
		expect(free.notices[0]?.text).toMatchObject({ key: 'combat.notice.overAttunement' });
		expect(entryOf(attune(c, { item: item('dagger') }, ctx).character, 'dagger')?.attuned).toBe(
			false,
		);
	});

	it('an answer a row asks for is kept on the entry, and taking it back removes it', () => {
		const c = carrying('dagger');
		const ref = item('dagger');
		const answered = setItemChoice(
			setItemBonus(
				setItemBase(c, { item: ref, base: item('shield') }, ctx).character,
				{ item: ref, bonus: 2 },
				ctx,
			).character,
			{ item: ref, choice: 'fire' },
			ctx,
		).character;
		expect(entryOf(answered, 'dagger')).toMatchObject({
			base: item('shield'),
			bonus: 2,
			choice: 'fire',
		});
		const cleared = setItemChoice(
			setItemBonus(setItemBase(answered, { item: ref }, ctx).character, { item: ref }, ctx)
				.character,
			{ item: ref },
			ctx,
		).character;
		// the row it was before it was asked anything — the same row, by its own id
		expect(entryOf(cleared, 'dagger')).toEqual(entryOf(c, 'dagger'));
	});

	it('a reorder keeps what it was not told about, at the end', () => {
		const c = carrying('dagger', 'shield', 'torch');
		const order = reorderInventory(c, { items: [item('torch'), item('dagger')] }, ctx).character;
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
