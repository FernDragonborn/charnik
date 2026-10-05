/*
 * Effects, concentration and exhaustion as actions, with no view-model: what each one does to the
 * character, and the rules that follow it — an `hp_max` effect ending pulls hit points down, and a
 * state that forbids concentration ends it — holding inside the action.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import {
	addEffect,
	bumpEffectDuration,
	exhaustionLadder,
	removeEffects,
	setEffectDuration,
	setExhaustion,
	stopConcentrating,
} from './effects';
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

describe.each(['5e', '5.5e'] as const)('effect actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const bless = `spell:${source}:bless`;
	const ctx = (): PlayContext => ({
		derive: (character) => deriveSheet(character, graphs[system]),
		graph: graphs[system],
	});

	function fighter(edit: (c: Character) => void = () => {}): Character {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [{ class: `class:${source}:fighter`, level: 5 }];
		c.build.abilities = { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
		c.play.hp = { current: 30, max: 30, temp: 0 };
		edit(c);
		return c;
	}
	const aid = { label: 'Aid', tokens: ['flat_bonus:hp_max+5'], durationRounds: 0 };

	it('an added effect starts its clock at the current round, or has none', () => {
		const c = fighter((x) => (x.play.round = 4));
		const timed = addEffect(c, { ...aid, durationRounds: 10 }, ctx()).character.play.effects[0];
		expect(timed).toMatchObject({ label: 'Aid', durationRounds: 10, startedRound: 4 });
		const lasting = addEffect(c, aid, ctx()).character.play.effects[0];
		expect(lasting).not.toHaveProperty('durationRounds');
		expect(c.play.effects).toEqual([]);
	});

	it('taking an hp_max effect off pulls current hit points down to the maximum it leaves', () => {
		const raised = addEffect(fighter(), aid, ctx()).character;
		const full = { ...raised, play: { ...raised.play, hp: { ...raised.play.hp, current: 35 } } };
		const iid = full.play.effects[0]?.iid ?? '';
		expect(removeEffects(full, [iid], ctx()).character.play.hp.current).toBe(30);
	});

	it('removing the effect a spell left ends the concentration it carried', () => {
		const c = fighter((x) => {
			x.play.concentration = bless;
			x.play.effects = [{ iid: 'b', label: 'Bless', source: bless, effects: [], positive: true }];
		});
		expect(removeEffects(c, ['b'], ctx()).character.play.concentration).toBeNull();
		expect(stopConcentrating(c, ctx()).character.play).toMatchObject({
			concentration: null,
			effects: [],
		});
	});

	it('a duration is rounds from now, and 0 is until removed', () => {
		const c = fighter((x) => {
			x.play.round = 7;
			x.play.effects = [
				{ iid: 'a', label: 'A', effects: [], positive: true, durationRounds: 10, startedRound: 1 },
			];
		});
		const set = (rounds: number) =>
			setEffectDuration(c, { iid: 'a', rounds }, ctx()).character.play.effects[0];
		expect(set(3)).toMatchObject({ durationRounds: 3, startedRound: 7 });
		expect(set(0)).not.toHaveProperty('durationRounds');
		// 4 rounds were left at round 7; one more is 5 from now
		expect(
			bumpEffectDuration(c, { iid: 'a', delta: 1 }, ctx()).character.play.effects[0],
		).toMatchObject({ durationRounds: 5, startedRound: 7 });
	});

	it('a state that forbids concentration ends it when it lands', () => {
		const c = fighter((x) => {
			x.play.concentration = bless;
			x.play.effects = [{ iid: 'b', label: 'Bless', source: bless, effects: [], positive: true }];
		});
		const raging = addEffect(
			c,
			{ label: 'Rage', tokens: ['blocks_concentration'], durationRounds: 0 },
			ctx(),
		).character.play;
		expect(raging.concentration).toBeNull();
		expect(raging.effects.map((effect) => effect.label)).toEqual(['Rage']);
	});

	it('exhaustion is clamped to the ladder, and its top kills', () => {
		const c = fighter();
		const top = exhaustionLadder(c, graphs[system]);
		expect(top).toBe(6);
		expect(setExhaustion(c, { level: 2 }, ctx()).character.play).toMatchObject({
			exhaustion: 2,
			death: null,
		});
		const dead = setExhaustion(c, { level: 99 }, ctx());
		expect(dead.character.play).toMatchObject({ exhaustion: top, death: { cause: 'exhaustion' } });
		expect(dead.notices[0]?.text).toEqual({ key: 'combat.notice.died' });
	});
});
