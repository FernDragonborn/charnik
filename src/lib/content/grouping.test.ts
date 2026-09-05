import { describe, it, expect } from 'vitest';
import { groupingsFor, facetFor, distinctValues, groupRows } from './grouping';
import { row } from './test-utils';

describe('groupingsFor', () => {
	it('appends Source + A–Z and never duplicates Source', () => {
		expect(groupingsFor('spell').map((g) => g.key)).toEqual(['level', 'school', 'source', 'none']);
		expect(groupingsFor('background').map((g) => g.key)).toEqual(['source', 'none']);
	});
});

describe('facetFor', () => {
	it('returns the primary facet or null', () => {
		expect(facetFor('spell')).toEqual({ key: 'school', labelKey: 'contentField.school' });
		expect(facetFor('language')).toBeNull();
	});
});

describe('distinctValues', () => {
	it('collects distinct non-empty values, numerically sorted', () => {
		const rows = [
			row({ school: 'evocation' }),
			row({ school: 'abjuration' }),
			row({ school: 'evocation' }),
			row({ school: '' }),
		];
		expect(distinctValues(rows, 'school')).toEqual(['abjuration', 'evocation']);
	});
});

/** A catalog that answers every key with it, so these assert WHICH sentence a bucket asks for
 *  rather than the English in it. */
const t = (key: string, o?: { values?: Record<string, string | number> }) =>
	`«${key.split('.').pop()}${o?.values ? `:${Object.values(o.values).join(',')}` : ''}»`;

describe('groupRows', () => {
	it('A–Z (key "none") is one bucket sorted by name', () => {
		const g = groupRows([row({ name_en: 'Bless' }), row({ name_en: 'Aid' })], 'none', 'spell', t);
		expect(g).toHaveLength(1);
		expect(g[0]!.rows.map((r) => r.data.name_en)).toEqual(['Aid', 'Bless']);
	});

	it('spell levels: Cantrips first, then ordinal labels in numeric order', () => {
		const g = groupRows(
			[
				row({ name_en: 'Fireball', level: '3' }),
				row({ name_en: 'Fire Bolt', level: '0' }),
				row({ name_en: 'Bless', level: '1' }),
			],
			'level',
			'spell',
			t,
		);
		expect(g.map((x) => x.label)).toEqual(['«cantrips»', '«group:1»', '«group:3»']);
	});

	it('monster CR sorts fractional before whole', () => {
		const g = groupRows(
			[
				row({ name_en: 'A', cr: '2' }, 'monster'),
				row({ name_en: 'B', cr: '1/4' }, 'monster'),
				row({ name_en: 'C', cr: '1/2' }, 'monster'),
			],
			'cr',
			'monster',
			t,
		);
		expect(g.map((x) => x.label)).toEqual(['«groupCR:1/4»', '«groupCR:1/2»', '«groupCR:2»']);
	});

	it('groups by source tag when key = source', () => {
		const g = groupRows(
			[row({ name_en: 'A' }, 'spell', 'Homebrew'), row({ name_en: 'B' }, 'spell', 'SRD 5.2.1')],
			'source',
			'spell',
			t,
		);
		expect(g.map((x) => x.rows.length)).toEqual([1, 1]);
	});
});
