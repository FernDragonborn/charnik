import { describe, it, expect } from 'vitest';
import { computed, NOTE_KEY, type Contribution } from './pipeline';

const c = (source: string, layer: Contribution['layer'], op: Contribution['op'], amount: number) =>
	({ source, layer, op, amount }) satisfies Contribution;

describe('a `base` contribution competes with the base, and the rest still adds', () => {
	const unarmored = [c('Base', 'base', 'add', 10), c('DEX mod', 'ability', 'add', 2)];

	it('a higher base takes the core base’s place; a shield and a cloak still add on top', () => {
		const ac = computed([
			...unarmored,
			c('Shield', 'item', 'add', 2),
			c('Cloak of Protection', 'item', 'add', 1),
			c('Unarmored Defense', 'feature', 'base', 15),
		]);
		expect(ac.value).toBe(18);
		expect(ac.notes?.map((n) => n.key)).toContain(NOTE_KEY.baseReplaced);
	});

	it('a lower base loses to the armour, and says so', () => {
		const ac = computed([
			c('Plate', 'base', 'add', 18),
			c('Unarmored Defense', 'feature', 'base', 15),
		]);
		expect(ac.value).toBe(18);
		expect(ac.notes?.map((n) => n.key)).toEqual([NOTE_KEY.baseNotHigher]);
	});

	it('two bases: the most potent wins, the other is explained', () => {
		const ac = computed([
			...unarmored,
			c('Mage Armor', 'condition', 'base', 15),
			c('Unarmored Defense', 'feature', 'base', 16),
		]);
		expect(ac.value).toBe(16);
		expect(ac.notes?.map((n) => n.key).sort()).toEqual(
			[NOTE_KEY.baseNotHigher, NOTE_KEY.baseReplaced].sort(),
		);
	});
});
