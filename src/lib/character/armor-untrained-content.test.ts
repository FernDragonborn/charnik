/** A Wizard, Sorcerer or Monk in armour is untrained in it, in both editions: the shipped rows say
 *  `armor_profs` = `none`, and the armour blocks casting. */
import { describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, inventoryRow, newCharacter } from './schema';
import { deriveSheet } from './derive';
import { ISSUE_KEY } from '$lib/effects/token-parser';

const EDITIONS = [
	{ pack: 'srd-2014', source: 'SRD 5.1', system: '5e', plate: 'plate' },
	{ pack: 'srd-2024', source: 'SRD 5.2.1', system: '5.5e', plate: 'plate_armor' },
] as const;

describe.each(EDITIONS)('$system · casters in armour', ({ pack, source, system, plate }) => {
	it.each(['wizard', 'sorcerer'])('a %s in plate cannot cast', async (classId) => {
		const graph = await loadPacks(pack);
		const c = newCharacter(`${classId}_probe`, 'Probe', system);
		c.build.classes = [classRow({ class: `class:${source}:${classId}`, level: 1 })];
		c.build.inventory = [
			inventoryRow({ item: `item:${source}:${plate}`, qty: 1, equipped: true, attuned: false }),
		];
		const sheet = deriveSheet(c, graph);
		expect(sheet.spellcasting.armorBlock?.category).toBe('heavy');
		expect(sheet.deriveIssues.some((i) => i.key === ISSUE_KEY.armorBlocksCasting)).toBe(true);
	});
});
