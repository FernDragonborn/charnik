import { describe, expect, it } from 'vitest';
import { foldForSearch } from './search-fold';

describe('foldForSearch', () => {
	it('reads every apostrophe-like mark as the ASCII apostrophe', () => {
		for (const mark of ['`', '´', 'ʹ', 'ʻ', 'ʼ', 'ʽ', 'ˈ', '‘', '’', '‛', '′', '＇', 'ꞌ'])
			expect(foldForSearch(`М${mark}ята`)).toBe("м'ята");
	});
	it('keeps the length, so a match index maps back onto the original', () => {
		const text = 'Tasha’s Hideous Laughter';
		expect(foldForSearch(text)).toHaveLength(text.length);
	});

	/* audit-oct-27 U8: `İ` lower-cases to two characters, and every highlight after it drifted */
	it('keeps the length across a letter that lower-cases to two', () => {
		const text = 'İstanbul Ward';
		const folded = foldForSearch(text);
		expect(folded).toHaveLength(text.length);
		expect(text.slice(folded.indexOf('ward'), folded.indexOf('ward') + 4)).toBe('Ward');
		expect(folded.startsWith('istanbul')).toBe(true);
	});
});
