/*
 * Where a picker's floating card lands.
 *
 * Both cards a picker can open — the hover teaser and the full article popover — sit beside the
 * picker rather than inside it, so reading an option costs the inspector column no height. They are
 * `position: fixed`, which is also what lets them spill over the sheet without a portal: a fixed box
 * is laid out against the viewport, so the pane's `overflow: hidden` never clips it.
 *
 * Horizontally they follow the PICKER, never the entry that was clicked. In a grid the clicked
 * cell's left edge is not the picker's, and anchoring to it would cover the cells to its left along
 * with their take toggles (ui.md §8).
 */

/** Breathing room between the picker and its card, so the take toggle beside a row stays clickable. */
const GAP = 14;
/** How close to the window edge a card may sit. */
const MARGIN = 12;
/** How far above the entry's own top edge the card starts, so the two read as one object. */
const RISE = 10;

/**
 * Place `card` beside `picker`, vertically level with `entry`. Written straight onto the element
 * because it is pure viewport geometry measured after paint — the card's own height is an input, so
 * there is nothing to compute before it exists.
 */
export function placeCard(card: HTMLElement, entry: HTMLElement, picker: HTMLElement): void {
	card.style.maxHeight = `${window.innerHeight - MARGIN * 2}px`;
	const box = card.getBoundingClientRect();
	const top = entry.getBoundingClientRect().top - RISE;
	card.style.top = `${Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - box.height - MARGIN))}px`;

	// Left of the picker is the sheet, and that is where the card belongs. Below ~1100px the inspector
	// is the full width and there is no sheet to spill over, so it flips to the other side rather than
	// hanging off-screen where it cannot be read.
	const rail = picker.getBoundingClientRect();
	const onTheLeft = rail.left - box.width - GAP;
	card.style.left = `${
		onTheLeft >= MARGIN
			? onTheLeft
			: Math.max(MARGIN, Math.min(rail.right + GAP, window.innerWidth - box.width - MARGIN))
	}px`;
}

/** The DOM node for one entry of a picker, or the picker itself when that row is not rendered (a
 *  collapsed section, a filtered-out row) — a card still has to land somewhere sensible. */
export function entryElement(picker: HTMLElement, id: string): HTMLElement {
	return picker.querySelector<HTMLElement>(`[data-entry="${CSS.escape(id)}"]`) ?? picker;
}
