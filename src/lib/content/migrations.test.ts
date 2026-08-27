import { describe, expect, it } from 'vitest';
import { CONTENT_SCHEMA_VERSION } from '$lib/schema/version';
import { CONTENT_MIGRATIONS, declaredSchema, migrateRows, type VersionedRows } from './migrations';

const rows = () => [{ id: 'fireball', name_en: 'Fireball' }];

describe('declaredSchema', () => {
	it('reads the header value', () => {
		expect(declaredSchema('0')).toBe(0);
	});

	/* An unstamped hand-authored CSV was written against TODAY's columns; calling it version 0 would
	   demand a migration for every homebrew file ever made by hand. */
	it('treats an absent or unreadable value as current', () => {
		expect(declaredSchema(undefined)).toBe(CONTENT_SCHEMA_VERSION);
		expect(declaredSchema('not a number')).toBe(CONTENT_SCHEMA_VERSION);
	});
});

describe('migrateRows', () => {
	it('passes rows through untouched at the current version', () => {
		const input = rows();
		expect(migrateRows('spell', input, CONTENT_SCHEMA_VERSION)).toEqual({ rows: input });
	});

	/* The reason this is wired up before any migration exists: a pack built by a newer app used to
	   load in silence and render whatever its columns happened to mean here. */
	it('reports a file from a NEWER build instead of loading it silently', () => {
		const result = migrateRows('spell', rows(), CONTENT_SCHEMA_VERSION + 1);
		expect(result.error).toMatch(/newer than supported/);
		expect(result.rows).toEqual(rows()); // still loaded — flagged, not dropped
	});

	/* One version counter covers every content TYPE, so a bump that reshaped items says nothing about
	   spells: no step at a version means that type did not change then, and its rows advance as they
	   are. (Contrast the CHARACTER chain — one shape, so there a missing step IS a gap and throws.) */
	it('advances a type with no step registered, untouched', () => {
		const result = migrateRows('spell', rows(), CONTENT_SCHEMA_VERSION - 1);
		expect(result.error).toBeUndefined();
		expect(result.rows).toEqual(rows());
	});

	it('runs a registered step', () => {
		const bump = (data: VersionedRows): VersionedRows => ({
			schemaVersion: data.schemaVersion + 1,
			rows: data.rows.map((r) => ({ ...r, migrated: 'yes' })),
		});
		CONTENT_MIGRATIONS.spell = { [CONTENT_SCHEMA_VERSION - 1]: bump };
		try {
			const result = migrateRows('spell', rows(), CONTENT_SCHEMA_VERSION - 1);
			expect(result.error).toBeUndefined();
			expect(result.rows[0]?.migrated).toBe('yes');
		} finally {
			delete CONTENT_MIGRATIONS.spell;
		}
	});
});
