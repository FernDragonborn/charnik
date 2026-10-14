/*
 * What a 2024 druid spends a use of Wild Shape on besides a form, over the shipped pack.
 *
 * SRD 5.2.1 — Wild Resurgence: "you can expend one use of Wild Shape (no action required) to give
 * yourself a level 1 spell slot, but you can't do so again until you finish a Long Rest." Wild
 * Companion, Land's Aid and Nature's Sanctuary each "expend a use of Wild Shape" as a Magic action,
 * and the last two belong to the Circle of the Land.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('$lib/toast/toast', () => ({
	toast: Object.assign(() => {}, { success: () => {}, warning: () => {}, error: () => {} }),
	toastRollCard: () => {},
}));

import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character, classRow } from '$lib/character/schema';
import { combat } from './combat-view-model.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';

const S = 'SRD 5.2.1';

beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

/** A 2024 druid of that level, in combat, with or without the Circle of the Land. */
async function druid(level: number, circle = false): Promise<Character> {
	combat.graph = await loadPacks('srd-2024');
	const c = newCharacter('fern', 'Fern', '5.5e');
	c.build.classes = [
		classRow({
			class: `class:${S}:druid`,
			level,
			...(circle ? { subclass: `subclass:${S}:circle_of_the_land` } : {}),
		}),
	];
	c.build.abilities = { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10 };
	c.build.forms = { wild_shape: [`monster:${S}:wolf`] };
	combat.character = c;
	combat.forms.asking = null;
	combat.toggleCombat();
	return combat.character;
}

const option = (id: string) => combat.resourceOptions.find((o) => o.id === id);
/** The question an option is waiting on — read through a call, since a test also clears it. */
const question = () => combat.executor.asking;
const levelOneSlots = () =>
	combat.sheet?.spellcasting.pools.find((pool) => pool.spellLevel === 1)?.max ?? 0;

describe('Wild Resurgence · a use of Wild Shape becomes a level 1 spell slot', () => {
	it('spends the use and the once-a-rest gate, and the slot is one more than the table gives', async () => {
		const c = await druid(5);
		const before = levelOneSlots();
		const resurgence = option('druid_wild_resurgence_slot');
		expect(resurgence).toBeDefined();
		if (!resurgence) return;

		combat.activateResourceOption(resurgence);
		expect(c.play.resourcesSpent).toMatchObject({ wild_shape: 1, wild_resurgence: 1 });
		expect(c.play.spellSlotsGained).toEqual({ '1': 1 });
		expect(levelOneSlots()).toBe(before + 1);
		// no action required
		expect(c.play.turn).toMatchObject({ action: 0, bonus: 0 });

		// "you can't do so again until you finish a Long Rest"
		combat.activateResourceOption(resurgence);
		expect(c.play.resourcesSpent.wild_shape).toBe(1);
		expect(c.play.spellSlotsGained).toEqual({ '1': 1 });
	});

	it('is refused whole when no use of Wild Shape is left: the gate is not spent for nothing', async () => {
		const c = await druid(5);
		const max = combat.sheet?.resources.find((r) => r.id === 'wild_shape')?.max ?? 0;
		c.play.resourcesSpent = { wild_shape: max };
		const resurgence = option('druid_wild_resurgence_slot');
		if (resurgence) combat.activateResourceOption(resurgence);
		expect(c.play.resourcesSpent.wild_resurgence ?? 0).toBe(0);
		expect(c.play.spellSlotsGained).toEqual({});
	});

	it('the gained slot goes with the Long Rest that refills the rest', async () => {
		const c = await druid(5);
		const before = levelOneSlots();
		const resurgence = option('druid_wild_resurgence_slot');
		if (resurgence) combat.activateResourceOption(resurgence);
		combat.resources.rest('long');
		expect(c.play.spellSlotsGained).toEqual({});
		expect(levelOneSlots()).toBe(before);
	});

	it('is not offered below druid 5', async () => {
		await druid(4);
		expect(option('druid_wild_resurgence_slot')).toBeUndefined();
	});
});

describe('Wild Resurgence · a spell slot becomes a use of Wild Shape', () => {
	// "if you have no uses of Wild Shape left, you can give yourself one use by expending a spell
	// slot (no action required)"
	const USE = 'druid_wild_resurgence_use';
	const usesLeft = () => {
		const pool = combat.sheet?.resources.find((r) => r.id === 'wild_shape');
		return (pool?.max ?? 0) - (combat.character?.play.resourcesSpent.wild_shape ?? 0);
	};
	async function spentDruid(level = 5): Promise<Character> {
		const c = await druid(level);
		combat.executor.asking = null;
		c.play.resourcesSpent = { wild_shape: usesLeft() };
		return c;
	}

	it('is offered only once the uses are gone', async () => {
		const c = await druid(5);
		expect(option(USE)?.available).toBe(false);
		const use = option(USE);
		if (use) combat.activateResourceOption(use);
		expect(c.play.spellSlotsSpent).toEqual({});
		await spentDruid();
		expect(option(USE)?.available).toBe(true);
	});

	it('asks which slot when several levels have one, and spends nothing until it is told', async () => {
		const c = await spentDruid();
		const use = option(USE);
		if (!use) throw new Error('no option');
		combat.activateResourceOption(use);
		expect(question()?.values).toEqual([1, 2, 3]);
		expect(c.play.spellSlotsSpent).toEqual({});
		expect(usesLeft()).toBe(0);

		question()?.answer(2);
		expect(question()).toBeNull();
		expect(c.play.spellSlotsSpent).toEqual({ '2': 1 });
		expect(usesLeft()).toBe(1);
		// no action required, and the once-a-rest half of the feature is untouched
		expect(c.play.turn).toMatchObject({ action: 0, bonus: 0 });
		expect(c.play.resourcesSpent.wild_resurgence ?? 0).toBe(0);
		// one use back is the window closed again
		expect(option(USE)?.available).toBe(false);
	});

	it('takes the only slot there is without asking, and is refused when none is left', async () => {
		const c = await spentDruid();
		const slots = Object.fromEntries(
			(combat.sheet?.spellcasting.pools ?? []).map((pool) => [String(pool.spellLevel), pool.max]),
		);
		c.play.spellSlotsSpent = { ...slots, '3': (slots['3'] ?? 1) - 1 };
		const use = option(USE);
		if (!use) throw new Error('no option');
		combat.activateResourceOption(use);
		expect(question()).toBeNull();
		expect(c.play.spellSlotsSpent['3']).toBe(slots['3']);
		expect(usesLeft()).toBe(1);

		c.play.resourcesSpent = { wild_shape: usesLeft() + (c.play.resourcesSpent.wild_shape ?? 0) };
		combat.activateResourceOption(use);
		expect(usesLeft()).toBe(0);
	});

	it('is not offered below druid 5, and the chip still assumes a form', async () => {
		await druid(4);
		expect(option(USE)).toBeUndefined();
		await druid(5);
		combat.useResourceOrEnter('wild_shape', 2);
		expect(combat.forms.asking?.options.map((row) => row.id)).toEqual(['wolf']);
	});
});

describe('Nature Magician · several uses of Wild Shape become one spell slot', () => {
	// SRD 5.2.1 ▸ Archdruid: "Choose a number of your unexpended uses of Wild Shape and convert them
	// into a single spell slot, with each use contributing 2 spell levels … Once you use this
	// benefit, you can't do so again until you finish a Long Rest."
	const MAGICIAN = 'druid_nature_magician';

	it('asks how many of the uses left, and two of them are a level 4 slot', async () => {
		const c = await druid(20);
		combat.executor.asking = null;
		expect(combat.sheet?.deriveIssues).toEqual([]);
		c.play.resourcesSpent = { wild_shape: 1 };
		const magician = option(MAGICIAN);
		if (!magician) throw new Error('no option');
		combat.activateResourceOption(magician);
		expect(question()).toMatchObject({ kind: 'amount', values: [1, 2, 3] });
		expect(c.play.spellSlotsGained).toEqual({});

		question()?.answer(2);
		expect(c.play.resourcesSpent).toMatchObject({ wild_shape: 3, nature_magician: 1 });
		expect(c.play.spellSlotsGained).toEqual({ '4': 1 });
		expect(c.play.turn).toMatchObject({ action: 0, bonus: 0 });

		// once until a Long Rest: asked again, answered, and refused whole
		combat.activateResourceOption(magician);
		question()?.answer(1);
		expect(c.play.resourcesSpent.wild_shape).toBe(3);
		expect(c.play.spellSlotsGained).toEqual({ '4': 1 });
	});

	it('is an Archdruid’s: not offered at druid 19', async () => {
		await druid(19);
		expect(option(MAGICIAN)).toBeUndefined();
	});
});

describe('a use of Wild Shape spent on something that is not a form', () => {
	it('Wild Companion is every druid’s; the Circle of the Land’s two are that circle’s alone', async () => {
		await druid(14);
		expect(option('druid_wild_companion')).toBeDefined();
		expect(option('circle_of_the_land_lands_aid')).toBeUndefined();
		expect(option('circle_of_the_land_natures_sanctuary')).toBeUndefined();

		await druid(14, true);
		expect(option('circle_of_the_land_lands_aid')).toBeDefined();
		expect(option('circle_of_the_land_natures_sanctuary')).toBeDefined();
	});

	it('Land’s Aid rolls the dice its level states: 2d6, 3d6 from druid 10, 4d6 from 14', async () => {
		await druid(3, true);
		expect(option('circle_of_the_land_lands_aid')?.action).toBe('roll:2d6');
		await druid(10, true);
		expect(option('circle_of_the_land_lands_aid')?.action).toBe('roll:3d6');
		await druid(14, true);
		expect(option('circle_of_the_land_lands_aid')?.action).toBe('roll:4d6');
	});

	it('spends the use and the Magic action', async () => {
		const c = await druid(3, true);
		const aid = option('circle_of_the_land_lands_aid');
		if (aid) combat.activateResourceOption(aid);
		expect(c.play.resourcesSpent.wild_shape).toBe(1);
		expect(c.play.turn.action).toBe(1);
	});

	it('the chip still assumes a form: what other features spend the pool on is not its own option', async () => {
		await druid(14, true);
		combat.useResourceOrEnter('wild_shape', 4);
		expect(combat.forms.asking?.options.map((row) => row.id)).toEqual(['wolf']);
	});
});
