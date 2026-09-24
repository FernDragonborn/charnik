/*
 * The v1→v2 item migration, checked against the shipped CSVs it was written for.
 *
 * The point of the file-level assertions: the SHIPPED `tags` were built from the SRD tables directly,
 * while the MIGRATION builds them from the v1 columns. Two paths, one result — so running the
 * migration over the v1 file in git history must reproduce the v2 file on disk. It is what catches a
 * migration that has drifted from the data it is supposed to land on, and it keeps working however
 * the pack is produced, because it reads the pack rather than whatever wrote it.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import Papa from 'papaparse';
import { migrateRows, CONTENT_MIGRATIONS } from './migrations';
import { CONTENT_SCHEMA_VERSION } from '../schema/version';
import { contentRepoDir } from '../../../tools/content-repo.mjs';
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

const parseCsv = (raw: string): Papa.ParseResult<Record<string, string>> =>
	Papa.parse<Record<string, string>>(
		raw
			.replace(/^\uFEFF/, '')
			.split(/\r?\n/)
			.filter((l) => !l.startsWith('#'))
			.join('\n'),
		{ header: true, skipEmptyLines: true },
	);

/** The v1 items file as it was committed, straight out of the content repo's git history. Undefined
 *  once that commit is no longer HEAD — the comparison has served its purpose by then. */
function itemsAtV1(pack: string): Record<string, string>[] | undefined {
	try {
		const raw = execFileSync('git', ['show', `HEAD:${pack}/items_srd.csv`], {
			cwd: contentRepoDir() ?? '.',
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
		});
		const parsed = parseCsv(raw);
		return parsed.meta.fields?.includes('item_type') ? parsed.data : undefined;
	} catch {
		return undefined; // no git, or a shallow checkout
	}
}

describe.runIf(hasContentRepo)('the converters and the migration agree', () => {
	for (const pack of ['srd-2014', 'srd-2024']) {
		it(`${pack}: migrating the committed v1 items reproduces what the converter wrote`, () => {
			const v1 = itemsAtV1(pack);
			if (!v1) return;
			const shipped = parseCsv(readPackFile(pack, 'items_srd.csv')).data;
			const migrated = migrateRows('item', v1, 1).rows;
			expect(migrated).toHaveLength(shipped.length);
			const byId = new Map(shipped.map((r) => [r.id ?? '', r]));
			for (const row of migrated) {
				const converted = byId.get(row.id ?? '');
				expect(converted, `${pack}: ${row.id} is missing from the converted file`).toBeDefined();
				// `base_item_id` is the one column the migration cannot produce: it comes from the prose
				// the migration drops, which only the converter still has in front of it.
				expect({ tags: row.tags, category: row.category }, `${pack}: ${row.id}`).toEqual({
					tags: converted?.tags,
					category: converted?.category,
				});
			}
		});
	}

	/* The shipped files are already PAST the item step, so the migration never re-runs on them — which
	   is the property worth pinning, not equality with the global counter. That counter covers every
	   type at once (`migrations.ts`), so a bump made for another type would otherwise fail here and
	   demand a pointless re-stamp of a file nothing changed in. */
	it('the shipped items files declare a version at or past the last item step', () => {
		const lastItemStep = Math.max(...Object.keys(CONTENT_MIGRATIONS.item ?? {}).map(Number));
		for (const pack of ['srd-2014', 'srd-2024']) {
			const declared = /#content-schema:\s*(\d+)/.exec(readPackFile(pack, 'items_srd.csv'))?.[1];
			expect(Number(declared), pack).toBeGreaterThan(lastItemStep);
			expect(Number(declared), pack).toBeLessThanOrEqual(CONTENT_SCHEMA_VERSION);
		}
	});
});
