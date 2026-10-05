/*
 * Pools, spend-options and rests as actions, with no view-model: what each gives and takes, what it
 * refuses, and that a refusal leaves the character the one it was given.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { rngSequence } from '../../test-support/rng';
import { newCharacter, type Character, classRow } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import type { PlayContext } from './outcome';
import {
	canAfford,
	resourceLeft,
	restoreResourceUpTo,
	setResourcePip,
	spendOnOption,
	useResource,
} from './resources';
import { diceShortRest, halfShortRest, rest, spendHitDie } from './rests';

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

describe.each(['5e', '5.5e'] as const)('resource and rest actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const derive = (character: Character) => deriveSheet(character, graphs[system]);
	const ctx = (...draws: number[]): PlayContext => ({
		derive,
		locale: 'en',
		graph: graphs[system],
		...(draws.length ? { rng: rngSequence(...draws) } : {}),
	});

	/** A level-5 monk at 20 of their hit points, and the pool their class grants (Ki, or Focus). */
	function monk(edit: (c: Character) => void = () => {}) {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [classRow({ class: `class:${source}:monk`, level: 5 })];
		c.build.abilities = { str: 10, dex: 16, con: 14, int: 10, wis: 14, cha: 10 };
		c.play.hp.current = 20;
		edit(c);
		const pool = derive(c).resources.find((r) => r.max === 5);
		if (!pool) throw new Error('a level-5 monk has a pool of 5');
		return { c, pool };
	}
	const flurry = (resource: string, cost: number) => ({
		resource,
		cost,
		name: 'Flurry of Blows',
		says: 'Make two Unarmed Strikes',
	});

	it('a use is spent while the pool has one, and refused when it is empty', () => {
		const { c, pool } = monk();
		const used = useResource(c, { id: pool.id, max: pool.max }, ctx());
		expect(used.refused).toBeUndefined();
		expect(resourceLeft(used.character, derive(used.character), pool.id)).toBe(4);

		const { c: empty } = monk((x) => (x.play.resourcesSpent = { [pool.id]: 5 }));
		const refused = useResource(empty, { id: pool.id, max: pool.max }, ctx());
		expect(refused.refused).toBe(true);
		expect(refused.character).toBe(empty);
	});

	it('a pool named for something every object has holds only what was spent of it', () => {
		// `constructor` is a valid content id, and a plain map answers for it without being asked
		const { c } = monk((x) => {
			x.play.effects = [
				{
					iid: 'homebrew',
					label: 'Homebrew',
					effects: ['grant_resource:constructor:2:long'],
					positive: true,
				},
			];
		});
		const sheet = derive(c);
		expect(sheet.resources.find((pool) => pool.id === 'constructor')?.max).toBe(2);
		expect(resourceLeft(c, sheet, 'constructor')).toBe(2);
		const used = useResource(c, { id: 'constructor', max: 2 }, ctx());
		expect(resourceLeft(used.character, derive(used.character), 'constructor')).toBe(1);
		const rested = rest(used.character, { kind: 'long' }, ctx());
		expect(resourceLeft(rested.character, derive(rested.character), 'constructor')).toBe(2);
	});

	it('an option is paid for at its cost, and refused whole when the pool cannot cover it', () => {
		const { c, pool } = monk((x) => (x.play.resourcesSpent = {}));
		expect(canAfford(c, derive(c), flurry(pool.id, 1))).toBe(true);
		const paid = spendOnOption(c, flurry(pool.id, 3), ctx());
		expect(paid.character.play.resourcesSpent[pool.id]).toBe(3);
		expect(paid.notices[0]?.description).toBe('Make two Unarmed Strikes');
		// only 2 left
		expect(canAfford(paid.character, derive(paid.character), flurry(pool.id, 3))).toBe(false);
		const refused = spendOnOption(paid.character, flurry(pool.id, 3), ctx());
		expect(refused.refused).toBe(true);
		expect(refused.character).toBe(paid.character);
	});

	it('a pip sets the spent count, and "up to N" only ever gives uses back', () => {
		const { c, pool } = monk((x) => (x.play.resourcesSpent = {}));
		const two = setResourcePip(c, { id: pool.id, max: pool.max, index: 3 }, ctx()).character;
		expect(two.play.resourcesSpent[pool.id]).toBe(2);
		const kept = restoreResourceUpTo(two, { id: pool.id, upTo: 1 }, ctx()).character;
		expect(kept.play.resourcesSpent[pool.id]).toBe(2);
		const { c: drained } = monk((x) => (x.play.resourcesSpent = { [pool.id]: 5 }));
		const four = restoreResourceUpTo(drained, { id: pool.id, upTo: 4 }, ctx()).character;
		expect(four.play.resourcesSpent[pool.id]).toBe(1);
	});

	it('a short rest gives back the pool and pact slots, and keeps the other slots spent', () => {
		const { c, pool } = monk((x) => {
			x.play.spellSlotsSpent = { '1': 2, [PACT_SLOT_KEY]: 1 };
		});
		const spent = { ...c, play: { ...c.play, resourcesSpent: { [pool.id]: 5 } } };
		const play = rest(spent, { kind: 'short' }, ctx()).character.play;
		expect(play.resourcesSpent[pool.id]).toBe(0);
		expect(play.spellSlotsSpent).toEqual({ '1': 2 });
		expect(play.hp.current).toBe(20);
	});

	it('a long rest fills hit points, ends concentration, sheds one exhaustion and outlasts 8 hours', () => {
		const { c } = monk((x) => {
			x.play.hp.temp = 3;
			x.play.exhaustion = 2;
			x.play.concentration = `spell:${source}:bless`;
			x.play.spellSlotsSpent = { '1': 2 };
			x.play.spellSlotsGained = { '2': 1 };
			x.play.effects = [
				{ iid: 'hour', label: 'hour', effects: [], positive: true, durationRounds: 600 },
				{ iid: 'day', label: 'day', effects: [], positive: true, durationRounds: 14400 },
				{ iid: 'forever', label: 'forever', effects: [], positive: false },
			];
		});
		const out = rest(c, { kind: 'long' }, ctx());
		const play = out.character.play;
		expect(play.hp).toMatchObject({ current: derive(out.character).maxHp.value, temp: 0 });
		expect(play).toMatchObject({
			concentration: null,
			exhaustion: 1,
			spellSlotsSpent: {},
			spellSlotsGained: {},
		});
		expect(play.effects.map((effect) => effect.iid)).toEqual(['day', 'forever']);
		expect(out.notices[0]?.description).toMatchObject({ values: { from: 2, to: 1 } });
	});

	it('a long rest returns every spent Hit Die in 2024 and half the total in 2014', () => {
		const { c } = monk((x) => (x.play.hitDiceSpent = { d8: 5 }));
		const left = rest(c, { kind: 'long' }, ctx()).character.play.hitDiceSpent.d8;
		expect(left).toBe(system === '5.5e' ? 0 : 3);
	});

	it('a Hit Die heals what it rolls plus Constitution, and is refused when none is left', () => {
		const { c } = monk();
		// a d8 landing on 5, +2 CON
		const out = spendHitDie(c, { die: 'd8' }, ctx(4 / 8));
		expect(out.character.play.hp.current).toBe(27);
		expect(out.character.play.hitDiceSpent).toEqual({ d8: 1 });
		expect(out.log[0]?.rolled?.total).toBe(7);

		const { c: none } = monk((x) => (x.play.hitDiceSpent = { d8: 5 }));
		const refused = spendHitDie(none, { die: 'd8' }, ctx());
		expect(refused.refused).toBe(true);
		expect(refused.character).toBe(none);
	});

	it('the dice short rest recharges and then spends each chosen die, in one outcome', () => {
		const { c, pool } = monk((x) => (x.play.resourcesSpent = {}));
		const spent = { ...c, play: { ...c.play, resourcesSpent: { [pool.id]: 2 } } };
		const out = diceShortRest(spent, { hitDice: { d8: 2 } }, ctx(0, 7 / 8));
		// 1+2 and 8+2
		expect(out.character.play.hp.current).toBe(33);
		expect(out.character.play.hitDiceSpent).toEqual({ d8: 2 });
		expect(out.character.play.resourcesSpent[pool.id]).toBe(0);
		expect(out.log).toHaveLength(2);
		expect(out.notices.at(-1)?.text).toEqual({ key: 'combat.notice.shortRestTaken' });
	});

	it('the half short rest heals half the maximum and spends no Hit Dice', () => {
		const { c } = monk((x) => (x.play.hp.current = 1));
		const out = halfShortRest(c, ctx());
		const max = derive(c).maxHp.value;
		expect(out.character.play.hp.current).toBe(Math.min(max, 1 + Math.floor(max / 2)));
		expect(out.character.play.hitDiceSpent).toEqual({});
	});
});
