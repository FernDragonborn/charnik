import { tick } from 'svelte';
import { FOCUSABLE } from '#lib/actions/trapFocus.ts';

/** The nearest sibling of `row` in one direction that is itself a row. */
function rowBeside(row: Element, rowSelector: string, forward: boolean): Element | null {
	for (
		let next = forward ? row.nextElementSibling : row.previousElementSibling;
		next;
		next = forward ? next.nextElementSibling : next.previousElementSibling
	)
		if (next.matches(rowSelector)) return next;
	return null;
}

/**
 * Remove the row holding `control`, then put focus somewhere real — the same control in the row
 * that takes its place, else in the row before, else `fallback` — and never on `<body>`, which is
 * where a removed control leaves it (`work/ui.md` ▸ KEYBOARD-NAV). Rows are keyed, so a neighbour's
 * element survives the removal and is still the one to focus.
 */
export async function removeKeepingFocus(
	control: HTMLElement,
	rowSelector: string,
	remove: () => unknown,
	fallback: HTMLElement | null = null,
): Promise<void> {
	const row = control.closest(rowSelector);
	const at = row ? [...row.querySelectorAll(FOCUSABLE)].indexOf(control) : -1;
	const after = row ? rowBeside(row, rowSelector, true) : null;
	const before = row ? rowBeside(row, rowSelector, false) : null;
	await remove();
	await tick();
	const landing = [after, before].find((r) => r?.isConnected);
	const controls = landing ? [...landing.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
	// rows differ in what they carry (an ⓘ here, none there), so the same KIND of control comes first
	const same = controls.find((other) => other.className === control.className);
	(same ?? controls[at] ?? controls[0] ?? fallback)?.focus();
}
