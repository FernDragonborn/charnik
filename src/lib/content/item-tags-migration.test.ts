/*
 * The v1→v2 item migration, row by row, and the one thing the shipped CSVs owe it: a declared
 * version past the step, so it never runs on them. A user's own v1 file is what it is for.
 */
import { describe, it, expect } from 'vitest';
import { migrateRows, CONTENT_MIGRATIONS } from './migrations';
import { CONTENT_SCHEMA_VERSION } from '../schema/version';
import { hasContentRepo, readPackFile } from '../../test-support/real-content';

const V1_ITEM_COLUMNS = [
	'item_type',
	'properties',
	'range',
	'ac',
	'armor_dex_cap',
	'str_min',
	'stealth_disadvantage',
	'attunement',
];

const migrateOne = (row: Record<string, string>): Record<string, string> => {
	const { rows } = migrateRows('item', [row], 1);
	return rows[0] ?? {};
};

describe('item v1 → v2 migration', () => {
	it('folds a weapon: category words, properties, mastery — and drops the old columns', () => {
		const out = migrateOne({
			id: 'dagger',
			category: 'weapon',
			item_type: 'simple melee',
			properties: 'Finesse, Light, Thrown (Range 20/60); mastery: Nick',
			range: '20/60',
			damage: '1d4 piercing',
		});
		expect(out.tags).toBe('simple, melee, finesse, light, thrown:20/60, mastery:nick');
		expect(out.damage).toBe('1d4 piercing');
		for (const column of V1_ITEM_COLUMNS) expect(out).not.toHaveProperty(column);
	});

	it('keeps a parenthetical that carries the separator in ONE property', () => {
		const out = migrateOne({
			id: 'crossbow_heavy',
			category: 'weapon',
			item_type: 'martial ranged',
			properties: 'Ammunition (Range 100/400, Bolt), Heavy, Loading, Two-Handed',
		});
		// "Bolt)" used to become a scope of its own — the split ran at every comma
		expect(out.tags).toBe(
			'martial, ranged, ammunition:100/400, ammo:bolt, heavy, loading, two_handed',
		);
	});

	it('a parenthetical that is prose keeps only the word', () => {
		const out = migrateOne({
			id: 'lance',
			category: 'weapon',
			item_type: 'martial melee',
			properties: 'Reach, Two-Handed (unless mounted)',
		});
		expect(out.tags).toBe('martial, melee, reach, two_handed');
	});

	it('folds armour, and reads the weight class only off an armour row', () => {
		const plate = migrateOne({
			id: 'plate',
			category: 'armor',
			item_type: 'heavy armor',
			ac: '18',
			armor_dex_cap: '0',
			str_min: '15',
			stealth_disadvantage: 'true',
		});
		expect(plate.tags).toBe('armor:heavy, ac:18, dex_cap:0, str_min:15, stealth_disadvantage');
		// a LIGHT hammer must not come out of this wearing light armour
		const hammer = migrateOne({
			id: 'light_hammer',
			category: 'weapon',
			item_type: 'simple melee',
			properties: 'Light, Thrown (Range 20/60)',
		});
		expect(hammer.tags).not.toContain('armor:');
	});

	it('a magic-item kind becomes the category it always was', () => {
		expect(migrateOne({ id: 'p', category: 'gear', item_type: 'potion' }).category).toBe('potion');
		expect(migrateOne({ id: 'w', category: 'gear', item_type: 'wondrous item' }).category).toBe(
			'wondrous',
		);
		// plain gear keeps saying gear — "adventuring gear" was `category` repeating itself
		expect(migrateOne({ id: 'r', category: 'gear', item_type: 'adventuring gear' }).category).toBe(
			'gear',
		);
	});

	it('drops the prose a magic item qualified its base with, and keeps attunement', () => {
		const out = migrateOne({
			id: 'sword_of_sharpness',
			category: 'weapon',
			item_type: 'weapon (any sword that deals slashing damage)',
			attunement: 'true',
		});
		expect(out.tags).toBe('attunement');
	});

	it('a type absent from the registry advances untouched', () => {
		const { rows, error } = migrateRows('spell', [{ id: 'fireball', level: '3' }], 1);
		expect(error).toBeUndefined();
		expect(rows[0]).toEqual({ id: 'fireball', level: '3' });
	});
});

describe.runIf(hasContentRepo)('the shipped items files', () => {
	/* The shipped files are already PAST the item step, so the migration never re-runs on them — which
	   is the property worth pinning, not equality with the global counter. That counter covers every
	   type at once (`migrations.ts`), so a bump made for another type would otherwise fail here and
	   demand a pointless re-stamp of a file nothing changed in. */
	it('declare a version at or past the last item step', () => {
		const lastItemStep = Math.max(...Object.keys(CONTENT_MIGRATIONS.item ?? {}).map(Number));
		for (const pack of ['srd-2014', 'srd-2024']) {
			const declared = /#content-schema:\s*(\d+)/.exec(readPackFile(pack, 'items_srd.csv'))?.[1];
			expect(Number(declared), pack).toBeGreaterThan(lastItemStep);
			expect(Number(declared), pack).toBeLessThanOrEqual(CONTENT_SCHEMA_VERSION);
		}
	});
});
