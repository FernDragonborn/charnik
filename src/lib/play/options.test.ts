/*
 * Using a feature's spend-option as an action, with no view-model, over the shipped classes: nothing
 * is paid unless everything can be, a verb that needs the host says so in `asks`, and an option is
 * reachable by its id alone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { rngSequence } from '../../test-support/rng';
import { newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { enterOrLeaveCombat, startNextTurn } from './events';
import { activateOption, activateOptionById, runAction } from './options';
import { PLAY_REQUEST, type PlayContext } from './outcome';
import { resourceLeft } from './resources';

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

const EFFECT_ROUNDS = 10;

describe.each(['5e', '5.5e'] as const)('option actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const derive = (character: Character) => deriveSheet(character, graphs[system]);
	const ctx = (...draws: number[]): PlayContext => ({
		derive,
		locale: 'en',
		// read when asked: the packs are loaded after this block is collected
		get graph() {
			return graphs[system];
		},
		...(draws.length ? { rng: rngSequence(...draws) } : {}),
	});

	function build(cls: string, level: number, edit: (c: Character) => void = () => {}): Character {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [{ class: `class:${source}:${cls}`, level }];
		c.build.abilities = { str: 14, dex: 14, con: 14, int: 10, wis: 16, cha: 10 };
		c.play.hp.current = 5;
		c.play.inCombat = true;
		c.play.round = 1;
		edit(c);
		return c;
	}
	const secondWind = (c: Character) => {
		const option = derive(c).resourceOptions.find((o) => o.resourceId === 'second_wind');
		if (!option) throw new Error('a fighter has Second Wind');
		return option;
	};

	it('Second Wind heals, and pays its use and its Bonus Action — by the option’s id alone', () => {
		const c = build('fighter', 3);
		const option = secondWind(c);
		const use = { option: option.id, resource: option.resourceId, effectRounds: EFFECT_ROUNDS };
		// a d10 landing on 6, plus the fighter's level
		const out = activateOptionById(c, use, ctx(5 / 10));
		expect(out.character.play.hp.current).toBe(5 + 6 + 3);
		expect(out.character.play.turn.bonus).toBe(1);
		expect(resourceLeft(out.character, derive(out.character), 'second_wind')).toBe(
			resourceLeft(c, derive(c), 'second_wind') - 1,
		);
		expect(out.log[0]?.name.key).toBe('combat.log.heal');
		expect(activateOptionById(c, { ...use, option: 'no_such_option' }, ctx()).refused).toBe(true);
	});

	it('nothing is paid when the turn slot is spent, the pool is empty, or the window is shut', () => {
		const option = secondWind(build('fighter', 3));
		const use = { option, effectRounds: EFFECT_ROUNDS };
		const noSlot = build('fighter', 3, (x) => (x.play.turn.bonus = 1));
		const noPool = build('fighter', 3, (x) => (x.play.resourcesSpent = { second_wind: 9 }));
		for (const blocked of [noSlot, noPool]) {
			const out = activateOption(blocked, use, ctx());
			expect(out.refused).toBe(true);
			expect(out.character).toBe(blocked);
		}
		const shut = activateOption(
			build('fighter', 3),
			{ ...use, option: { ...option, available: false } },
			ctx(),
		);
		expect(shut.notices[0]?.text).toMatchObject({ key: 'combat.notice.notAvailable' });
	});

	it('a strike is asked of the host, capped against a typo; a form is asked BEFORE anything is paid', () => {
		const c = build('fighter', 3);
		const strikes = runAction(
			c,
			{ name: 'Flurry', action: 'attack:Unarmed_Strike:200', effectRounds: 0 },
			ctx(),
		);
		expect(strikes.character).toBe(c);
		expect(strikes.asks).toEqual([
			{ kind: PLAY_REQUEST.attack, weapon: 'unarmed_strike', count: 12, name: 'Flurry' },
		]);

		const druid = build('druid', 4);
		const wildShape = derive(druid).resourceOptions.find((o) =>
			o.action.startsWith('assume_form:'),
		);
		if (!wildShape) throw new Error('a druid assumes a form');
		const asked = activateOption(druid, { option: wildShape, effectRounds: EFFECT_ROUNDS }, ctx());
		expect(asked.asks).toEqual([{ kind: PLAY_REQUEST.form, form: 'wild_shape' }]);
		expect(asked.character).toBe(druid);

		const wolf = `monster:${source}:wolf`;
		const taken = activateOption(
			druid,
			{ option: wildShape, effectRounds: EFFECT_ROUNDS, form: { monster: wolf, label: 'Wolf' } },
			ctx(),
		).character;
		expect(taken.play.form?.monster).toBe(wolf);
		expect(taken.play.resourcesSpent.wild_shape).toBe(1);
		// an Action in 2014, a Bonus Action in 2024
		expect(taken.play.turn).toMatchObject(system === '5e' ? { action: 1 } : { bonus: 1 });
	});

	it('verbs run in order on one activation, and a named state refreshes instead of stacking', () => {
		const c = build('barbarian', 3, (x) => (x.play.resourcesSpent = { rage: 2 }));
		const run = {
			name: 'Probe',
			action: 'restore_resource:rage;gain_action;apply_effect:rage',
			effectRounds: 7,
		};
		const once = runAction(c, run, ctx()).character;
		expect(once.play.resourcesSpent.rage).toBe(0);
		expect(once.play.turn.grantedActions).toBe(1);
		const twice = runAction(once, run, ctx()).character;
		expect(twice.play.effects.filter((effect) => effect.source?.endsWith(':rage'))).toHaveLength(1);
		const missing = runAction(c, { ...run, action: 'apply_effect:no_such_state' }, ctx());
		expect(missing.notices[0]?.text).toMatchObject({ key: 'combat.notice.effectMissing' });
	});

	it('a formula that did not resolve is not rolled, and says so where it was pressed', () => {
		const c = build('fighter', 3);
		for (const verb of ['heal', 'roll']) {
			const run = { name: 'Probe', action: `${verb}:1d10+no_such_var`, effectRounds: 0 };
			const out = runAction(c, run, ctx());
			expect(out.character).toBe(c);
			expect(out.log).toEqual([]);
			expect(out.notices[0]).toMatchObject({
				text: { key: 'combat.notice.actionUnresolved', values: { name: 'Probe' } },
				description: { values: { formula: '1d10+no_such_var' } },
			});
		}
		// what the resolver writes — dice, numbers, signs, spaces — still runs
		const healed = runAction(
			c,
			{ name: 'Probe', action: 'heal: 1d4 + 2', effectRounds: 0 },
			ctx(0),
		);
		expect(healed.character.play.hp.current).toBe(5 + 1 + 2);
	});

	it('entering combat starts round 1, and ending a turn starts the next', () => {
		const resting = build('fighter', 3, (x) => {
			x.play.inCombat = false;
			x.play.round = 30;
		});
		const fighting = enterOrLeaveCombat(resting, { effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(fighting.play).toMatchObject({ inCombat: true, round: 1 });
		const spent = {
			...fighting,
			play: { ...fighting.play, turn: { ...fighting.play.turn, action: 1 } },
		};
		const next = startNextTurn(spent, { effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(next.play.round).toBe(2);
		expect(next.play.turn.action).toBe(0);
	});
});
