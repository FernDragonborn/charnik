import { describe, it, expect } from 'vitest';
import { byCloseness, closeness, draftFields } from './orphan-view';

describe('what the orphan dialog shows of a draft', () => {
	it('lists the readable fields in the draft’s own order, leaving out identity, prose and empties', () => {
		const fields = draftFields({
			id: 'fire-lance',
			name_en: 'Fire Lance',
			level: 2,
			school: 'evocation',
			text_en: 'You hurl…',
			effects: ['flat_bonus:attack+1'],
			range: '',
			classes: ['sorcerer', 'wizard'],
		});
		expect(fields).toEqual([
			{ column: 'level', value: '2' },
			{ column: 'school', value: 'evocation' },
			{ column: 'classes', value: 'sorcerer, wizard' },
		]);
	});

	it('stops at eight fields, enough to recognise an entry at a glance', () => {
		const data = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, i + 1]));
		expect(draftFields(data)).toHaveLength(8);
	});

	it('counts the words a candidate shares with the old id and the draft’s name', () => {
		expect(closeness(['fire-lance', 'Fire Lance'], ['fire-bolt', 'Fire Bolt'])).toBe(1);
		expect(closeness(['fire-lance'], ['shield', 'Shield'])).toBe(0);
	});

	it('puts the closest first and names it only when it shares anything at all', () => {
		const rows = [
			{ id: 'shield', name: 'Shield' },
			{ id: 'fire-bolt', name: 'Fire Bolt' },
			{ id: 'fireball', name: 'Fireball' },
		];
		const ranked = byCloseness(rows, ['fire-lance', 'Fire Lance'], (r) => [r.id, r.name]);
		expect(ranked.rows.map((r) => r.id)).toEqual(['fire-bolt', 'shield', 'fireball']);
		expect(ranked.closest?.id).toBe('fire-bolt');

		const none = byCloseness(rows, ['frost-ray'], (r) => [r.id, r.name]);
		expect(none.rows.map((r) => r.id)).toEqual(['shield', 'fire-bolt', 'fireball']);
		expect(none.closest).toBeNull();
	});
});
