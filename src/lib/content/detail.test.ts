import { describe, it, expect } from 'vitest';
import { sourceLabel, editionLabel, buildDetail, entryMeta } from './detail';
import { row } from './test-utils';

describe('sourceLabel', () => {
	it('maps SRD tags to friendly D&D edition names, passes others through', () => {
		expect(sourceLabel('SRD 5.1')).toBe('D&D 5e');
		expect(sourceLabel('SRD 5.2.1')).toBe('D&D 5.5e');
		expect(sourceLabel('Homebrew')).toBe('Homebrew');
	});
});

describe('editionLabel', () => {
	it('joins a systems array (or scalar) with ·', () => {
		expect(editionLabel(['5e', '5.5e'])).toBe('5e · 5.5e');
		expect(editionLabel('5.5e')).toBe('5.5e');
		expect(editionLabel(null)).toBe('');
	});
});

describe('buildDetail', () => {
	it('spell: eyebrow is Cantrip / Level + school; carries a spell model + friendly source', () => {
		const cantrip = buildDetail(
			row({ name_en: 'Fire Bolt', level: '0', school: 'evocation' }),
			'spell',
		);
		expect(cantrip.eyebrow).toBe('Cantrip · Evocation');
		expect(cantrip.title).toBe('Fire Bolt');
		expect(cantrip.spell).toBeDefined();
		// the PACK is named beside the tag: a pack declares its own `#content-source`, so the tag
		// alone cannot say where a row came from
		expect(cantrip.source).toBe('Source: D&D 5.5e · test');

		const leveled = buildDetail(
			row({ name_en: 'Fireball', level: '3', school: 'evocation' }),
			'spell',
		);
		expect(leveled.eyebrow).toBe('Level 3 · Evocation');
	});

	it('generic type: eyebrow is the capitalized type and meta lists non-common fields', () => {
		const detail = buildDetail(row({ name_en: 'Alert', category: 'origin' }, 'feat'), 'feat');
		expect(detail.eyebrow).toBe('Feat');
		expect(detail.title).toBe('Alert');
		expect(detail.meta).toContainEqual(['Category', 'origin']);
	});

	it('locale-aware: prose reads <base>_<loc>, falls back to _en, then a bare column', () => {
		const d = {
			name_en: 'Fireball',
			name_uk: 'Вогняна куля',
			text_en: 'A bright streak…',
			text_uk: 'Яскравий промінь…',
			material: 'bat guano', // legacy bare column (no _en) → still shown
			higher_level: '+1d6 per slot',
			level: '3',
			school: 'evocation',
		};
		const uk = buildDetail(row(d), 'spell', undefined, 'uk');
		expect(uk.title).toBe('Вогняна куля');
		expect(uk.bodyHtml).toBe('Яскравий промінь…');
		expect(uk.spell?.material).toBe('bat guano'); // bare fallback when no _uk/_en

		const en = buildDetail(row(d), 'spell', undefined, 'en');
		expect(en.title).toBe('Fireball');

		// missing target locale → English fallback, never empty
		const de = buildDetail(row(d), 'spell', undefined, 'de');
		expect(de.title).toBe('Fireball');
	});

	it('locale-aware generic: localized prose columns never leak into the meta grid', () => {
		const detail = buildDetail(
			row({ name_en: 'Alert', name_uk: 'Пильність', text_uk: 'опис', category: 'origin' }, 'feat'),
			'feat',
			undefined,
			'uk',
		);
		expect(detail.title).toBe('Пильність');
		expect(detail.meta.map(([k]) => k)).not.toContain('Name Uk');
		expect(detail.meta.map(([k]) => k)).not.toContain('Text Uk');
	});
});

describe('entryMeta', () => {
	/** A catalog that answers every key, so a test asserts the SHAPE of the line rather than the
	 *  English in it — and a second one below proves the fallback when a key is missing. */
	const t = (key: string, o?: { values?: Record<string, string | number>; default?: string }) =>
		`«${key.split('.').pop()}${o?.values ? `:${Object.values(o.values).join(',')}` : ''}»`;

	it('spell sub-line = school · damage, both through the catalog', () => {
		expect(entryMeta(row({ school: 'evocation', damage: '8d6' }), t)).toBe('«evocation» · 8d6');
	});

	it('a spell that is cast, concentrated on, or ritual says so in the reader s language', () => {
		// the ability inside the save line goes through the catalog too — the nesting IS the assertion
		expect(
			entryMeta(row({ school: 'abjuration', resolution: 'save', save_ability: 'dex' }), t),
		).toBe('«abjuration» · «save:«dex»»');
		expect(entryMeta(row({ school: 'abjuration', concentration: true, ritual: true }), t)).toBe(
			'«abjuration» · «concentration» · «ritual»',
		);
	});

	/* Since ITEM-TAGS the kind IS the category, so there is no broader/narrower pair left to dedupe —
	   what an item is comes from `category`, and how magical it is from `rarity`. */
	it('item sub-line = category · rarity', () => {
		expect(entryMeta(row({ category: 'gear' }, 'item'), t)).toBe('«gear»');
		expect(entryMeta(row({ category: 'ring', rarity: 'rare' }, 'item'), t)).toBe('«ring» · «rare»');
	});

	it('a value the catalog has no word for reads as its own name, not as a missing key', () => {
		// these columns are OPEN enums: a homebrew pack's ninth school is content, not a bug
		const fallback = (_key: string, o?: { default?: string }) => o?.default ?? '';
		expect(entryMeta(row({ school: 'chronomancy' }), fallback)).toBe('Chronomancy');
	});
});
