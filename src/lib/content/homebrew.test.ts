import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { isShippedFile, listTypeTargets } from './homebrew';

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
