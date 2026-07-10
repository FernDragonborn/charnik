// App-level reactive state (pinned frontend convention, see docs/PLAN.md P1).
// Live-switchable with no reload. NOTE: `activeSystem` is the compendium/creation
// context only — a saved character is bound to its OWN system (stored in its JSON).

export type SystemId = '5e' | '5.5e';
export type ThemeId = 'light' | 'dark' | (string & {});

export const app = $state({
	/** Compendium/creation context. Not a way to reinterpret a built character. */
	activeSystem: '5.5e' as SystemId,
	/** Editions currently shown in the compendium/search. When more than one is active,
	 *  lists show each row's edition tag; with a single edition it's redundant (hidden). */
	activeEditions: ['5e', '5.5e'] as SystemId[],
	/** UI locale; content falls back to EN when a translation is missing. */
	activeLocale: 'en',
	/** Shipped default = dark slate (see docs/PLAN.md #18). */
	theme: 'dark' as ThemeId
});

/** Is a content row visible under the current edition filter? True when ANY of its editions is
 *  active. Pass the row's STAMPED `systems` (from the file's `#content-systems:` header / pack
 *  default), not the raw `data.systems` column — SRD files declare editions in the header, so the
 *  column is absent and would filter everything out. */
export function inActiveEdition(systems: string[]): boolean {
	return systems.some((s) => app.activeEditions.includes(s as SystemId));
}
