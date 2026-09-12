/*
 * Switching a class must not destroy what the outgoing one owned, and must not hand its picks to
 * the incoming one. Pure functions over a plain draft — no Svelte runtime needed.
 *
 * Row ids are spelled out here rather than minted, because the whole point of the slot key is which
 * ROW it names: a test that could not tell two rows apart would pass on the bug this prevents.
 */
import { describe, it, expect } from 'vitest';
import { blankDraft, type DraftClass } from './draft';
import {
	stashClassPicks,
	dropRowSlots,
	restoreClassPicks,
	removeClassRow,
	switchClass,
	type ClassScopedPicks,
} from './class-picks-cache';

const row = (rowId: string, classId: string, extra: Partial<DraftClass> = {}): DraftClass => ({
	rowId,
	classId,
	subclassId: null,
	level: 1,
	...extra,
});

const wizardish = () => {
	const d = blankDraft();
	d.classes = [row('r0', 'srd:wizard', { subclassId: 'srd:evoker', level: 5 })];
	d.skills = ['arcana', 'history'];
	d.expertise = ['arcana'];
	d.selectedSpells = ['srd:fireball'];
	d.slotFeats['r0:4'] = 'srd:alert';
	d.slotFeatAbility['r0:4'] = 'int';
	return d;
};

describe('class-scoped picks', () => {
	it('round-trips everything a class owns', () => {
		const d = wizardish();
		const stashed = stashClassPicks(d, 0);
		expect(stashed).not.toBeNull();
		dropRowSlots(d, 'r0');
		d.classes = [row('r0', 'srd:barbarian')];

		expect(d.slotFeats['r0:4']).toBeUndefined();

		d.classes = [row('r0', 'srd:wizard')];
		restoreClassPicks(d, 0, stashed as ClassScopedPicks);

		expect(d.classes[0]).toMatchObject({ subclassId: 'srd:evoker', level: 5 });
		expect(d.slotFeats['r0:4']).toBe('srd:alert');
		expect(d.slotFeatAbility['r0:4']).toBe('int');
		expect(d.skills).toEqual(['arcana', 'history']);
		expect(d.selectedSpells).toEqual(['srd:fireball']);
	});

	it('re-keys slot picks when the class comes back in a different row', () => {
		const d = wizardish();
		const stashed = stashClassPicks(d, 0) as ClassScopedPicks;
		d.classes = [row('r1', 'srd:cleric'), row('r2', 'srd:wizard')];
		restoreClassPicks(d, 1, stashed);
		expect(d.slotFeats['r2:4']).toBe('srd:alert');
	});

	it('leaves another row alone', () => {
		const d = wizardish();
		d.classes = [row('r0', 'srd:wizard', { level: 3 }), row('r1', 'srd:cleric', { level: 2 })];
		d.slotFeats['r1:4'] = 'srd:tough';
		dropRowSlots(d, 'r0');
		expect(d.slotFeats['r0:4']).toBeUndefined();
		expect(d.slotFeats['r1:4']).toBe('srd:tough');
	});

	it('does not carry the shared pools while multiclassed', () => {
		const d = wizardish();
		d.classes = [row('r0', 'srd:wizard', { level: 3 }), row('r1', 'srd:cleric', { level: 2 })];
		// two classes feed one spell list, so a snapshot of it belongs to neither of them
		expect(stashClassPicks(d, 0)?.shared).toBeNull();
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
			row('r0', 'srd:wizard', { subclassId: 'srd:evoker', level: 4 }),
			row('r1', 'srd:fighter', { level: 4 }),
			row('r2', 'srd:rogue', { subclassId: 'srd:thief', level: 4 }),
		];
		d.slotFeats['r0:4'] = 'srd:alert';
		d.slotFeats['r1:4'] = 'srd:tough';
		d.slotFeats['r2:4'] = 'srd:lucky';
		return d;
	};

	it('leaves every survivor holding its own picks, and takes the removed row’s away', () => {
		const d = threeClasses();
		removeClassRow(d, 1, new Map());

		expect(d.classes.map((c) => c.classId)).toEqual(['srd:wizard', 'srd:rogue']);
		expect(d.slotFeats['r0:4']).toBe('srd:alert');
		// the Rogue moved from row 2 to row 1 and its picks did not have to move with it
		expect(d.slotFeats['r2:4']).toBe('srd:lucky');
		expect(d.slotFeats['r1:4']).toBeUndefined();
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

describe('switching the class in a row', () => {
	it('keeps picks made before there was any class to own them', () => {
		const d = blankDraft();
		d.classes = [{ rowId: 'r0', classId: null, subclassId: null, level: 1 }];
		d.skills = ['acrobatics', 'stealth'];
		d.expertise = ['stealth'];
		d.selectedSpells = ['srd:fireball'];
		switchClass(d, 0, 'srd:rogue', new Map());
		// nothing was stashed — there was no class to stash it under — so emptying them has no way back
		expect(d.skills).toEqual(['acrobatics', 'stealth']);
		expect(d.expertise).toEqual(['stealth']);
		expect(d.selectedSpells).toEqual(['srd:fireball']);
	});

	it('empties the shared pools when the one class that could have filled them leaves — and hands them back', () => {
		const d = wizardish();
		const cache = new Map<string, ClassScopedPicks>();
		switchClass(d, 0, 'srd:rogue', cache);
		expect(d.skills).toEqual([]);
		expect(d.expertise).toEqual([]);
		switchClass(d, 0, 'srd:wizard', cache);
		expect(d.skills).toEqual(['arcana', 'history']);
		expect(d.expertise).toEqual(['arcana']);
	});
});
