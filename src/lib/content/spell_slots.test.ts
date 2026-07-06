import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { fullCasterSlots } from '../rules/core';
import { parseContentDirectives } from './meta';

/*
 * Data gate: the shipped `full` spell-slot table (generated from the SRD class tables by
 * tools/srd/convert-slots.mjs) must agree with the trusted `FULL_CASTER_SLOTS` in rules/core.
 * Two independent encodings of the same SRD fact — if they ever drift, one is wrong.
 */
const file = resolve(process.cwd(), 'content/srd-2024/spell_slots_srd.csv');

describe('shipped spell_slots table', () => {
	it('the full-caster rows match core.fullCasterSlots for every level', () => {
		expect(existsSync(file)).toBe(true);
		const { body } = parseContentDirectives(readFileSync(file, 'utf8'));
		const rows = Papa.parse<Record<string, string>>(body, {
			header: true,
			skipEmptyLines: true
		}).data;
		const full = rows.filter((r) => r.kind === 'full');
		expect(full.length).toBe(20);
		for (const r of full) {
			const level = Number(r.level);
			const cells = Array.from({ length: 9 }, (_, i) => Number(r[`slot_${i + 1}`]));
			// trim trailing zeros → the shape core returns
			let end = cells.length;
			while (end > 0 && cells[end - 1] === 0) end--;
			expect(cells.slice(0, end)).toEqual(fullCasterSlots(level));
		}
	});
});
