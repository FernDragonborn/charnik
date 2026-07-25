/*
 * Runtime custom-theme injector. A custom theme is a set of design-token overrides applied under a
 * `[data-theme='<id>']` selector; selecting that id on <html> (app.theme) activates it live, exactly
 * like the built-in light/dark. This module turns a {id, name, tokens} object into that CSS and
 * injects it into <head>, so a user-authored theme needs NO rebuild.
 *
 * The built-in dark/light themes live in tokens.css; these are ADDITIVE user themes on top.
 *
 * SECURITY (docs/SECURITY.md — bounded, no injection/eval): theme values may come from user files
 * (untrusted). We only emit (a) token NAMES from the known themeable set and (b) VALUES that match a
 * strict color/length grammar — no braces, semicolons, url(), @-rules or comment markers can escape
 * a declaration and inject a rule. The id is slug-validated so it can't break the attribute selector.
 */

/** The design tokens a custom theme may override — the semantic color palette plus the shadow slots.
 *  (Sizes/spacing/radius are global scale knobs; expose them here too if per-theme density lands.)
 *  @public the planned Settings ▸ Themes editor renders one field per token from this list. */
export const THEMEABLE_TOKENS = [
	'color-bg',
	'color-surface',
	'color-surface-2',
	'color-border',
	'color-border-strong',
	'color-text',
	'color-text-muted',
	'color-accent',
	'color-accent-text',
	'color-accent-bright',
	'color-accent-deep',
	'color-accent-soft',
	'color-resource',
	'color-resource-soft',
	'color-resource-line',
	'color-good',
	'color-good-soft',
	'color-good-line',
	'color-success',
	'color-warning',
	'color-warning-text',
	'color-danger',
	'color-danger-soft',
	'color-overlay',
	'shadow-1',
	'shadow-2'
] as const;

/** @public a token name the Themes editor can set (drives the editor form's typing). */
export type ThemeableToken = (typeof THEMEABLE_TOKENS)[number];
const THEMEABLE = new Set<string>(THEMEABLE_TOKENS);

export interface CustomTheme {
	/** Stable slug used as the `data-theme` value (and `app.theme`). */
	id: string;
	/** Human-readable name for the theme picker. */
	name: string;
	/** token name (with or without the leading `--`) → CSS value. Unknown names + unsafe values drop. */
	tokens: Record<string, string>;
}

/** A safe token VALUE: hex, rgb/hsl/color-mix/var(...) calls, keywords, numbers, %, spaces, commas,
 *  and `/` (for `rgb(0 0 0 / 40%)`). NO braces, semicolons, url(), @, or comment markers — so a value
 *  can't terminate its declaration or open a new rule. Length-capped as defence in depth. */
const SAFE_VALUE = /^[a-zA-Z0-9#%.,()/\s-]+$/;
const isSafeValue = (v: string): boolean =>
	v.length > 0 && v.length <= 120 && SAFE_VALUE.test(v) && !/url\(|expression|\/\*|@/i.test(v);

/** A safe theme id: a short lowercase slug, so `[data-theme='<id>']` can't be broken out of. Also
 *  rejects the two built-in ids so a custom theme can't shadow dark/light. */
export const isSafeThemeId = (id: string): boolean =>
	/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) && id !== 'dark' && id !== 'light';

/** Turn one theme into its `[data-theme='id'] { … }` rule, dropping unknown tokens + unsafe values.
 *  Returns '' when the id is unsafe or nothing survived (so an empty theme injects nothing). Pure. */
export function themeToCss(theme: CustomTheme): string {
	if (!isSafeThemeId(theme.id)) return '';
	const decls: string[] = [];
	for (const [name, value] of Object.entries(theme.tokens)) {
		const token = name.replace(/^--/, '');
		if (THEMEABLE.has(token) && typeof value === 'string' && isSafeValue(value.trim()))
			decls.push(`\t--${token}: ${value.trim()};`);
	}
	return decls.length ? `[data-theme='${theme.id}'] {\n${decls.join('\n')}\n}` : '';
}

/** Build the combined stylesheet for a set of custom themes (pure — the DOM-free core, unit-tested).
 *  Returns the CSS plus the ids that actually produced a rule (for the picker to list). */
export function buildThemesStylesheet(themes: CustomTheme[]): { css: string; ids: string[] } {
	const blocks: string[] = [];
	const ids: string[] = [];
	for (const t of themes) {
		const css = themeToCss(t);
		if (css) {
			blocks.push(css);
			ids.push(t.id);
		}
	}
	return { css: blocks.join('\n\n'), ids };
}

const STYLE_ID = 'charnik-custom-themes';

/** Inject/replace the custom-theme stylesheet in <head>. Idempotent — call whenever the set changes;
 *  it reuses the one <style> element. No-op on the server (SSR/tests). Returns the registered ids. */
export function registerCustomThemes(themes: CustomTheme[]): string[] {
	if (typeof document === 'undefined') return [];
	const { css, ids } = buildThemesStylesheet(themes);
	let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
	if (!el) {
		el = document.createElement('style');
		el.id = STYLE_ID;
		document.head.appendChild(el);
	}
	el.textContent = css;
	return ids;
}
