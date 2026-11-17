/** Which shipped healing spells add the spellcasting modifier — the row's statement, per edition. */
import { describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { spellRow } from './spells';

const HEALS = [
	'cure_wounds',
	'healing_word',
	'prayer_of_healing',
	'mass_healing_word',
	'mass_cure_wounds',
];

describe('the healing spells that add the spellcasting modifier', () => {
	// SRD 5.1: all five read "… plus your spellcasting ability modifier".
	it('5e: all five', async () => {
		const graph = await loadPacks('srd-2014');
		const adds = HEALS.filter(
			(id) => spellRow(graph, `spell:SRD 5.1:${id}`, '')?.healModifier === 'spellcasting',
		);
		expect(adds).toEqual(HEALS);
	});

	// SRD 5.2.1, Prayer of Healing: "… and also regain 2d8 Hit Points" — no modifier.
	it('5.5e: all but Prayer of Healing', async () => {
		const graph = await loadPacks('srd-2024');
		const adds = HEALS.filter(
			(id) => spellRow(graph, `spell:SRD 5.2.1:${id}`, '')?.healModifier === 'spellcasting',
		);
		expect(adds).toEqual(HEALS.filter((id) => id !== 'prayer_of_healing'));
	});
});
