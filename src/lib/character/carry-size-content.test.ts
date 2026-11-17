/** Size decides carrying capacity, and the 2024 Goliath counts as one size larger for it
 *  (SRD 5.2.1 ▸ Carrying Capacity, Powerful Build) — audit-oct-27 R14. */
import { describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter } from './schema';
import { deriveSheet } from './derive';
import { carryingCapacity } from '../rules/core';

describe('carrying capacity by size', () => {
	it('each size above Medium doubles it, Tiny halves it, Small is Medium', () => {
		const at = (size: Parameters<typeof carryingCapacity>[0]['size']) =>
			carryingCapacity({ strScore: 10, system: '5.5e', ...(size ? { size } : {}) }).value;
		expect([at('tiny'), at('small'), at('medium'), at('large'), at('huge')]).toEqual([
			75, 150, 150, 300, 600,
		]);
	});

	it('a 2024 Goliath carries as Large, and says why', async () => {
		const graph = await loadPacks('srd-2024');
		const c = newCharacter('goliath_probe', 'Probe', '5.5e');
		c.build.species = 'species:SRD 5.2.1:goliath';
		c.build.classes = [classRow({ class: 'class:SRD 5.2.1:fighter', level: 1 })];
		c.build.abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		const capacity = deriveSheet(c, graph).carryingCapacity;
		expect(capacity.value).toBe(300);
		expect(capacity.trace.some((t) => t.note === 'Goliath')).toBe(true);
	});
});
