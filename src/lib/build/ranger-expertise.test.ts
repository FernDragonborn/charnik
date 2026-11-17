/** A 5.5e Ranger's Expertise picks, against the real pack. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import type { ContentGraph } from '$lib/content/loader';
import { expertiseBudget } from './derive';

describe('the Expertise a 5.5e Ranger gains at level 2', () => {
	let graph: ContentGraph;
	beforeAll(async () => {
		graph = await loadPacks('srd-2024');
	});

	// SRD 5.2.1, Ranger ▸ Deft Explorer (level 2): "Expertise. Choose one of your skill
	// proficiencies with which you lack Expertise. You gain Expertise in that skill."
	it('is one pick the builder offers', () => {
		const ranger = { classId: 'class:SRD 5.2.1:ranger', subclassId: null, level: 2 };
		expect(expertiseBudget([ranger], graph, '5.5e')).toBe(1);
		// and Expertise at level 9 adds its two to it
		expect(expertiseBudget([{ ...ranger, level: 9 }], graph, '5.5e')).toBe(3);
	});
});
