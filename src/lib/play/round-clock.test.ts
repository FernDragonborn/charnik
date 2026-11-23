/** The game clock only runs forward: entering a fight does not make a timed effect younger (R4), and
 *  a rest passes its hours on it (R7). */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character } from '#lib/character/schema.ts';
import { remainingRounds } from '#lib/combat/effects-view.ts';
import type { ContentGraph } from '#lib/content/loader.ts';
import { deriveSheet } from '#lib/character/derive.ts';
import { toggleCombat } from './turn';
import { rest } from './rests';
import type { PlayContext } from './outcome';

let graph: ContentGraph;
const ctx: PlayContext = {
	derive: (character: Character) => deriveSheet(character, graph),
	locale: 'en',
	get graph() {
		return graph;
	},
};
beforeAll(async () => {
	graph = await loadPacks('srd-2014');
});
const withEffect = (round: number, durationRounds: number): Character => {
	const c = newCharacter('clock_probe', 'Clock probe', '5e');
	c.play.round = round;
	c.play.effects = [
		{ iid: 'e1', label: 'Timed', effects: [], positive: true, durationRounds, startedRound: round },
	];
	return c;
};
const left = (c: Character) => {
	const effect = c.play.effects[0];
	return effect ? remainingRounds(effect, c.play.round) : null;
};

describe('the round clock', () => {
	it('keeps a Bless cast before a fight at the rounds it had', () => {
		const blessed = withEffect(7, 10);
		const leftBefore = left(blessed);
		const fighting = toggleCombat(blessed, ctx).character;
		expect(left(fighting)).toBe(leftBefore);
		const again = toggleCombat(toggleCombat(fighting, ctx).character, ctx).character;
		expect(left(again)).toBe(leftBefore);
	});

	it("passes a long rest's eight hours on a 24-hour effect", () => {
		const day = withEffect(0, 14400);
		const rested = rest(day, { kind: 'long' }, ctx).character;
		expect(left(rested)).toBe(14400 - 4800);
	});
});
