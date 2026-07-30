import type { Action } from 'svelte/action';

/** Elements that can hold keyboard focus — the tab ring a trapped dialog cycles within. */
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside a modal dialog (AUDIT F8) — the accessibility half the `.dialog` shell
 * was missing: backdrop-click + Escape already close it, but Tab could still walk out into the page
 * behind. Applied to the dialog root, so the trap lives exactly as long as the dialog is open.
 *
 * On mount it moves focus to the first focusable child (or the panel itself), so keyboard users start
 * inside; Tab / Shift+Tab wrap at the ends instead of escaping; on destroy it restores focus to
 * whatever was focused before the dialog opened (so the trigger regains focus). Pairs with
 * `dismissOnEscape` on the same node.
 */
export const trapFocus: Action<HTMLElement> = (node) => {
	const previouslyFocused = document.activeElement as HTMLElement | null;

	// ponytail: no visibility filter (offsetParent/getClientRects) — the attention dialogs here never
	// ship hidden focusables, so a display:none control would just be a benign extra tab stop. Add a
	// visibility check if a dialog ever renders hidden focusable elements.
	const focusable = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];

	// start inside the dialog: the first focusable control, else the panel (tabindex="-1")
	(focusable()[0] ?? node).focus();

	const onKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Tab') return;
		const items = focusable();
		const first = items[0];
		const last = items[items.length - 1];
		if (!first || !last) {
			e.preventDefault(); // nothing focusable — keep focus from leaving the dialog
			return;
		}
		const active = document.activeElement;
		// wrap: Shift+Tab off the first → last; Tab off the last → first. Focus outside → pull it back in.
		if (e.shiftKey && (active === first || !node.contains(active))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (active === last || !node.contains(active))) {
			e.preventDefault();
			first.focus();
		}
	};

	node.addEventListener('keydown', onKeydown);
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			previouslyFocused?.focus?.();
		}
	};
};
