/*
 * The prose seam. Content is user-owned CSV, so it may carry Markdown AND raw HTML AND an injection
 * attempt in the same cell — these assert that emphasis survives and script does not, on both the
 * block renderer (article body) and the inline one (a spell's "at higher levels" / material line).
 */
import { describe, it, expect } from 'vitest';
import { renderContentMarkdown, renderContentMarkdownInline } from './markdown';

describe('renderContentMarkdown', () => {
	it('renders both emphasis spellings', () => {
		expect(renderContentMarkdown('_Magic Missile_')).toContain('<em>Magic Missile</em>');
		expect(renderContentMarkdown('*Magic Missile*')).toContain('<em>Magic Missile</em>');
		expect(renderContentMarkdown('**Ghouls**')).toContain('<strong>Ghouls</strong>');
	});

	it('leaves an underscore inside a word alone', () => {
		expect(renderContentMarkdown('hit_die and spell_slot')).toContain('hit_die and spell_slot');
	});

	it('strips anything executable', () => {
		const html = renderContentMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>ok');
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('<script');
	});
});

describe('renderContentMarkdownInline', () => {
	// The bug this exists for: both of these cells were interpolated as plain text, so every spell
	// that used emphasis outside its body printed the syntax verbatim.
	it('renders emphasis that used to show literally', () => {
		expect(renderContentMarkdownInline('animate four **Ghouls**')).toContain(
			'<strong>Ghouls</strong>',
		);
		expect(renderContentMarkdownInline('as _Magic Missile_')).toContain('<em>Magic Missile</em>');
	});

	it('stays inline — a one-line callout gets no block wrapper', () => {
		expect(renderContentMarkdownInline('a pinch of salt')).toBe('a pinch of salt');
	});

	it('strips anything executable', () => {
		expect(renderContentMarkdownInline('<a href="javascript:alert(1)">x</a>')).not.toContain(
			'javascript:',
		);
	});
});
