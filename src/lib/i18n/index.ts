/*
 * UI i18n (P1 convention; full i18n is roadmap P5).
 *
 * `svelte-i18n` was chosen so a user can DROP IN a new locale catalog and switch without
 * a rebuild. The language list is therefore DISCOVERED from this registry — never a
 * hardcoded array inside a component. Runtime-added catalogs extend `LOCALES`; everything
 * UI-facing reads from it. Missing keys fall back to English.
 */
import { get } from 'svelte/store';
import { register, init, locale, waitLocale, json, _ } from 'svelte-i18n';

export type Dir = 'ltr' | 'rtl';

export interface LocaleMeta {
	/** BCP-47-ish id used as the catalog filename and `lang` attribute. */
	id: string;
	/** Endonym shown in the language switcher. */
	label: string;
	dir: Dir;
}

export const FALLBACK_LOCALE = 'en';

/** Base language codes that render right-to-left. Used to set <html dir>. */
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'dv', 'ps', 'yi']);

/** Bundled catalogs. Add an entry + a `locales/<id>.json` to ship another language. */
export const LOCALES: LocaleMeta[] = [
	{ id: 'en', label: 'English', dir: 'ltr' },
	{ id: 'uk', label: 'Українська', dir: 'ltr' },
];

// Vite resolves this template import against ./locales/*.json at build time.
for (const { id } of LOCALES) {
	register(id, () => import(`./locales/${id}.json`));
}

/** Text direction for a locale id (independent of svelte-i18n, which doesn't track it). */
export function dirFor(localeId: string): Dir {
	const base = localeId.toLowerCase().split('-')[0] ?? '';
	return RTL_LANGS.has(base) ? 'rtl' : 'ltr';
}

/**
 * Initialize the catalogs. Call once (from the root layout load) and await the returned
 * promise via `waitLocale()` so the first paint has messages.
 */
export async function startI18n(initialLocale: string = FALLBACK_LOCALE): Promise<void> {
	// `init` returns `void | Promise<void>`; await normalizes it to a real Promise.
	await init({ fallbackLocale: FALLBACK_LOCALE, initialLocale });
	// every catalog, not just the active one: the roller matches what you TYPE against every language
	// installed, so a Ukrainian «перевага» finds its row under an English UI and back. Catalogs are a
	// few KB each and this is the only place that can know they are all in before anything reads them.
	await Promise.all(LOCALES.map(({ id }) => waitLocale(id)));
}

/**
 * Translate from outside a component.
 *
 * A view-model raising a toast has no `$_`, which is how a screenful of English sentences ended up
 * as literals in `combat/*` and `build/*`. This reads the live store, so it follows a locale switch
 * exactly like the markup does — the value is read at call time, never captured.
 *
 * With no locale set, `svelte-i18n` THROWS rather than returning anything. A notice must never be
 * the thing that breaks the action that raised it — a failed cast is a worse bug than an unformatted
 * one — so the key is handed back instead. The app sets a locale before its first paint; what
 * reaches this branch is a node test driving a view-model with no i18n at all.
 */
export const t = (key: string, values?: Record<string, string | number>): string =>
	get(locale) == null ? key : get(_)(key, values ? { values } : undefined);

export { locale, waitLocale, json, _ };
