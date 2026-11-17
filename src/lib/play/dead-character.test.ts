/** A dead character neither rests nor heals, so a mistaken death stays one `takeBackLastSave` away. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { heal, takeBackLastSave } from './hit-points';
import { halfShortRest, rest, spendHitDie } from './rests';
import type { PlayContext } from './outcome';

describe('a dead character', () => {
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
	const corpse = () => {
		const c = newCharacter('dead_probe', 'Dead probe', '5e');
		c.build.classes = [classRow({ class: 'class:SRD 5.1:fighter', level: 3 })];
		c.play.hp.current = 0;
		c.play.deathSaves = { successes: 0, failures: 3 };
		c.play.death = { cause: 'death_saves', exhaustion: 0 };
		return c;
	};

	it('is refused a rest, healing and a Hit Die, and says why', () => {
		for (const outcome of [
			rest(corpse(), { kind: 'long' }, ctx),
			rest(corpse(), { kind: 'short' }, ctx),
			halfShortRest(corpse(), ctx),
			heal(corpse(), { amount: 10 }, ctx),
			spendHitDie(corpse(), { die: 'd10' }, ctx),
		]) {
			expect(outcome.refused).toBe(true);
			expect(outcome.character.play.hp.current).toBe(0);
			expect(outcome.notices[0]?.text).toEqual({ key: 'combat.notice.deadCannotHeal' });
		}
	});

	it('keeps the mistaken third failure one take-back away after a refused long rest', () => {
		const after = rest(corpse(), { kind: 'long' }, ctx).character;
		const back = takeBackLastSave(after);
		expect(back.refused).toBeFalsy();
		expect(back.character.play.death).toBeNull();
	});
});
