import { FOCUSABLE } from '#lib/actions/trapFocus.ts';

/**
 * The attribute that makes an element a region F6 reaches (`work/ui.md` ▸ KEYBOARD-NAV, the
 * maintainer's call): the top bar, the hero, each panel. A desktop convention rather than a W3C one;
 * a region is added by marking it, so later ones need no change here.
 */
export const REGION_ATTRIBUTE = 'data-region';

/** Something the region walk can see: drawn, and not inside a closed <details>. */
const isShown = (el: HTMLElement): boolean => el.getClientRects().length > 0;

/**
 * F6 to the next region, Shift+F6 to the one before, wrapping round; the focus lands on a region's
 * first control — a panel's title — and on the region itself when it has none. Returns whether the
 * key was ours.
 */
export function cycleRegion(event: KeyboardEvent): boolean {
	if (event.code !== 'F6' || event.ctrlKey || event.altKey || event.metaKey) return false;
	if ([...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some(isShown)) {
		event.preventDefault();
		return true;
	}
	const regions = [...document.querySelectorAll<HTMLElement>(`[${REGION_ATTRIBUTE}]`)].filter(
		isShown,
	);
	if (!regions.length) return false;
	const active = document.activeElement;
	const at = regions.findIndex((region) => region.contains(active));
	const step = event.shiftKey ? -1 : 1;
	const next = at < 0 ? (event.shiftKey ? regions.length - 1 : 0) : at + step;
	const region = regions[(next + regions.length) % regions.length];
	if (!region) return false;
	event.preventDefault();
	const first = [...region.querySelectorAll<HTMLElement>(FOCUSABLE)].find(isShown);
	if (first) first.focus();
	else {
		region.tabIndex = -1;
		region.focus();
	}
	return true;
}
