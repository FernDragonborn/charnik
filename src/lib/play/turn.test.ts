/*
 * The turn as actions, with no view-model: what a slot costs and when it is refused, what the round
 * counter expires, and that nothing is charged out of combat.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import type { PlayContext } from './outcome';
import {
	advanceTime,
	markRollUsed,
	nextTurn,
	spendMove,
	spendStrike,
	spendTurnSlot,
	toggleCombat,
	turnSlotMax,
} from './turn';

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

describe.each(['5e', '5.5e'] as const)('turn actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const derive = (character: Character) => deriveSheet(character, graphs[system]);
	const ctx: PlayContext = {
		derive,
		// read when asked: the packs are loaded after this block is collected
		get graph() {
			return graphs[system];
		},
	};

	/** A level-5 fighter (Extra Attack) at 30 hit points, in combat. */
	function fighter(edit: (c: Character) => void = () => {}): Character {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [{ class: `class:${source}:fighter`, level: 5 }];
		c.build.abilities = { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
		c.play.hp.current = 30;
		c.play.inCombat = true;
		c.play.round = 1;
		edit(c);
		return c;
	}

	it('a slot is spent once and refused the second time, and never charged out of combat', () => {
		const once = spendTurnSlot(fighter(), { slot: 'bonus' }, ctx);
		expect(once.character.play.turn.bonus).toBe(1);
		const twice = spendTurnSlot(once.character, { slot: 'bonus' }, ctx);
		expect(twice.refused).toBe(true);
		expect(twice.character).toBe(once.character);
		expect(twice.notices[0]?.text).toMatchObject({ key: 'combat.notice.noSlotLeft' });

		const resting = fighter((x) => (x.play.inCombat = false));
		expect(spendTurnSlot(resting, { slot: 'bonus' }, ctx).character).toBe(resting);
	});

	it('incapacitated has no slots at all, and says so in its own words', () => {
		const stunned = fighter((x) => {
			x.play.effects = [
				{ iid: 's', label: 'Stunned', effects: ['apply_condition:stunned'], positive: false },
			];
		});
		expect(turnSlotMax(stunned, derive(stunned))).toEqual({ action: 0, bonus: 0, reaction: 0 });
		const refused = spendTurnSlot(stunned, { slot: 'action' }, ctx);
		expect(refused.refused).toBe(true);
		expect(refused.notices[0]?.text).toEqual({ key: 'combat.notice.incapacitated' });
	});

	it('Extra Attack buys two strikes with one Action, and the third is refused', () => {
		const first = spendStrike(fighter(), ctx).character;
		expect(first.play.turn).toMatchObject({ action: 1, attacksMade: 1 });
		const second = spendStrike(first, ctx).character;
		expect(second.play.turn).toMatchObject({ action: 1, attacksMade: 2 });
		const third = spendStrike(second, ctx);
		expect(third.refused).toBe(true);
		expect(third.character.play.turn.attacksMade).toBe(2);
	});

	it('movement stops at the speed', () => {
		const c = fighter();
		const speed = derive(c).speed.value;
		expect(spendMove(c, { feet: speed + 20 }, ctx).character.play.turn.move).toBe(speed);
	});

	it('the next turn refreshes the slots, moves the round on and expires what ran out', () => {
		const c = fighter((x) => {
			x.play.turn = { ...x.play.turn, action: 1, bonus: 1, move: 15, usedRolls: ['sneak'] };
			x.play.concentration = `spell:${source}:bless`;
			x.play.effects = [
				{
					iid: 'b',
					label: 'Bless',
					source: `spell:${source}:bless`,
					effects: [],
					positive: true,
					durationRounds: 1,
					startedRound: 1,
				},
				{
					iid: 'k',
					label: 'Kept',
					effects: [],
					positive: true,
					durationRounds: 5,
					startedRound: 1,
				},
			];
		});
		const out = nextTurn(c, ctx);
		expect(out.character.play).toMatchObject({ round: 2, concentration: null });
		expect(out.character.play.turn).toMatchObject({ action: 0, bonus: 0, move: 0, usedRolls: [] });
		expect(out.character.play.effects.map((effect) => effect.iid)).toEqual(['k']);
		expect(out.notices.map((notice) => notice.text)).toEqual([
			{ key: 'combat.notice.effectExpired', values: { label: 'Bless' } },
		]);
	});

	it('time passed out of combat expires effects and leaves the turn alone', () => {
		const c = fighter((x) => {
			x.play.inCombat = false;
			x.play.turn = { ...x.play.turn, action: 1 };
			x.play.effects = [
				{
					iid: 'm',
					label: 'Minute',
					effects: [],
					positive: true,
					durationRounds: 10,
					startedRound: 1,
				},
			];
		});
		const play = advanceTime(c, { rounds: 10 }, ctx).character.play;
		expect(play.round).toBe(11);
		expect(play.effects).toEqual([]);
		expect(play.turn.action).toBe(1);
	});

	it('entering combat starts a clean turn at round 1; a mark needs a turn to hold it', () => {
		const resting = fighter((x) => {
			x.play.inCombat = false;
			x.play.round = 40;
		});
		expect(markRollUsed(resting, { id: 'sneak' }).character).toBe(resting);
		const fighting = toggleCombat(resting, ctx).character;
		expect(fighting.play).toMatchObject({ inCombat: true, round: 1 });
		expect(markRollUsed(fighting, { id: 'sneak' }).character.play.turn.usedRolls).toEqual([
			'sneak',
		]);
		expect(toggleCombat(fighting, ctx).character.play.inCombat).toBe(false);
	});
});
