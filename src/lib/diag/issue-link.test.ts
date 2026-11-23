import { describe, it, expect } from 'vitest';
import { issueLink, ISSUE_LINK_MAX } from './issue-link';
import type { DiagnosticsBundle } from './bundle';
import { LogLevel } from './logger';

const BASE = 'https://github.com/FernDragonborn/charnik/issues/new';
const words = { description: '', fallbackTitle: 'Bug report', shortenedNote: 'Log shortened' };

function bundleWith(lines: number, length = 40): DiagnosticsBundle {
	return {
		generatedAt: '2026-11-23T00:00:00.000Z',
		appVersion: '0.8.3',
		platform: 'desktop',
		activeSystem: '5.5e',
		activeLocale: 'uk',
		character: null,
		log: Array.from({ length: lines }, (_, i) => ({
			level: LogLevel.Info,
			time: '2026-11-23T00:00:00.000Z',
			msg: `line ${i} ${'x'.repeat(length)}`,
		})),
	};
}
const paramsOf = (url: string) => new URL(url).searchParams;

describe('a bug report opened already written', () => {
	it('carries the words and the diagnostics, titled by the first line', () => {
		const { url, shortened } = issueLink(
			BASE,
			{ ...words, description: 'Short rest did not give hit dice back\nsecond line' },
			bundleWith(3),
		);
		expect(shortened).toBe(false);
		expect(paramsOf(url).get('title')).toBe('Short rest did not give hit dice back');
		expect(paramsOf(url).get('body')).toMatch(/^Short rest[\s\S]*second line[\s\S]*line 2 /);
	});

	it('takes the fallback title when nothing was written', () => {
		expect(paramsOf(issueLink(BASE, words, bundleWith(1)).url).get('title')).toBe('Bug report');
	});

	it('lets the oldest log lines go until the link fits, and says so', () => {
		const { url, shortened } = issueLink(BASE, words, bundleWith(400, 120));
		expect(url.length).toBeLessThanOrEqual(ISSUE_LINK_MAX);
		expect(shortened).toBe(true);
		const body = paramsOf(url).get('body') ?? '';
		expect(body).toContain('_Log shortened_');
		expect(body).toContain('line 399 '); // the newest stays
		expect(body).not.toContain('line 0 ');
	});

	it('fits even when the words alone are too long', () => {
		const { url, shortened } = issueLink(
			BASE,
			{ ...words, description: 'y'.repeat(20000) },
			bundleWith(5),
		);
		expect(url.length).toBeLessThanOrEqual(ISSUE_LINK_MAX);
		expect(shortened).toBe(true);
		// what the player wrote is cut, never dropped: the clipboard does not hold it
		expect(paramsOf(url).get('body')).toMatch(/^y{100,}…/);
	});
});
