import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { parseRow } from './schemas';
import { parseContentDirectives } from './meta';
import { parseToken } from '../effects/token-parser';

/*
 * Data gate for the shipped effects catalog (EFX-3): every row must validate against the effect
 * schema AND carry only tokens the engine actually parses — a curated catalog we author ourselves
 * has no excuse for unknown-token fallbacks. (Same pattern as the spell_slots data gate.)
 */
describe.each(['content/srd-2014/effects_srd.csv', 'content/srd-2024/effects_srd.csv'])(
	'shipped effects catalog · %s',
	(rel) => {
		const { body } = parseContentDirectives(readFileSync(resolve(process.cwd(), rel), 'utf8'));
		const rows = Papa.parse<Record<string, string>>(body, {
			header: true,
			skipEmptyLines: true
		}).data;

		it('ships a non-trivial catalog and every row validates', () => {
			expect(rows.length).toBeGreaterThanOrEqual(5);
			for (const raw of rows) {
				const res = parseRow('effect', raw);
				expect(res.success, `row ${raw.id}`).toBe(true);
			}
		});

		it('every token parses to a known vocabulary kind (no inert fallbacks in OUR data)', () => {
			for (const raw of rows) {
				const res = parseRow('effect', raw);
				if (!res.success) continue; // the other test reports this
				for (const tok of res.data.effects) {
					expect(parseToken(tok).kind, `${raw.id}: ${tok}`).not.toBe('unknown');
				}
			}
		});
	}
);
