import { describe, it, expect } from 'vitest';
import { externalLinkToOpen, shouldCancelNavigation } from './links';

const APP = 'http://localhost:5173';

/* Content prose is rendered HTML from CSVs a stranger may have written, and the desktop window has
   no address bar to notice a navigation with. So: nothing cross-origin may load in it, and only the
   schemes the opener capability takes are handed to the OS. */
describe('links that leave the app', () => {
	it('sends a remote http(s) link to the OS browser', () => {
		expect(externalLinkToOpen('https://example.com/x', APP)).toBe('https://example.com/x');
		expect(externalLinkToOpen('http://example.com/x', APP)).toBe('http://example.com/x');
	});

	it('leaves in-app navigation alone — that is the router, not a link out', () => {
		expect(externalLinkToOpen(`${APP}/compendium/spell`, APP)).toBeNull();
		expect(shouldCancelNavigation(`${APP}/compendium/spell`, APP)).toBe(false);
	});

	it('refuses to OPEN a scheme the capability does not allow', () => {
		for (const href of ['file:///C:/Windows/system.ini', 'weird-scheme://do/it'])
			expect(externalLinkToOpen(href, APP)).toBeNull();
	});

	it('…but still cancels its navigation — refusing to open it is not refusing to load it', () => {
		expect(shouldCancelNavigation('file:///C:/Windows/system.ini', APP)).toBe(true);
		expect(shouldCancelNavigation('weird-scheme://do/it', APP)).toBe(true);
	});

	it('ignores a href that is not a URL at all', () => {
		expect(externalLinkToOpen('', APP)).toBeNull();
		expect(shouldCancelNavigation('not a url', APP)).toBe(false);
	});
});
