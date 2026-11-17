import { describe, it, expect } from 'vitest';
import {
	gatherProfGrants,
	isWeaponProficient,
	isArmorProficient,
	NO_PROFICIENCY,
	UNCONSTRAINED,
} from './proficiency';

describe('proficiency model (pure)', () => {
	it('gatherProfGrants: unions declared class grants', () => {
		const g = gatherProfGrants(['simple,martial', 'light,heavy']);
		expect(g).not.toBe(UNCONSTRAINED);
		expect([...(g as Set<string>)].sort()).toEqual(['heavy', 'light', 'martial', 'simple']);
	});

	it('gatherProfGrants: any undeclared (blank) class → UNCONSTRAINED (lenient)', () => {
		expect(gatherProfGrants(['simple', undefined])).toBe(UNCONSTRAINED);
		expect(gatherProfGrants(['simple', ''])).toBe(UNCONSTRAINED);
	});

	it('gatherProfGrants: `none` declares no proficiency, and a union with it keeps the others', () => {
		const wizard = gatherProfGrants([NO_PROFICIENCY]);
		expect(wizard).not.toBe(UNCONSTRAINED);
		expect(isArmorProficient(wizard, 'light')).toBe(false);
		const multiclass = gatherProfGrants([NO_PROFICIENCY, 'light,medium']);
		expect([
			isArmorProficient(multiclass, 'medium'),
			isArmorProficient(multiclass, 'heavy'),
		]).toEqual([true, false]);
	});

	it('gatherProfGrants: no classes at all → UNCONSTRAINED (lenient, never wrong-downward)', () => {
		expect(gatherProfGrants([])).toBe(UNCONSTRAINED);
	});

	it('isWeaponProficient: category grant OR specific weapon id', () => {
		const g = new Set(['simple', 'longsword']);
		expect(isWeaponProficient(g, 'simple', 'club')).toBe(true); // category
		expect(isWeaponProficient(g, 'martial', 'longsword')).toBe(true); // specific id
		expect(isWeaponProficient(g, 'martial', 'greataxe')).toBe(false);
	});

	it('isWeaponProficient: UNCONSTRAINED grants → always proficient', () => {
		expect(isWeaponProficient(UNCONSTRAINED, 'martial', 'greataxe')).toBe(true);
	});

	it('isArmorProficient: declared grant gate', () => {
		const g = new Set(['light', 'medium']);
		expect(isArmorProficient(g, 'light')).toBe(true);
		expect(isArmorProficient(g, 'heavy')).toBe(false);
		expect(isArmorProficient(g, 'shield')).toBe(false);
	});

	it('isArmorProficient: UNCONSTRAINED grants OR unclassifiable armor → never block (lenient)', () => {
		expect(isArmorProficient(UNCONSTRAINED, 'heavy')).toBe(true);
		expect(isArmorProficient(new Set(['light']), undefined)).toBe(true);
	});
});
