import { describe, it, expect } from 'vitest';
import {
	gatherProfGrants,
	weaponCategoryOf,
	armorCategoryOf,
	isWeaponProficient,
	isArmorProficient
} from './proficiency';

describe('proficiency model (pure)', () => {
	it('gatherProfGrants: unions declared class grants', () => {
		const g = gatherProfGrants(['simple,martial', 'light,heavy']);
		expect(g).not.toBeNull();
		expect([...g!].sort()).toEqual(['heavy', 'light', 'martial', 'simple']);
	});

	it('gatherProfGrants: any undeclared (blank) class → null = unconstrained (lenient)', () => {
		expect(gatherProfGrants(['simple', undefined])).toBeNull();
		expect(gatherProfGrants(['simple', ''])).toBeNull();
	});

	it('gatherProfGrants: no classes at all → null (lenient, never wrong-downward)', () => {
		expect(gatherProfGrants([])).toBeNull();
	});

	it('weaponCategoryOf normalizes item_type', () => {
		expect(weaponCategoryOf('martial melee')).toBe('martial');
		expect(weaponCategoryOf('simple ranged')).toBe('simple');
		expect(weaponCategoryOf('')).toBeUndefined();
	});

	it('armorCategoryOf: shield category wins; else read weight from item_type', () => {
		expect(armorCategoryOf('', 'shield')).toBe('shield');
		expect(armorCategoryOf('heavy armor', 'armor')).toBe('heavy');
		expect(armorCategoryOf('light armor', 'armor')).toBe('light');
		expect(armorCategoryOf('mystery', 'armor')).toBeUndefined();
	});

	it('isWeaponProficient: category grant OR specific weapon id', () => {
		const g = new Set(['simple', 'longsword']);
		expect(isWeaponProficient(g, 'simple melee', 'club')).toBe(true); // category
		expect(isWeaponProficient(g, 'martial melee', 'longsword')).toBe(true); // specific id
		expect(isWeaponProficient(g, 'martial melee', 'greataxe')).toBe(false);
	});

	it('isWeaponProficient: null grants (unconstrained) → always proficient', () => {
		expect(isWeaponProficient(null, 'martial melee', 'greataxe')).toBe(true);
	});

	it('isArmorProficient: declared grant gate', () => {
		const g = new Set(['light', 'medium']);
		expect(isArmorProficient(g, 'light armor', 'armor')).toBe(true);
		expect(isArmorProficient(g, 'heavy armor', 'armor')).toBe(false);
		expect(isArmorProficient(g, '', 'shield')).toBe(false);
	});

	it('isArmorProficient: null grants OR unclassifiable armor → never block (lenient)', () => {
		expect(isArmorProficient(null, 'heavy armor', 'armor')).toBe(true);
		expect(isArmorProficient(new Set(['light']), 'mystery', 'armor')).toBe(true);
	});
});
