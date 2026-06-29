// App-level reactive state (pinned frontend convention, see docs/PLAN.md P1).
// Live-switchable with no reload. NOTE: `activeSystem` is the compendium/creation
// context only — a saved character is bound to its OWN system (stored in its JSON).

export type SystemId = '5e' | '5.5e';
export type ThemeId = 'light' | 'dark' | (string & {});

export const app = $state({
	/** Compendium/creation context. Not a way to reinterpret a built character. */
	activeSystem: '5.5e' as SystemId,
	/** UI locale; content falls back to EN when a translation is missing. */
	activeLocale: 'en',
	/** Shipped default = dark slate (see docs/PLAN.md #18). */
	theme: 'dark' as ThemeId
});
