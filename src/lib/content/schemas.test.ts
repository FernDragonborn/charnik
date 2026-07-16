import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { CONTENT_TYPES, parseRow, type ContentType } from './schemas';
import { parseContentDirectives } from './meta';

describe('content schemas — unit', () => {
	it('accepts a well-formed species row and namespaced systems', () => {
		const r = parseRow('species', {
			id: 'elf',
			systems: '5e,5.5e',
			source: 'SRD',
			name_en: 'Elf',
			text_en: 'Graceful and long-lived.',
			size: 'medium',
			speed: '30',
			effects: ''
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.systems).toEqual(['5e', '5.5e']);
			expect(r.data.speed).toBe(30);
			expect(r.data.effects).toEqual([]);
		}
	});

	it('rejects a bad id slug', () => {
		const r = parseRow('species', {
			id: 'Half Elf',
			systems: '5e',
			source: 'SRD',
			name_en: 'Half-Elf',
			size: 'medium',
			speed: '30'
		});
		expect(r.success).toBe(false);
	});

	it('rejects an unknown system token', () => {
		const r = parseRow('feat', { id: 'alert', systems: '3.5e', source: 'SRD', name_en: 'Alert' });
		expect(r.success).toBe(false);
	});

	it('keeps an unknown effect token instead of rejecting the row (B12)', () => {
		// vocabulary growth must be additive: an unknown/future token (L2 guard, plugin:, reroll:)
		// is kept verbatim and degrades to an inert note downstream, never a killed row.
		const kept = parseRow('species', {
			id: 'x',
			systems: '5e',
			source: 'SRD',
			name_en: 'X',
			size: 'medium',
			speed: '30',
			effects: 'teleport:far; is_raging ? advantage:attack; plugin:hb:ward'
		});
		expect(kept.success).toBe(true);
		if (kept.success)
			expect(kept.data.effects).toEqual([
				'teleport:far',
				'is_raging ? advantage:attack',
				'plugin:hb:ward'
			]);

		const ok = parseRow('species', {
			id: 'dwarf',
			systems: '5e',
			source: 'SRD',
			name_en: 'Dwarf',
			size: 'medium',
			speed: '25',
			effects: 'flat_bonus:con+2; resist_immune:poison'
		});
		expect(ok.success).toBe(true);
		if (ok.success) expect(ok.data.effects.length).toBe(2);
	});

	it('coerces spell numerics and booleans', () => {
		const r = parseRow('spell', {
			id: 'fireball',
			systems: '5e,5.5e',
			source: 'SRD',
			name_en: 'Fireball',
			level: '3',
			school: 'evocation',
			casting_time: '1 action',
			range: '150 feet',
			components: 'V,S,M',
			duration: 'Instantaneous',
			concentration: 'false',
			ritual: 'no',
			resolution: 'save',
			save_ability: 'dex',
			damage: '8d6 fire'
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.level).toBe(3);
			expect(r.data.concentration).toBe(false);
			expect(r.data.resolution).toBe('save');
		}
	});
});

// The seeded SRD pack is the canonical fixture (docs/TESTING.md): every shipped row must
// validate against its schema. This gate keeps data and schema from drifting apart.
describe('seeded SRD packs validate', () => {
	// Both edition roots (SRD 5.2.1 = 5.5e, SRD 5.1 = 5e). Every shipped row must validate.
	const roots = ['content/srd-2024', 'content/srd-2014'];

	for (const root of roots) {
		for (const [type, def] of Object.entries(CONTENT_TYPES)) {
			const file = resolve(process.cwd(), root, `${def.filebase}_srd.csv`);
			it(`${root}/${def.filebase}: every row parses as ${type}`, () => {
				if (!existsSync(file)) {
					// a type may not exist in a given edition yet; skip
					return;
				}
				// strip the `#content-*:` directive header (the loader does this) before parsing rows
				const { body } = parseContentDirectives(readFileSync(file, 'utf8'));
				const parsed = Papa.parse<Record<string, string>>(body, {
					header: true,
					skipEmptyLines: true
				});
				expect(parsed.errors).toEqual([]);
				expect(parsed.data.length).toBeGreaterThan(0);
				const failures: string[] = [];
				for (const row of parsed.data) {
					const res = parseRow(type as ContentType, row);
					if (!res.success) {
						failures.push(
							`${row.id}: ${res.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`
						);
					}
				}
				expect(failures).toEqual([]);
			});
		}
	}
});
