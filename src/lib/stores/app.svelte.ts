// App-level reactive state (pinned frontend convention, see docs/PLAN.md P1).
// Live-switchable with no reload. NOTE: `activeSystem` is the compendium/creation
// context only — a saved character is bound to its OWN system (stored in its JSON).
//
// Persisted across reloads in localStorage (standalone/offline-safe, same pattern as
// content/sources.svelte.ts): the chosen theme, UI locale, active system and editions
// survive a page reload / app restart. Loaded synchronously at module init so the very
// first paint (and startI18n in +layout.ts) already uses the saved locale/theme.

export type SystemId = '5e' | '5.5e';
export type ThemeId = 'light' | 'dark' | (string & {});

interface AppState {
	/** Compendium/creation context. Not a way to reinterpret a built character. */
	activeSystem: SystemId;
	/** Editions currently shown in the compendium/search. When more than one is active,
	 *  lists show each row's edition tag; with a single edition it's redundant (hidden). */
	activeEditions: SystemId[];
	/** UI locale; content falls back to EN when a translation is missing. */
	activeLocale: string;
	/** Shipped default = dark slate (see docs/PLAN.md #18). */
	theme: ThemeId;
}

const STORAGE_KEY = 'charnik:app';

function defaults(): AppState {
	return {
		activeSystem: '5.5e',
		activeEditions: ['5e', '5.5e'],
		activeLocale: 'en',
		theme: 'dark'
	};
}

function load(): AppState {
	const base = defaults();
	if (typeof localStorage === 'undefined') return base;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return base;
		// Merge over defaults so a partial / older snapshot never leaves a field undefined.
		const saved = JSON.parse(raw) as Partial<AppState>;
		return {
			...base,
			...saved,
			// never persist an empty edition set (would hide all content) — fall back to both
			activeEditions: saved.activeEditions?.length ? saved.activeEditions : base.activeEditions
		};
	} catch {
		return base;
	}
}

export const app = $state<AppState>(load());

function persist(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				activeSystem: app.activeSystem,
				activeEditions: app.activeEditions,
				activeLocale: app.activeLocale,
				theme: app.theme
			})
		);
	} catch {
		/* private mode / quota — switching still works this session, just not persisted */
	}
}

// Auto-save whenever any field changes. `$effect.root` lets a module-level singleton own an effect
// outside a component; reading the fields inside subscribes the effect to them.
if (typeof window !== 'undefined') {
	$effect.root(() => {
		$effect(persist);
	});
}

/** Is a content row visible under the current edition filter? True when ANY of its editions is
 *  active. Pass the row's STAMPED `systems` (from the file's `#content-systems:` header / pack
 *  default), not the raw `data.systems` column — SRD files declare editions in the header, so the
 *  column is absent and would filter everything out. */
export function inActiveEdition(systems: string[]): boolean {
	return systems.some((s) => app.activeEditions.includes(s as SystemId));
}
