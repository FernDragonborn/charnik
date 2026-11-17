/** Half proficiency on checks, per edition: 2014 Jack of All Trades reaches "any ability check" —
 *  the bare six and initiative, a Dexterity check — and Remarkable Athlete its three abilities; 2024
 *  Jack of All Trades reaches only checks "that use a skill proficiency you lack". */
import { describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from './schema';
import { deriveSheet } from './derive';

const flat = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
function probe(
	system: '5e' | '5.5e',
	classRef: string,
	level: number,
	subclass?: string,
): Character {
	const c = newCharacter('probe', 'Probe', system);
	c.build.classes = [classRow({ class: classRef, level, ...(subclass ? { subclass } : {}) })];
	c.build.abilities = flat;
	return c;
}

describe('half proficiency on checks', () => {
	it('5e · a Bard 2 adds +1 to a bare check and to initiative', async () => {
		const graph = await loadPacks('srd-2014');
		const sheet = deriveSheet(probe('5e', 'class:SRD 5.1:bard', 2), graph);
		expect(sheet.abilities.str.check.value).toBe(1);
		expect(sheet.initiative.value).toBe(1);
	});

	it('5e · a Champion 7 adds half rounded up to initiative (Remarkable Athlete)', async () => {
		const graph = await loadPacks('srd-2014');
		const sheet = deriveSheet(
			probe('5e', 'class:SRD 5.1:fighter', 7, 'subclass:SRD 5.1:champion'),
			graph,
		);
		expect(sheet.initiative.value).toBe(2);
		expect(sheet.abilities.int.check.value).toBe(0);
	});

	it('5.5e · a Bard 2 adds nothing to a bare check or to initiative', async () => {
		const graph = await loadPacks('srd-2024');
		const sheet = deriveSheet(probe('5.5e', 'class:SRD 5.2.1:bard', 2), graph);
		expect(sheet.abilities.str.check.value).toBe(0);
		expect(sheet.initiative.value).toBe(0);
		expect(sheet.skills.athletics.value).toBe(1);
	});
});
