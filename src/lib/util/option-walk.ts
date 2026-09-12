/*
 * ↑/↓/Home/End/Enter over a picker's options (ui.md §5).
 *
 * Shared by every searched list — the builder's two pickers and the compendium/spellbook
 * `EntryList` — because it is the same contract in all of them: arrows move the HIGHLIGHT and never
 * commit (walking a list must not take six things on the way down), and Enter is identical to a left
 * click on whatever is highlighted.
 */

/** All a walk needs from a key event. Narrower than `KeyboardEvent` on purpose: a real one is
 *  assignable to it, and it leaves the walk testable in node with no DOM to stand up. */
export interface KeyPress {
	code: string;
	preventDefault(): void;
}

export interface OptionWalk {
	/** The options in rendered order. A sectioned list passes only what is actually on screen: a
	 *  collapsed section is not somewhere the keyboard can land. */
	ids: string[];
	previewId: string | null;
	onpreview: (id: string) => void;
	/**
	 * Do Home and End jump the highlight?
	 *
	 * Not from the search box. The WAI-ARIA editable-combobox pattern reserves them for the textbox,
	 * and taking them costs someone typing "great weapon m" the only way back to the start of what
	 * they typed. On an option that holds focus there is no caret to serve, so they jump there.
	 */
	jumpKeys?: boolean;
	/**
	 * What a left click would do to the highlighted option.
	 *
	 * Absent when the walk is driven from an option that already HAS focus: there the browser's own
	 * Enter-on-a-button is the right one, and taking it over would activate the highlight rather than
	 * the thing the focus ring is around.
	 */
	onenter?: (id: string) => void;
}

/** Handle a key, or leave it alone. Returns whether it was ours, so a caller can still react. */
export function walkOptions(
	event: KeyPress,
	{ ids, previewId, onpreview, onenter, jumpKeys = true }: OptionWalk,
): boolean {
	if (!ids.length) return false;
	const at = previewId ? ids.indexOf(previewId) : -1;
	// The walk happens from the search box, so the highlighted option never has focus for the
	// browser's own Enter-on-a-button to fire — this is the only thing that makes Enter work there.
	// `NumpadEnter` is the same key to everyone but the keyboard.
	if (
		(event.code === 'Enter' || event.code === 'NumpadEnter') &&
		onenter &&
		previewId &&
		ids.includes(previewId)
	) {
		event.preventDefault();
		onenter(previewId);
		return true;
	}
	let next: number | null = null;
	if (event.code === 'ArrowDown') next = Math.min(ids.length - 1, at + 1);
	else if (event.code === 'ArrowUp') next = at <= 0 ? 0 : at - 1;
	else if (jumpKeys && event.code === 'Home') next = 0;
	else if (jumpKeys && event.code === 'End') next = ids.length - 1;
	if (next === null) return false;
	event.preventDefault();
	const id = ids[next];
	if (id) onpreview(id);
	return true;
}

/**
 * A stable DOM id for one option, so the search box can name the highlighted one through
 * `aria-activedescendant` — the only way a screen reader hears a walk whose focus never leaves the
 * caret. A content ref carries spaces and colons and an `id` may carry neither.
 */
export const optionDomId = (picker: string, effectiveId: string): string =>
	// only whitespace is replaced, because only whitespace is illegal in an id — flattening every
	// other character made `srd:fire bolt` and `srd_fire:bolt` the same DOM id, and this one feeds
	// `aria-activedescendant`
	`${picker}-${effectiveId.replace(/\s+/g, '_')}`;
