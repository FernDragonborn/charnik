/*
 * The PLAY loop, over both editions' real shipped content (AUDIT-COVERAGE).
 *
 * The both-editions sweep that preceded this covered the BUILD path — every class's sheet, every
 * derive — and not a single thing a player does at the table. So this drives the VM the way the
 * sheet does: take damage, rest, cast, spend a resource, and read what came back. Both editions run
 * the SAME script, because a divergence that matters should be asserted by name (it is, below),
 * and anything else that differs is a bug rather than a fact about the rules.
 *
 * Against REAL packs on purpose: a stub can be written to agree with the code, and what this is
 * checking is that the shipped rows still mean what the engine thinks they mean.
 */
import 'fake-indexeddb/auto'; // the VM saves on a rest
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(() => {}, { custom: () => {} }),
}));

import { loadPacks } from '../../test-support/real-content';
import type { ContentGraph } from '$lib/content/loader';
import { newCharacter, type Character } from '$lib/character/schema';
import { combat } from './combat-view-model.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import { spellRow } from '$lib/combat/helpers';

const EDITIONS = [
	{ system: '5.5e', pack: 'srd-2024', source: 'SRD 5.2.1' },
	{ system: '5e', pack: 'srd-2014', source: 'SRD 5.1' },
] as const;

const noModifiers = { shiftKey: false } as unknown as Event;

beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

for (const { system, pack, source } of EDITIONS) {
	describe(`play loop · ${system}`, () => {
		/** The pack under the character `play()` last made — held so a test can read rows off it
		 *  without re-asserting that the VM's nullable graph is there. */
		let graph: ContentGraph;

		/** A single-class character of this edition, at a level where the class has things to spend. */
		async function play(classId: string, level: number): Promise<Character> {
			graph = await loadPacks(pack);
			combat.graph = graph;
			const c = newCharacter('probe', 'Probe', system);
			c.build.classes = [{ class: `class:${source}:${classId}`, level }];
			c.build.abilities = { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 };
			combat.character = c;
			return c;
		}

		/** The first leveled spell of this edition's cleric list that `pick` accepts. */
		function clericSpell(pick: (d: Record<string, unknown>) => boolean) {
			return graph
				.list('spell', { system })
				.find(
					(r) =>
						Number(r.data.level) === 1 &&
						String(r.data.classes ?? '').includes('cleric') &&
						pick(r.data),
				);
		}

		it('damage comes off hit points, and healing puts it back', async () => {
			const character = await play('fighter', 5);
			const max = combat.sheet?.maxHp.value ?? 0;
			expect(max).toBeGreaterThan(0);
			character.play.hp = { current: max, max, temp: 0 };
			combat.hpAmount = 7;
			combat.damage();
			expect(character.play.hp.current).toBe(max - 7);
			combat.hpAmount = 3;
			combat.heal();
			expect(character.play.hp.current).toBe(max - 4);
		});

		it('temp HP soaks first, and is spent before real hit points are', async () => {
			const character = await play('fighter', 5);
			character.play.hp = { current: 20, max: 40, temp: 5 };
			combat.hpAmount = 8;
			combat.damage();
			expect(character.play.hp.temp).toBe(0);
			expect(character.play.hp.current).toBe(17); // 8 − 5 soaked
		});

		it('a caster spends a slot on a leveled spell and nothing on a cantrip', async () => {
			const character = await play('cleric', 5);
			const pools = combat.sheet?.spellcasting.pools ?? [];
			expect(pools.length, 'a level-5 cleric has slot pools').toBeGreaterThan(0);
			const leveled = clericSpell(() => true);
			expect(leveled, 'the pack ships a 1st-level cleric spell').toBeDefined();
			if (!leveled) return;
			const row = spellRow(graph, leveled.effectiveId, 'on');
			expect(row).toBeDefined();
			if (!row) return;
			combat.cast(row, noModifiers, { slot: 1 });
			expect(character.play.spellSlotsSpent['1']).toBe(1);
		});

		it('a long rest gives the slots and the hit points back', async () => {
			const character = await play('cleric', 5);
			character.play.spellSlotsSpent = { 1: 2, 2: 1 };
			character.play.hp = { current: 1, max: 30, temp: 0 };
			combat.resources.rest('long');
			expect(character.play.spellSlotsSpent).toEqual({});
			expect(character.play.hp.current).toBe(combat.hpMax);
		});

		it('a short rest spends a hit die and heals by it', async () => {
			const character = await play('fighter', 5);
			character.play.hp = { current: 10, max: 44, temp: 0 };
			const die = combat.sheet?.hitDice[0];
			expect(die, 'a fighter has hit dice').toBeDefined();
			if (!die) return;
			combat.spendHitDie(die.die);
			expect(character.play.hitDiceSpent[die.die]).toBe(1);
			expect(character.play.hp.current).toBeGreaterThan(10);
		});

		it('a monk spends its pool on a spend-option, and the option is shipped data', async () => {
			await play('monk', 5);
			const pool = combat.sheet?.resources.find((r) => r.id === 'ki' || r.id === 'focus');
			expect(pool, 'a level-5 monk has its pool').toBeDefined();
			if (!pool) return;
			const option = combat.resourceOptions.find((o) => o.resourceId === pool.id);
			expect(option, `${pool.id} has a shipped spend-option`).toBeDefined();
			if (!option) return;
			combat.activateResourceOption(option);
			expect(combat.resources.resourceSpent(pool.id)).toBe(option.cost);
		});

		it('concentration starts on a concentration spell and a long rest ends it', async () => {
			const character = await play('cleric', 5);
			const conc = clericSpell((d) => d.concentration === true);
			expect(conc, 'the pack ships a 1st-level concentration cleric spell').toBeDefined();
			if (!conc) return;
			const row = spellRow(graph, conc.effectiveId, 'on');
			if (!row) return;
			combat.cast(row, noModifiers, { slot: 1 });
			expect(character.play.concentration).toBe(conc.effectiveId);
			combat.resources.rest('long'); // a rest ends what you were concentrating on
			expect(character.play.concentration).toBeNull();
		});
	});
}

describe('play loop · where the editions really differ', () => {
	it('the monk pool is `ki` in 5e and `focus` in 5.5e, and each is its own shipped row', async () => {
		const ids: string[] = [];
		for (const { system, pack, source } of EDITIONS) {
			combat.graph = await loadPacks(pack);
			const c = newCharacter('monk', 'Monk', system);
			c.build.classes = [{ class: `class:${source}:monk`, level: 5 }];
			combat.character = c;
			const pool = combat.sheet?.resources.find((r) => r.id === 'ki' || r.id === 'focus');
			ids.push(pool?.id ?? 'none');
		}
		expect(ids).toEqual(['focus', 'ki']);
	});
});
