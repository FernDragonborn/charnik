/*
 * Custom themes as user-owned files — one JSON per theme, named after the theme, under `themes/`
 * in the data dir via the `Storage` seam (real files on desktop, OPFS/IndexedDB on web). This is the
 * portability layer: a theme is a plain file you can copy out, share, drop back in, or hand-edit —
 * exactly like the CSV content packs. The runtime injector (`customThemes.ts`) still applies whatever
 * is in `app.customThemes`; this module just loads that array from files and writes it back.
 *
 * SECURITY: an imported/on-disk file is untrusted → every load runs through `sanitizeThemeTokens`
 * (known token names + safe values only) and `isSafeThemeId`, so a hostile file can't inject CSS.
 */
import type { Storage } from '$lib/storage/types';
import { sanitizeThemeTokens, isSafeThemeId, type CustomTheme } from './customThemes';

const THEMES_DIR = 'themes';
const fileOf = (id: string): string => `${THEMES_DIR}/${id}.json`;

/** The on-disk shape (a tagged wrapper so a stray JSON isn't mistaken for a theme). */
interface ThemeFile {
	format: 'charnik-theme';
	version: 1;
	name: string;
	tokens: Record<string, string>;
}

/** A selector-safe slug from a display name (the file basename + `data-theme` id). */
export function slugifyThemeName(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'theme'
	);
}

/** `base`, or `base-2`, `base-3`… — the first id that's selector-safe AND not already taken. */
export function uniqueThemeId(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	const stem = slugifyThemeName(base);
	let id = stem;
	let n = 2;
	while (!isSafeThemeId(id) || set.has(id)) id = `${stem}-${n++}`;
	return id;
}

/** Serialize a theme to its file JSON (tagged + pretty). Only sanitized tokens are written. */
export function serializeTheme(theme: CustomTheme): string {
	const file: ThemeFile = {
		format: 'charnik-theme',
		version: 1,
		name: theme.name,
		tokens: sanitizeThemeTokens(theme.tokens)
	};
	return JSON.stringify(file, null, 2);
}

/** Parse + sanitize an untrusted theme object into a CustomTheme, or null if nothing valid survives.
 *  `fallbackName` (e.g. the file stem) names an unnamed theme; `taken` de-dupes the generated id. */
export function themeFromJson(
	raw: unknown,
	fallbackName: string,
	taken: Iterable<string> = []
): CustomTheme | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	const tokens = sanitizeThemeTokens(obj.tokens);
	if (Object.keys(tokens).length === 0) return null; // not a theme (or all-unsafe)
	const name =
		(typeof obj.name === 'string' && obj.name.trim()) || fallbackName || 'Imported theme';
	return { id: uniqueThemeId(name, taken), name, tokens };
}

/** Load every theme file from `themes/`, newest-first-agnostic. Bad/foreign files are skipped, never
 *  thrown past the caller. Ids come from the filename when safe, else regenerated from the name. */
export async function loadThemeFiles(storage: Storage): Promise<CustomTheme[]> {
	let entries;
	try {
		entries = await storage.list(THEMES_DIR);
	} catch {
		return []; // no themes dir yet
	}
	const out: CustomTheme[] = [];
	const taken = new Set<string>();
	for (const e of entries) {
		if (e.isDir || !e.name.endsWith('.json')) continue;
		try {
			const raw = JSON.parse(await storage.read(e.path)) as unknown;
			const stem = e.name.replace(/\.json$/, '');
			const theme = themeFromJson(raw, stem, taken);
			if (theme) {
				// prefer the filename as the id when it's already a safe, free slug (keeps file↔id stable)
				if (isSafeThemeId(stem) && !taken.has(stem)) theme.id = stem;
				taken.add(theme.id);
				out.push(theme);
			}
		} catch {
			/* skip a corrupt / non-JSON file */
		}
	}
	return out;
}

/** Write one theme to `themes/<id>.json` (atomic in the real impls). Best-effort by the caller. */
export async function writeThemeFile(storage: Storage, theme: CustomTheme): Promise<void> {
	await storage.mkdir(THEMES_DIR);
	await storage.write(fileOf(theme.id), serializeTheme(theme));
}

/** Delete a theme's file. No-op if it's already gone. */
export async function removeThemeFile(storage: Storage, id: string): Promise<void> {
	try {
		await storage.remove(fileOf(id));
	} catch {
		/* already gone */
	}
}

/** Seed the shipped themes (Dracula/Catppuccin) as normal theme files, but only those NOT already
 *  seeded once (tracked by id in `alreadySeeded`, persisted app-side). This way a bundled theme seeds
 *  on first run, a user's DELETE sticks (its id stays "seeded"), yet a NEW bundled theme in a later
 *  release still seeds. Never clobbers an existing file (an edited copy). Returns the ids newly seeded
 *  so the caller can record them. Best-effort — a write failure just skips that one. */
export async function seedBundledThemes(
	storage: Storage,
	bundled: readonly CustomTheme[],
	alreadySeeded: readonly string[]
): Promise<string[]> {
	const seeded = new Set(alreadySeeded);
	const newlySeeded: string[] = [];
	try {
		await storage.mkdir(THEMES_DIR);
	} catch {
		/* dir may already exist / be unreachable */
	}
	for (const t of bundled) {
		if (seeded.has(t.id)) continue; // already seeded once (even if the user later deleted it)
		try {
			if (!(await storage.exists(fileOf(t.id)))) await writeThemeFile(storage, t);
			newlySeeded.push(t.id);
		} catch {
			/* skip this one; retry next launch */
		}
	}
	return newlySeeded;
}

/** Migrate themes that only ever lived in the pre-files localStorage cache into real files, so the
 *  upgrade to file-backed themes doesn't silently drop a user's authored themes. Never clobbers an
 *  existing file (a hand-edited copy wins); only safe-id themes with surviving tokens are written.
 *  Best-effort. */
export async function migrateLegacyThemes(
	storage: Storage,
	legacy: readonly CustomTheme[]
): Promise<void> {
	for (const t of legacy) {
		if (!isSafeThemeId(t.id) || Object.keys(sanitizeThemeTokens(t.tokens)).length === 0) continue;
		try {
			if (!(await storage.exists(fileOf(t.id)))) await writeThemeFile(storage, t);
		} catch {
			/* skip this one; the load below still returns whatever files do exist */
		}
	}
}

/** Startup reconcile — migrate any legacy (localStorage-only) themes to files, seed not-yet-seeded
 *  bundled themes, then load every theme file (the source of truth). Returns the themes for
 *  `app.customThemes` + the ids newly seeded (append to the persisted seeded set). Best-effort —
 *  never throws. */
export async function initThemes(
	storage: Storage,
	bundled: readonly CustomTheme[],
	alreadySeeded: readonly string[],
	legacy: readonly CustomTheme[] = []
): Promise<{ themes: CustomTheme[]; newlySeeded: string[] }> {
	await migrateLegacyThemes(storage, legacy);
	const newlySeeded = await seedBundledThemes(storage, bundled, alreadySeeded);
	return { themes: await loadThemeFiles(storage), newlySeeded };
}
