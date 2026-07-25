import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import type { CustomTheme } from './customThemes';
import {
	slugifyThemeName,
	uniqueThemeId,
	serializeTheme,
	themeFromJson,
	writeThemeFile,
	loadThemeFiles,
	seedBundledThemes,
	migrateLegacyThemes,
	initThemes
} from './themeFiles';

const theme = (over: Partial<CustomTheme> = {}): CustomTheme => ({
	id: 'ocean',
	name: 'Ocean',
	tokens: { 'color-accent': '#0af', 'color-bg': '#012' },
	...over
});

describe('slug + id', () => {
	it('slugifies a display name', () => {
		expect(slugifyThemeName('My Cool Theme!')).toBe('my-cool-theme');
		expect(slugifyThemeName('   ')).toBe('theme');
	});
	it('uniqueThemeId avoids taken ids + unsafe slugs', () => {
		expect(uniqueThemeId('Ocean', [])).toBe('ocean');
		expect(uniqueThemeId('Ocean', ['ocean'])).toBe('ocean-2');
		expect(uniqueThemeId('dark', [])).toBe('dark-2'); // 'dark' is reserved → bumped
	});
});

describe('serialize / parse (import security boundary)', () => {
	it('round-trips a theme through the file JSON', () => {
		const json = serializeTheme(theme());
		const parsed = themeFromJson(JSON.parse(json), 'fallback');
		expect(parsed?.name).toBe('Ocean');
		expect(parsed?.tokens['color-accent']).toBe('#0af');
	});
	it('drops unknown tokens + injection-shaped values on import', () => {
		const parsed = themeFromJson(
			{ name: 'Evil', tokens: { 'color-bg': 'red; } body{display:none', 'font-size-md': '9px' } },
			'x'
		);
		expect(parsed).toBeNull(); // nothing safe survived
	});
	it('returns null for a non-theme object', () => {
		expect(themeFromJson({ hello: 'world' }, 'x')).toBeNull();
		expect(themeFromJson('nope', 'x')).toBeNull();
	});
	it('names an unnamed theme from the fallback + de-dupes the id', () => {
		const parsed = themeFromJson({ tokens: { 'color-bg': '#000' } }, 'sunset', ['sunset']);
		expect(parsed?.name).toBe('sunset');
		expect(parsed?.id).toBe('sunset-2');
	});
});

describe('file layer (MemoryStorage)', () => {
	it('writes then loads a theme file', async () => {
		const s = new MemoryStorage();
		await writeThemeFile(s, theme());
		const loaded = await loadThemeFiles(s);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.id).toBe('ocean');
		expect(loaded[0]?.tokens['color-accent']).toBe('#0af');
	});

	it('seeds bundled themes once, and a deletion stays deleted', async () => {
		const s = new MemoryStorage();
		const bundled = [theme({ id: 'dracula', name: 'Dracula' })];
		const seeded = await seedBundledThemes(s, bundled, []);
		expect(seeded).toEqual(['dracula']);
		expect(await loadThemeFiles(s)).toHaveLength(1);
		// user deletes it; a later launch passes the recorded seeded ids → must NOT re-create it
		await s.remove('themes/dracula.json');
		expect(await seedBundledThemes(s, bundled, ['dracula'])).toEqual([]);
		expect(await loadThemeFiles(s)).toHaveLength(0);
	});

	it('re-seeds a bundled theme whose file is gone but was never recorded as seeded', async () => {
		const s = new MemoryStorage();
		const bundled = [theme({ id: 'dracula', name: 'Dracula' })];
		// simulates the stuck state: no file, no record → seeding must recover it
		expect(await seedBundledThemes(s, bundled, [])).toEqual(['dracula']);
		expect(await loadThemeFiles(s)).toHaveLength(1);
	});

	it('initThemes seeds + loads + reports newly-seeded ids', async () => {
		const s = new MemoryStorage();
		const { themes, newlySeeded } = await initThemes(
			s,
			[theme({ id: 'dracula', name: 'Dracula' })],
			[]
		);
		expect(themes.map((t) => t.id)).toEqual(['dracula']);
		expect(newlySeeded).toEqual(['dracula']);
	});

	it('migrates legacy (localStorage-only) themes to files without clobbering an existing file', async () => {
		const s = new MemoryStorage();
		await writeThemeFile(s, theme({ id: 'ocean', name: 'Edited Ocean' })); // a file already on disk
		await migrateLegacyThemes(s, [
			theme({ id: 'ocean', name: 'Stale cache copy' }), // must NOT overwrite the file above
			theme({ id: 'sunset', name: 'Sunset' }), // new → written
			theme({ id: 'dark', name: 'reserved' }), // unsafe id → skipped
			theme({ id: 'empty', tokens: {} }) // no safe tokens → skipped
		]);
		const loaded = await loadThemeFiles(s);
		expect(loaded.map((t) => t.id).sort()).toEqual(['ocean', 'sunset']);
		expect(loaded.find((t) => t.id === 'ocean')?.name).toBe('Edited Ocean');
	});

	it('initThemes migrates legacy themes before loading', async () => {
		const s = new MemoryStorage();
		const { themes } = await initThemes(s, [], [], [theme({ id: 'mine', name: 'Mine' })]);
		expect(themes.map((t) => t.id)).toEqual(['mine']);
	});
});
