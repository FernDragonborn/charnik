import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import {
	fieldsFor,
	buildRow,
	saveHomebrewRow,
	toCsv,
	columnsFor,
	slugify,
	homebrewFile,
	HOMEBREW_ROOT
} from './homebrew';

describe('homebrew — field descriptors', () => {
	it('lists a type’s editable fields in schema order, with input kinds', () => {
		const f = fieldsFor('item');
		const byName = Object.fromEntries(f.map((x) => [x.name, x]));
		expect(byName.source).toBeUndefined(); // source is fixed to Homebrew, not a form field
		expect(byName.name_en.required).toBe(true);
		expect(byName.systems.kind).toBe('systems');
		expect(byName.category.kind).toBe('enum');
		expect(byName.category.options).toContain('weapon');
		expect(byName.weight_lb.kind).toBe('number');
		expect(byName.attunement.kind).toBe('bool');
		expect(byName.text_en.kind).toBe('textarea');
	});

	it('disambiguates feat.category (enum) from item text columns', () => {
		const feat = Object.fromEntries(fieldsFor('feat').map((x) => [x.name, x]));
		expect(feat.category.kind).toBe('enum');
		expect(feat.category.options).toContain('origin');
	});
});

describe('homebrew — buildRow', () => {
	it('auto-slugs a missing id from the name and fixes the source', () => {
		const r = buildRow('item', { name_en: 'My Cool Sword', systems: '5.5e', category: 'weapon' });
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.row.id).toBe('my-cool-sword');
			expect(r.row.source).toBe('Homebrew');
		}
	});

	it('de-duplicates the id against rows already in the file', () => {
		const r = buildRow(
			'item',
			{ name_en: 'Sword', systems: '5.5e', category: 'weapon' },
			new Set(['sword'])
		);
		expect(r.ok && r.row.id).toBe('sword-2');
	});

	it('reports validation issues instead of throwing', () => {
		const r = buildRow('item', { name_en: 'X', systems: '3.5e', category: 'weapon' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.issues.join(' ')).toMatch(/systems/);
	});

	it('slugify + homebrewFile behave', () => {
		expect(slugify('Bag of  Holding!!')).toBe('bag-of-holding');
		expect(homebrewFile('item')).toBe(`${HOMEBREW_ROOT}/items_hb.csv`);
	});
});

describe('homebrew — round-trips through the loader', () => {
	it('a saved row loads back as content in the graph', async () => {
		const s = new MemoryStorage();
		const first = await saveHomebrewRow(s, 'item', {
			name_en: 'Sunblade',
			systems: '5.5e',
			category: 'weapon',
			damage: '1d8',
			text_en: 'A radiant blade.'
		});
		expect(first).toEqual({ ok: true, id: 'sunblade' });

		// a second item with the same name lands beside the first with a unique id (no data loss)
		const second = await saveHomebrewRow(s, 'item', {
			name_en: 'Sunblade',
			systems: '5.5e',
			category: 'weapon'
		});
		expect(second.id).toBe('sunblade-2');

		const g = await loadContent(s, [], [{ storage: s, root: HOMEBREW_ROOT }]);
		expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
		const row = g.get('item:Homebrew:sunblade');
		expect(row?.data.name_en).toBe('Sunblade');
		expect(row?.data.category).toBe('weapon');
		expect(g.list('item').length).toBe(2);
	});

	it('emits a UTF-8 BOM + CRLF CSV', () => {
		const csv = toCsv(columnsFor('condition'), [
			{ id: 'x', systems: '5.5e', source: 'Homebrew', name_en: 'Dazed', negative: 'true' }
		]);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv).toContain('\r\n');
	});
});
