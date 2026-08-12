/*
 * Which links leave the app — the POLICY half of the layout's click handler, kept pure so it can be
 * tested without a DOM.
 *
 * It exists because content prose is rendered HTML authored by whoever wrote the CSV (DOMPurify
 * strips anything executable and correctly keeps `<a href>`), so "where does this link go" is a
 * security question and not a formatting one: inside the desktop app there is no address bar and no
 * back button, so a link that navigates the window replaces the app with a stranger's page and says
 * nothing about it.
 */

/** Schemes the `opener` capability actually allows us to hand to the OS. Anything else — `file:`,
 *  a custom protocol, whatever a hostile pack invents — is neither navigated nor opened. */
const OPENABLE = new Set(['https:', 'http:']);

/**
 * What to do with a click on `href` from a page served at `origin`:
 * - a URL string → open it in the OS browser (and cancel the navigation);
 * - `null` → not ours to intercept, let it behave normally (in-app routing, an anchor, a `mailto:`
 *   the webview already handles).
 *
 * Same-origin is deliberately "leave it alone": that is SvelteKit's router, and hijacking it would
 * break every internal link in the app.
 */
export function externalLinkToOpen(href: string, origin: string): string | null {
	const url = URL.parse(href);
	if (!url || url.origin === origin) return null;
	return OPENABLE.has(url.protocol) ? url.href : null;
}

/** …and whether the click must be CANCELLED even when nothing gets opened. A cross-origin link the
 *  opener won't take (`file:`, an invented scheme) must not fall through to the webview and navigate
 *  it — refusing to open it and letting it load anyway would be the whole bug, dressed up. */
export function shouldCancelNavigation(href: string, origin: string): boolean {
	const url = URL.parse(href);
	return url !== null && url.origin !== origin;
}
