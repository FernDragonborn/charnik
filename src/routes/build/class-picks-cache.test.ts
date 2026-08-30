/*
 * Switching a class must not destroy what the outgoing one owned, and must not hand its picks to
 * the incoming one. Pure functions over a plain draft — no Svelte runtime needed.
 */
import { describe, it, expect } from 'vitest';
import { blankDraft } from './draft';
import {
	stashClassPicks,
	clearClassPicks,
	restoreClassPicks,
	removeClassRow,
	type ClassScopedPicks,
} from './class-picks-cache';

const wizardish = () => {
	const d = blankDraft();
	d.classes = [{ classId: 'srd:wizard', subclassId: 'srd:evoker', level: 5 }];
	d.skills = ['arcana', 'history'];
	d.expertise = ['arcana'];
	d.selectedSpells = ['srd:fireball'];
	d.slotFeats['0:4'] = 'srd:alert';
	d.slotFeatAbility['0:4'] = 'int';
	return d;
};

describe('class-scoped picks', () => {
	it('round-trips everything a class owns', () => {
		const d = wizardish();
		const stashed = stashClassPicks(d, 0)!;
		clearClassPicks(d, 0);
		d.classes = [{ classId: 'srd:barbarian', subclassId: null, level: 1 }];

		expect(d.slotFeats['0:4']).toBeUndefined();
		expect(d.selectedSpells).toEqual([]);

		d.classes = [{ classId: 'srd:wizard', subclassId: null, level: 1 }];
		restoreClassPicks(d, 0, stashed);

		expect(d.classes[0]).toMatchObject({ subclassId: 'srd:evoker', level: 5 });
		expect(d.slotFeats['0:4']).toBe('srd:alert');
		expect(d.slotFeatAbility['0:4']).toBe('int');
		expect(d.skills).toEqual(['arcana', 'history']);
		expect(d.selectedSpells).toEqual(['srd:fireball']);
	});

	it('re-keys slot picks when the class comes back in a different row', () => {
		const d = wizardish();
		const stashed = stashClassPicks(d, 0)!;
		d.classes = [
			{ classId: 'srd:cleric', subclassId: null, level: 1 },
			{ classId: 'srd:wizard', subclassId: null, level: 1 },
		];
		restoreClassPicks(d, 1, stashed);
		expect(d.slotFeats['1:4']).toBe('srd:alert');
	});

	it('leaves another row alone', () => {
		const d = wizardish();
		d.classes = [
			{ classId: 'srd:wizard', subclassId: null, level: 3 },
			{ classId: 'srd:cleric', subclassId: null, level: 2 },
		];
		d.slotFeats['1:4'] = 'srd:tough';
		clearClassPicks(d, 0);
		expect(d.slotFeats['0:4']).toBeUndefined();
		expect(d.slotFeats['1:4']).toBe('srd:tough');
	});

	it('does not carry the shared pools while multiclassed', () => {
		const d = wizardish();
		d.classes = [
			{ classId: 'srd:wizard', subclassId: null, level: 3 },
			{ classId: 'srd:cleric', subclassId: null, level: 2 },
		];
		// two classes feed one spell list, so a snapshot of it belongs to neither of them
		expect(stashClassPicks(d, 0)!.shared).toBeNull();
		clearClassPicks(d, 0);
		expect(d.selectedSpells).toEqual(['srd:fireball']);
	});

	it('is null for a row with no class yet', () => {
		expect(stashClassPicks(blankDraft(), 0)).toBeNull();
	});
});

describe('removing a class row', () => {
	/** Wizard / Fighter / Rogue, each with a feat in its own level-4 slot. */
	const threeClasses = () => {
		const d = blankDraft();
		d.classes = [
			{ classId: 'srd:wizard', subclassId: 'srd:evoker', level: 4 },
			{ classId: 'srd:fighter', subclassId: null, level: 4 },
			{ classId: 'srd:rogue', subclassId: 'srd:thief', level: 4 },
		];
		d.slotFeats['0:4'] = 'srd:alert';
		d.slotFeats['1:4'] = 'srd:tough';
		d.slotFeats['2:4'] = 'srd:lucky';
		return d;
	};

	it('leaves every survivor holding its own picks, not the removed row’s', () => {
		const d = threeClasses();
		removeClassRow(d, 1, new Map());

		expect(d.classes.map((c) => c.classId)).toEqual(['srd:wizard', 'srd:rogue']);
		expect(d.slotFeats['0:4']).toBe('srd:alert'); // Wizard, unmoved
		expect(d.slotFeats['1:4']).toBe('srd:lucky'); // Rogue, re-keyed off row 2
		expect(d.slotFeats['2:4']).toBeUndefined(); // nothing left behind at the old index
		expect(d.classes[1]).toMatchObject({ subclassId: 'srd:thief', level: 4 });
	});

	it('caches what the removed row owned, so bringing the class back costs nothing', () => {
		const d = threeClasses();
		const cache = new Map<string, ClassScopedPicks>();
		removeClassRow(d, 1, cache);
		expect(cache.get('srd:fighter')?.slotFeats).toEqual({ '4': 'srd:tough' });
	});

	it('refuses the primary row and any index that is not there', () => {
		const d = threeClasses();
		removeClassRow(d, 0, new Map());
		removeClassRow(d, 9, new Map());
		expect(d.classes).toHaveLength(3);
	});
});
