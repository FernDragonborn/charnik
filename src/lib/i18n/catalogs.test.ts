/*
 * Catalog parity. A UI string lives in the catalogs, never in a component (docs/internals/ui.md), so
 * the failure mode is silent: a key added to English and forgotten elsewhere renders the English
 * sentence inside an otherwise translated screen and nothing complains. This asserts every bundled
 * locale carries exactly the same key set, and that no value is left blank.
 */
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import uk from './locales/uk.json';
import { LOCALES } from './index';

type Catalog = { [key: string]: string | Catalog };

const CATALOGS: Record<string, Catalog> = { en, uk };

/** Every leaf path in a catalog, dotted ("build.origin.species"). */
function leafKeys(node: Catalog, prefix = ''): string[] {
	return Object.entries(node).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return typeof value === 'string' ? [path] : leafKeys(value, path);
	});
}

function leafValues(node: Catalog, prefix = ''): [string, string][] {
	return Object.entries(node).flatMap(([key, value]): [string, string][] => {
		const path = prefix ? `${prefix}.${key}` : key;
		return typeof value === 'string' ? [[path, value]] : leafValues(value, path);
	});
}

describe('i18n catalogs', () => {
	it('every locale in the registry is bundled here', () => {
		expect(Object.keys(CATALOGS).sort()).toEqual(LOCALES.map((l) => l.id).sort());
	});

	it('every locale carries the same keys as English', () => {
		const english = leafKeys(en).sort();
		for (const [id, catalog] of Object.entries(CATALOGS)) {
			const keys = leafKeys(catalog).sort();
			expect({ id, missing: english.filter((k) => !keys.includes(k)) }).toEqual({
				id,
				missing: [],
			});
			expect({ id, extra: keys.filter((k) => !english.includes(k)) }).toEqual({ id, extra: [] });
		}
	});

	it('no string is left empty — a blank renders as nothing at all', () => {
		for (const [id, catalog] of Object.entries(CATALOGS))
			for (const [path, value] of leafValues(catalog))
				expect(`${id}:${path}:${value.trim() === '' ? 'EMPTY' : 'ok'}`).toBe(`${id}:${path}:ok`);
	});

	it('an ICU placeholder used in one locale exists in every other', () => {
		// `{name}` / `{name, plural, …}` only — an ICU plural BRANCH body ("{no features yet}") also
		// starts with a word, so the closing `}` or the argument comma is what tells them apart.
		// A SET, not a list: Ukrainian needs four plural branches where English needs two, so the same
		// value legitimately appears a different number of times.
		const placeholders = (s: string) =>
			[...new Set([...s.matchAll(/\{(\w+)\s*[},]/g)].map((m) => m[1] ?? ''))].sort();
		for (const [path, value] of leafValues(en)) {
			const wanted = placeholders(value);
			for (const [id, catalog] of Object.entries(CATALOGS)) {
				if (id === 'en') continue;
				const translated = leafValues(catalog).find(([p]) => p === path)?.[1] ?? '';
				// `plural` is an ICU keyword, not a value the caller passes — compare the value names only
				const named = (list: string[]) => list.filter((n) => n !== 'plural');
				expect(`${id}:${path}:${named(placeholders(translated)).join(',')}`).toBe(
					`${id}:${path}:${named(wanted).join(',')}`,
				);
			}
		}
	});
});

describe('translator — the live catalog handed to a pure formatter', () => {
	it('follows a locale switch, because it reads the store on every call', async () => {
		const { startI18n, translator, locale } = await import('./index');
		await startI18n('en');
		const t = translator(); // captured ONCE, on purpose — the capture must not freeze the language
		expect(t('abilityShort.str')).toBe('STR');
		await locale.set('uk');
		expect(t('abilityShort.str')).toBe('СИЛ');
	});
});
