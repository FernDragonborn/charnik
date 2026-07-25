import { describe, it, expect } from 'vitest';
import {
	themeToCss,
	buildThemesStylesheet,
	isSafeThemeId,
	type CustomTheme
} from './customThemes';

const theme = (over: Partial<CustomTheme> = {}): CustomTheme => ({
	id: 'ocean',
	name: 'Ocean',
	tokens: { 'color-accent': '#0af', 'color-bg': 'rgb(0 20 40)' },
	...over
});

describe('themeToCss', () => {
	it('emits a data-theme rule with the known tokens', () => {
		const css = themeToCss(theme());
		expect(css).toContain("[data-theme='ocean'] {");
		expect(css).toContain('--color-accent: #0af;');
		expect(css).toContain('--color-bg: rgb(0 20 40);');
	});

	it('strips a leading -- from token names', () => {
		expect(themeToCss(theme({ tokens: { '--color-text': '#fff' } }))).toContain(
			'--color-text: #fff;'
		);
	});

	it('drops tokens not in the themeable set', () => {
		const css = themeToCss(theme({ tokens: { 'color-accent': '#0af', 'font-size-md': '99px' } }));
		expect(css).toContain('--color-accent');
		expect(css).not.toContain('font-size-md');
	});

	it('accepts color-mix / var values', () => {
		const css = themeToCss(
			theme({ tokens: { 'color-good-line': 'color-mix(in srgb, var(--color-good) 40%, transparent)' } })
		);
		expect(css).toContain('color-mix(in srgb, var(--color-good) 40%, transparent)');
	});

	// --- injection safety (the security contract) ---
	it('drops a value that tries to close the block / inject a rule', () => {
		const css = themeToCss(
			theme({ tokens: { 'color-accent': 'red; } body { display:none' } })
		);
		expect(css).not.toContain('display:none');
		expect(css).not.toContain('color-accent'); // the whole unsafe decl is dropped
	});

	it('drops a value containing url() or comment markers', () => {
		expect(themeToCss(theme({ tokens: { 'color-bg': 'url(evil.png)' } }))).toBe('');
		expect(themeToCss(theme({ tokens: { 'color-bg': 'red /* x */ blue' } }))).toBe('');
	});

	it('rejects an unsafe or built-in id', () => {
		expect(themeToCss(theme({ id: "x'] body {color:red" }))).toBe('');
		expect(themeToCss(theme({ id: 'Dark' }))).toBe(''); // uppercase → invalid slug
		expect(isSafeThemeId('dark')).toBe(false);
		expect(isSafeThemeId('light')).toBe(false);
		expect(isSafeThemeId('my-theme-1')).toBe(true);
	});

	it('returns empty when nothing survives', () => {
		expect(themeToCss(theme({ tokens: { unknown: 'x' } }))).toBe('');
	});
});

describe('buildThemesStylesheet', () => {
	it('concatenates valid themes and lists their ids, skipping empty ones', () => {
		const { css, ids } = buildThemesStylesheet([
			theme({ id: 'ocean' }),
			theme({ id: 'bad id!', tokens: { 'color-bg': '#000' } }),
			theme({ id: 'sand', tokens: { 'color-accent': '#e8c' } })
		]);
		expect(ids).toEqual(['ocean', 'sand']);
		expect(css).toContain("[data-theme='ocean']");
		expect(css).toContain("[data-theme='sand']");
		expect(css).not.toContain('bad id');
	});
});
