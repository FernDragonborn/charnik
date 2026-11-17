/** "15 slashing plus 7 fire" is one blow of two types, pressed as two hits. Against 10 HP the first
 *  press drops the fighter to 0 with 5 past it, and the second, at 0, records a failure — which the
 *  player takes back by saying it was one blow. Massive damage then reads the whole blow. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { oneBlow, takeDamage } from './hit-points';
import type { PlayContext } from './outcome';

describe('one blow of two damage types', () => {
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
	const fighter = (hp: number) => {
		const c = newCharacter('blow_probe', 'Blow probe', '5e');
		c.build.classes = [classRow({ class: 'class:SRD 5.1:fighter', level: 3 })];
		c.build.abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		c.play.hp.current = hp;
		return c;
	};

	it('takes back the failure the second type recorded', () => {
		const first = takeDamage(fighter(10), { amount: 15, type: 'slashing' }, ctx);
		expect(first.pastZero).toBe(5);
		const second = takeDamage(first.character, { amount: 7, type: 'fire' }, ctx);
		expect(second.character.play.deathSaves.failures).toBe(1);
		expect(second.pastZero).toBe(7);
		const merged = oneBlow(second.character, { pastZero: 12 }, ctx).character;
		expect(merged.play.deathSaves.failures).toBe(0);
		expect(merged.play.death).toBeNull();
	});

	it('kills when the whole blow past 0 reaches the maximum, though neither part did', () => {
		const max = ctx.derive(fighter(10)).maxHp.value;
		const half = Math.ceil(max / 2);
		const first = takeDamage(fighter(10), { amount: 10 + half, type: 'slashing' }, ctx);
		const second = takeDamage(first.character, { amount: half, type: 'fire' }, ctx);
		expect(second.character.play.death).toBeNull();
		const pastZero = (first.pastZero ?? 0) + (second.pastZero ?? 0);
		const merged = oneBlow(second.character, { pastZero }, ctx).character;
		expect(merged.play.death?.cause).toBe('massive_damage');
	});

	it('is refused with no failure to take back', () => {
		expect(oneBlow(fighter(10), { pastZero: 3 }, ctx).refused).toBe(true);
	});
});
