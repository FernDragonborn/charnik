/*
 * Assuming and leaving a form as actions, with no view-model, over both editions' shipped druid:
 * whose hit points are counted, and that what ends a form without being asked ends it inside the
 * action that caused it.
 *
 * SRD 5.1 — "you assume the beast's hit points"; "You automatically revert if you fall unconscious,
 * drop to 0 hit points, or die."
 * SRD 5.2.1 — "you gain a number of Temporary Hit Points equal to your Druid level"; "you retain your
 * … Hit Points"; "until you … have the Incapacitated condition, or die."
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { addEffect, removeEffects } from './effects';
import { assumeForm, revertForm } from './form-shift';
import { die } from './hit-points';
import type { PlayContext } from './outcome';
import { settlePlay } from './settle';

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

describe.each(['5e', '5.5e'] as const)('form actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const wolf = `monster:${source}:wolf`;
	const ctx: PlayContext = {
		derive: (character) => deriveSheet(character, graphs[system]),
		locale: 'en',
		// read when asked: the packs are loaded after this block is collected
		get graph() {
			return graphs[system];
		},
	};

	/** A level-4 druid at full hit points, in combat. */
	function druid(): Character {
		const c = newCharacter('fern', 'Fern', system);
		c.build.classes = [{ class: `class:${source}:druid`, level: 4 }];
		c.build.abilities = { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10 };
		c.play.hp.current = ctx.derive(c).maxHp.value;
		c.play.inCombat = true;
		return c;
	}
	const asWolf = (c: Character) =>
		assumeForm(c, { form: 'wild_shape', monster: wolf, label: 'Wolf' }, ctx).character;
	const gain = (c: Character, condition: string) =>
		addEffect(
			c,
			{
				label: condition,
				tokens: [`apply_condition:${condition}`],
				positive: false,
				durationRounds: 0,
			},
			ctx,
		);

	it('assuming a form counts the hit points the edition says, on a two-hour carrier', () => {
		const own = druid();
		const formed = asWolf(own);
		expect(formed.play.effects).toMatchObject([
			{ source: wolf, label: 'Wolf', durationRounds: 1200 },
		]);
		if (system === '5e') {
			expect(formed.play.form).toEqual({
				id: 'wild_shape',
				monster: wolf,
				hpBefore: own.play.hp.current,
			});
			const row = graphs[system].get(wolf);
			expect(formed.play.hp.current).toBe(row?.type === 'monster' ? Number(row.data.hp) : NaN);
		} else {
			expect(formed.play.form).toEqual({ id: 'wild_shape', monster: wolf });
			expect(formed.play.hp).toMatchObject({ current: own.play.hp.current, temp: 4 });
		}
	});

	it('a form the sheet does not state, or a ref that is no stat block, is refused', () => {
		const c = druid();
		expect(assumeForm(c, { form: 'no_such_form', monster: wolf, label: 'Wolf' }, ctx).refused).toBe(
			true,
		);
		const notABeast = { form: 'wild_shape', monster: `spell:${source}:bless`, label: 'Bless' };
		expect(assumeForm(c, notABeast, ctx).character).toBe(c);
	});

	it('the carrier going is the form going, and the hit points that waited come back', () => {
		const own = druid();
		const formed = asWolf(own);
		const left = removeEffects(formed, [formed.play.effects[0]?.iid ?? ''], ctx).character;
		expect(left.play.form).toBeNull();
		expect(left.play.hp.current).toBe(own.play.hp.current);
	});

	it('falling unconscious ends it, and says so', () => {
		const own = druid();
		const out = gain(asWolf(own), 'unconscious');
		expect(out.character.play.form).toBeNull();
		expect(out.character.play.hp.current).toBe(own.play.hp.current);
		expect(out.notices).toEqual([
			{ text: { key: 'combat.notice.formEnded' }, rows: { name: wolf } },
		]);
	});

	it('Stunned ends a 2024 form, which names Incapacitated, and not a 2014 one', () => {
		const stunned = gain(asWolf(druid()), 'stunned').character;
		expect(stunned.play.form === null).toBe(system === '5.5e');
	});

	it('death ends it', () => {
		const dead = die(asWolf(druid()), 'exhaustion').character;
		expect(settlePlay(dead, ctx).character.play.form).toBeNull();
	});

	it('reverting costs the Bonus Action, and is refused without one', () => {
		const formed = asWolf(druid());
		const back = revertForm(formed, ctx);
		expect(back.character.play.form).toBeNull();
		expect(back.character.play.turn.bonus).toBe(1);
		expect(back.notices.at(-1)).toEqual({
			text: { key: 'combat.notice.formLeft' },
			rows: { name: wolf },
		});

		const spent = { ...formed, play: { ...formed.play, turn: { ...formed.play.turn, bonus: 1 } } };
		const refused = revertForm(spent, ctx);
		expect(refused.refused).toBe(true);
		expect(refused.character.play.form).not.toBeNull();
	});
});
