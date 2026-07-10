import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { MemoryStorage } from '../storage/memory';
import {
	isShippedFile,
	listTypeTargets,
	rowToDraft,
	upsertHomebrewRow,
	removeHomebrewRow,
	homebrewFile,
	HOMEBREW_SOURCE
} from './homebrew';
import { makeRow } from './test-utils';
import { parseContentDirectives, checkFileMeta } from './meta';

const readRows = async (s: MemoryStorage, file: string) => {
	const { body } = parseContentDirectives(await s.read(file));
	return Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true }).data;
};

describe('homebrew save targets', () => {
	const shipped = ['content/srd-2024', 'content/srd-2014'];

	it('isShippedFile flags files under a shipped root (extensible via the roots list)', () => {
		expect(isShippedFile('content/srd-2024/spells_srd.csv', shipped)).toBe(true);
		expect(isShippedFile('content/homebrew/spells_hb.csv', shipped)).toBe(false);
		expect(isShippedFile('content/mypack/spells.csv', shipped)).toBe(false);
		// a future shipped pack: add its root → flagged automatically
		expect(isShippedFile('content/phb/spells.csv', [...shipped, 'content/phb'])).toBe(true);
	});

	it('lists type files across shipped + homebrew roots, marking shipped ones', async () => {
		const s = new MemoryStorage();
		await s.write('content/srd-2024/spells_srd.csv', 'id\nfireball');
		await s.write('content/homebrew/spells_hb.csv', 'id\nmagic-dart');
		await s.write('content/srd-2024/monsters_srd.csv', 'id\ngoblin'); // other type → excluded
		const t = await listTypeTargets(s, 'spell', shipped);
		expect(t.map((x) => x.file).sort()).toEqual([
			'content/homebrew/spells_hb.csv',
			'content/srd-2024/spells_srd.csv'
		]);
		expect(t.find((x) => x.file.includes('srd'))?.shipped).toBe(true);
		expect(t.find((x) => x.file.includes('homebrew'))?.shipped).toBe(false);
	});
});

describe('editor-mode upsert (fork-to-homebrew / edit-in-place)', () => {
	const file = homebrewFile('condition');

	it('rowToDraft flattens a row to cells (systems joined, source dropped, id kept)', () => {
		const row = makeRow('condition', { id: 'dazed', name_en: 'Dazed', text_en: 'x' }, 'SRD 5.1');
		const d = rowToDraft(row);
		expect(d.id).toBe('dazed');
		expect(d.name_en).toBe('Dazed');
		expect(d.source ?? '').toBe(''); // the row's SRD source is NOT carried (upsert forces Homebrew)
	});

	it('edits in place — a second upsert REPLACES the same-id row (no duplicate)', async () => {
		const s = new MemoryStorage();
		await upsertHomebrewRow(
			s,
			'condition',
			{ id: 'dazed', name_en: 'Dazed', systems: '5e', text_en: 'v1' },
			file
		);
		await upsertHomebrewRow(
			s,
			'condition',
			{ id: 'dazed', name_en: 'Dazed', systems: '5e', text_en: 'v2' },
			file
		);
		const rows = await readRows(s, file);
		expect(rows.length).toBe(1);
		expect(rows[0]?.text_en).toBe('v2');
	});

	it('forks a shipped row into homebrew: same id, source forced to Homebrew', async () => {
		const s = new MemoryStorage();
		const shipped = makeRow(
			'condition',
			{ id: 'blinded', name_en: 'Blinded', text_en: 'orig' },
			'SRD 5.1'
		);
		const draft = rowToDraft(shipped);
		draft.systems = '5e';
		draft.text_en = 'my house rule';
		const res = await upsertHomebrewRow(s, 'condition', draft, file);
		expect(res.ok).toBe(true);
		const rows = await readRows(s, file);
		expect(rows[0]?.id).toBe('blinded');
		expect(rows[0]?.source).toBe(HOMEBREW_SOURCE);
		expect(rows[0]?.text_en).toBe('my house rule');
	});

	it('preserves columns beyond the schema (localized prose) instead of dropping them', async () => {
		const s = new MemoryStorage();
		const row = makeRow(
			'condition',
			{ id: 'x', name_en: 'X', text_en: 'e', name_uk: 'Ікс', text_uk: 'опис' },
			'SRD 5.1'
		);
		const draft = rowToDraft(row);
		draft.systems = '5e';
		await upsertHomebrewRow(s, 'condition', draft, file);
		const rows = await readRows(s, file);
		expect(rows[0]?.name_uk).toBe('Ікс');
		expect(rows[0]?.text_uk).toBe('опис');
	});

	it('removes a row by id (rewriting the file), and deletes the file when its last row goes', async () => {
		const s = new MemoryStorage();
		await upsertHomebrewRow(s, 'condition', { id: 'a', name_en: 'A', systems: '5e' }, file);
		await upsertHomebrewRow(s, 'condition', { id: 'b', name_en: 'B', systems: '5e' }, file);
		await removeHomebrewRow(s, 'condition', file, 'a');
		expect((await readRows(s, file)).map((r) => r.id)).toEqual(['b']);
		await removeHomebrewRow(s, 'condition', file, 'b'); // last row → file removed
		expect(await s.exists(file)).toBe(false);
	});

	it('stamps a #content header (source+license) so the metadata-check pop-up never nags', async () => {
		const s = new MemoryStorage();
		await upsertHomebrewRow(s, 'condition', { id: 'x', name_en: 'X', systems: '5e' }, file);
		const { directives } = parseContentDirectives(await s.read(file));
		expect(directives.get('source')).toBe(HOMEBREW_SOURCE);
		expect(directives.get('license')).toBeTruthy();
		expect(checkFileMeta(file, directives)).toBeNull(); // required human keys present → no modal
	});
});
