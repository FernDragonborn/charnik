import { describe, it, expect } from 'vitest';
import { sourceLabel, editionLabel, buildDetail, entryMeta } from './detail';
import type { LoadedRow } from './loader';
import type { ContentType } from './schemas';

const row = (data: Record<string, unknown>, type: ContentType = 'spell', source = 'SRD 5.2.1') =>
	({ type, source, id: String(data.id ?? data.name_en ?? ''), data }) as unknown as LoadedRow;

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
			'spell'
		);
		expect(cantrip.eyebrow).toBe('Cantrip · Evocation');
		expect(cantrip.title).toBe('Fire Bolt');
		expect(cantrip.spell).toBeDefined();
		expect(cantrip.source).toBe('Source: D&D 5.5e');

		const leveled = buildDetail(
			row({ name_en: 'Fireball', level: '3', school: 'evocation' }),
			'spell'
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
			school: 'evocation'
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
			'uk'
		);
		expect(detail.title).toBe('Пильність');
		expect(detail.meta.map(([k]) => k)).not.toContain('Name Uk');
		expect(detail.meta.map(([k]) => k)).not.toContain('Text Uk');
	});
});

describe('entryMeta', () => {
	it('spell sub-line = school · damage', () => {
		expect(entryMeta(row({ school: 'evocation', damage: '8d6' }), 'spell')).toBe('evocation · 8d6');
	});

	it('item sub-line drops a broader term already implied by a more specific one', () => {
		expect(
			entryMeta(row({ category: 'gear', item_type: 'adventuring gear' }, 'item'), 'item')
		).toBe('adventuring gear');
	});
});
