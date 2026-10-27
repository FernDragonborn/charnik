/*
 * A CSV that does not parse whole is said, never silently half-loaded — and never written back.
 */
import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseCsvTable, DamagedCsvError } from './csv-table';
import { upsertHomebrewRow, homebrewFile } from './homebrew';
import { saveTranslation } from './translate';

const HEAD = 'id,systems,source,name_en,text_en';
const row = (id: string, text = 'x') => `${id},5e,SRD 5.1,${id},${text}`;

describe('a CSV that does not parse whole', () => {
	it('names an unclosed quote, extra cells and a repeated header', () => {
		expect(parseCsvTable([HEAD, row('a', '"open'), row('b')].join('\n')).damage[0]?.code).toBe(
			'MissingQuotes',
		);
		expect(parseCsvTable([HEAD, `${row('a')},extra`].join('\n')).damage[0]?.code).toBe(
			'TooManyFields',
		);
		expect(parseCsvTable(`id,name_en,name_en\na,A,B`).damage[0]?.code).toBe('DuplicateHeader');
		expect(parseCsvTable([HEAD, row('a')].join('\n')).damage).toEqual([]);
	});

	it('is a content-health error on load, beside the rows that did parse', async () => {
		const s = new MemoryStorage();
		await s.write('pack/effects_x.csv', [HEAD, row('a'), row('b', '"open'), row('c')].join('\n'));
		const graph = await loadContent(s, ['pack']);
		expect(graph.issues.some((i) => i.key === 'contentIssue.damagedCsv')).toBe(true);
		expect(graph.list('effect').map((r) => r.id)).toContain('a');
	});

	it('is never rewritten by a homebrew save or a translation', async () => {
		const s = new MemoryStorage();
		const file = homebrewFile('effect');
		const damaged = [HEAD, row('a', '"open'), row('b')].join('\n');
		await s.write(file, damaged);
		await expect(
			upsertHomebrewRow(s, 'effect', { id: 'a', name_en: 'A', systems: '5e' }, file),
		).rejects.toBeInstanceOf(DamagedCsvError);
		await s.write('pack/effects_x.csv', damaged);
		await expect(
			saveTranslation(s, { root: 'pack', file: 'effects_x.csv', id: 'a' }, 'uk', { name: 'А' }),
		).rejects.toBeInstanceOf(DamagedCsvError);
		expect(await s.read(file)).toBe(damaged);
		expect(await s.read('pack/effects_x.csv')).toBe(damaged);
	});
});

describe('a file that cannot be read', () => {
	it('is an issue on that file, and every other file still loads', async () => {
		class LockedFile extends MemoryStorage {
			override async read(path: string): Promise<string> {
				if (path.endsWith('locked.csv')) throw new Error('EBUSY: resource busy or locked');
				return super.read(path);
			}
		}
		const s = new LockedFile();
		await s.write('pack/effects_locked.csv', [HEAD, row('a')].join('\n'));
		await s.write('pack/effects_open.CSV', [HEAD, row('b')].join('\n'));
		const graph = await loadContent(s, ['pack']);
		expect(graph.issues.find((i) => i.key === 'contentIssue.unreadableFile')?.file).toBe(
			'effects_locked.csv',
		);
		expect(graph.list('effect').map((r) => r.id)).toEqual(['b']);
	});
});
