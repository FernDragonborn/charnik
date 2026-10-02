/*
 * Wild Shape at the table, over both editions' shipped content: the use is spent when a form is
 * TAKEN and not when the question is asked, the turn pays what each edition says, and the hit
 * points are whose the edition says they are.
 *
 * SRD 5.1 — "you can use your action to magically assume the shape of a beast"; "you assume the
 * beast's hit points"; "if you revert as a result of dropping to 0 hit points, any excess damage
 * carries over to your normal form. For example, if you take 10 damage in animal form and have only
 * 1 hit point left, you revert and take 9 damage."
 * SRD 5.2.1 — "As a Bonus Action, you shape-shift"; "you gain a number of Temporary Hit Points equal
 * to your Druid level"; "you retain your … Hit Points".
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(() => {}, { custom: () => {} }),
}));

import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character } from '$lib/character/schema';
import { combat } from './combat-view-model.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';

const EDITIONS = {
	'5e': { pack: 'srd-2014', source: 'SRD 5.1' },
	'5.5e': { pack: 'srd-2024', source: 'SRD 5.2.1' },
} as const;
type System = keyof typeof EDITIONS;

beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

/** A level-4 druid of this edition at full hit points, in combat, with the wolf known. */
async function druid(system: System): Promise<Character> {
	const { pack, source } = EDITIONS[system];
	combat.graph = await loadPacks(pack);
	const c = newCharacter('fern', 'Fern', system);
	c.build.classes = [{ class: `class:${source}:druid`, level: 4 }];
	c.build.abilities = { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10 };
	c.build.forms = { wild_shape: [`monster:${source}:wolf`] };
	combat.character = c;
	const live = combat.character;
	live.play.hp.current = combat.hpMax;
	combat.forms.asking = null;
	combat.toggleCombat();
	return live;
}

const wolfOf = (system: System) => `monster:${EDITIONS[system].source}:wolf`;
const spent = (c: Character) => c.play.resourcesSpent.wild_shape ?? 0;

describe.each(['5e', '5.5e'] as const)('Wild Shape at the table · %s', (system) => {
	it('asks which form first, and spends the use and the turn only when one is taken', async () => {
		const c = await druid(system);
		combat.useResourceOrEnter('wild_shape', 2);
		expect(combat.forms.asking?.options.map((row) => row.id)).toContain('wolf');
		expect(spent(c)).toBe(0);
		expect(c.play.turn).toMatchObject({ action: 0, bonus: 0 });

		combat.forms.asking?.answer(wolfOf(system));
		expect(combat.forms.asking).toBeNull();
		expect(spent(c)).toBe(1);
		// an Action in 2014, a Bonus Action in 2024
		expect(c.play.turn).toMatchObject(
			system === '5e' ? { action: 1, bonus: 0 } : { action: 0, bonus: 1 },
		);
		expect(c.play.form?.monster).toBe(wolfOf(system));
		expect(combat.forms.current?.name).toBe('Wolf');
		// two hours at druid 4, on the carrier that names the stat block
		expect(c.play.effects).toMatchObject([{ source: wolfOf(system), durationRounds: 1200 }]);
		expect(combat.sheet?.ac.value).toBe(combat.forms.current?.row.data.ac);
	});

	it('the attacks are the stat block’s, and come back as the druid’s own', async () => {
		const c = await druid(system);
		expect(combat.attacks.map((a) => a.id)).toContain('unarmed_strike');
		combat.forms.assume('wild_shape', wolfOf(system));
		expect(combat.attacks.map((a) => a.name)).toEqual(['Bite']);
		combat.forms.leave();
		expect(c.play.form).toBeNull();
		expect(combat.attacks.map((a) => a.id)).toContain('unarmed_strike');
	});

	it('leaving by choice is a Bonus Action, and the form goes with the effect that carries it', async () => {
		const c = await druid(system);
		combat.forms.assume('wild_shape', wolfOf(system));
		c.play.turn.bonus = 1; // already spent this turn
		combat.forms.revert();
		expect(c.play.form).not.toBeNull();
		c.play.turn.bonus = 0;
		combat.forms.revert();
		expect(c.play.form).toBeNull();
		expect(c.play.effects).toEqual([]);

		// the Effects panel's ✕ knows nothing of forms; the sync is what finishes the leaving
		combat.forms.assume('wild_shape', wolfOf(system));
		combat.effects.removeEffect(c.play.effects[0]?.iid ?? '');
		combat.forms.sync();
		expect(c.play.form).toBeNull();
	});

	it('a new shape replaces the one worn', async () => {
		const c = await druid(system);
		const own = c.play.hp.current;
		combat.forms.assume('wild_shape', wolfOf(system));
		combat.forms.assume('wild_shape', wolfOf(system));
		expect(c.play.effects).toHaveLength(1);
		combat.forms.leave();
		expect(c.play.hp.current).toBe(own);
	});
});

describe('Wild Shape at the table · whose hit points', () => {
	it('2014: the beast’s take the hit, and what they cannot hold carries over', async () => {
		const c = await druid('5e');
		const own = c.play.hp.current;
		combat.forms.assume('wild_shape', wolfOf('5e'));
		const wolfHp = combat.forms.current?.row.data.hp ?? 0;
		expect(c.play.form?.hpBefore).toBe(own);
		expect(c.play.hp.current).toBe(wolfHp);
		expect(combat.hpMax).toBe(wolfHp);

		combat.hpAmount = wolfHp - 1;
		combat.damage();
		expect(c.play.hp.current).toBe(1);
		expect(c.play.form).not.toBeNull();

		// the SRD's own example: 10 damage at 1 hit point left → revert and take 9
		combat.hpAmount = 10;
		combat.damage();
		expect(c.play.form).toBeNull();
		expect(c.play.hp.current).toBe(own - 9);
		expect(c.play.death).toBeNull();
		expect(combat.hpMax).toBeGreaterThanOrEqual(own);
	});

	it('2014: a maximum set by hand does not become the beast’s', async () => {
		const c = await druid('5e');
		c.play.hp.max = 99;
		combat.forms.assume('wild_shape', wolfOf('5e'));
		expect(combat.hpMax).toBe(combat.forms.current?.row.data.hp);
		combat.forms.leave();
		expect(combat.hpMax).toBe(99);
	});

	it('2024: the druid’s own hit points stay, with Temporary Hit Points equal to their level', async () => {
		const c = await druid('5.5e');
		const own = c.play.hp.current;
		const max = combat.hpMax;
		combat.forms.assume('wild_shape', wolfOf('5.5e'));
		expect(c.play.form?.hpBefore).toBeUndefined();
		expect(c.play.hp).toMatchObject({ current: own, temp: 4 });
		expect(combat.hpMax).toBe(max);
		// never stacked: a larger pool already held stands
		c.play.hp.temp = 9;
		combat.forms.assume('wild_shape', wolfOf('5.5e'));
		expect(c.play.hp.temp).toBe(9);
	});

	it('2024 offers the forms the druid KNOWS; 2014 offers every beast the level allows', async () => {
		await druid('5.5e');
		combat.useResourceOrEnter('wild_shape', 2);
		expect(combat.forms.asking?.options.map((row) => row.id)).toEqual(['wolf']);

		await druid('5e');
		combat.useResourceOrEnter('wild_shape', 2);
		const offered = combat.forms.asking?.options.map((row) => row.id) ?? [];
		expect(offered).toContain('crocodile'); // CR 1/2, swims — allowed from level 4
		expect(offered).not.toContain('giant_eagle'); // CR 1, flies
		expect(offered.length).toBeGreaterThan(20);
	});
});
