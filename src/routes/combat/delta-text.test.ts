import { describe, it, expect } from 'vitest';
import { deltaPhrases, type DeltaWords } from './delta-text';

const words: DeltaWords = {
	t: (key, values) => `${key.replace('combat.delta.', '')}(${Object.values(values).join(',')})`,
	resource: (id) => id.toUpperCase(),
	item: (ref) => ref.split(':').at(-1) ?? ref,
};

describe('a delta as the phrases its log line shows', () => {
	it('says counts, rows and hit points, and leaves the clock and an order out', () => {
		const phrases = deltaPhrases(
			[
				{ path: ['play', 'hp', 'current'], from: 9, to: 30 },
				{ path: ['play', 'spellSlotsSpent', 'pact'], from: 1 },
				{ path: ['play', 'spellSlotsSpent', '2'], from: 2 },
				{ path: ['play', 'resourcesSpent', 'rage'], from: 1 },
				{ path: ['play', 'round'], from: 0, to: 4800 },
				{
					path: ['build', 'inventory', '#a'],
					from: { iid: 'a', item: 'item:SRD 5.1:dagger' },
					at: 0,
				},
				{ path: ['build', 'inventory', '#order'], from: ['a'], to: ['a'] },
			],
			words,
		);
		expect(phrases).toEqual([
			'hp(9,30)',
			'pactSlots(1,0)',
			'slots(2,0,2)',
			'resource(1,0,RAGE)',
			'removed(dagger)',
		]);
	});
});
