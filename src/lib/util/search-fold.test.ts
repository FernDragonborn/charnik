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
});
