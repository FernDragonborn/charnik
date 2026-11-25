import type { Action } from 'svelte/action';
import { FOCUSABLE } from './trapFocus';

/*
 * A list of rows as ONE Tab stop (`work/ui.md` ▸ KEYBOARD-NAV, the maintainer's call): the rows are
 * walked by ↑/↓, a row's own controls — prepare, cast, pin, remove — are its cells on ←/→, Home and
 * End go to a row's first and last cell, Ctrl+Home and Ctrl+End to the first and last row, and Tab
 * leaves the list from whichever cell it last stood on. The APG grid pattern, by roving tabindex.
 *
 * The rows stay the markup they are; the action finds them by a selector and re-reads them whenever
 * the list changes, so a row added, removed, folded or re-ordered is walked as it now stands.
 */

/** A cell this action took out of the Tab order, so it can still be found as one. */
const CELL_MARK = 'data-grid-cell';
// a <details> row opens by its <summary>, which takes focus without being in FOCUSABLE
const CELLS = `${FOCUSABLE}, summary, [${CELL_MARK}]`;

/** The keys a control may want for itself: an editable one keeps every arrow. */
const EDITABLE = 'input, select, textarea, [contenteditable="true"]';
// Chromium gives closed details content rectangles even while keeping it out of the Tab order.
const CLOSED_DETAILS_BODY = 'details:not([open]) > :not(summary)';

function cellsOf(row: Element): HTMLElement[] {
	const inner = [...row.querySelectorAll<HTMLElement>(CELLS)];
	const own = row.matches(CELLS) && row instanceof HTMLElement ? [row] : [];
	// a cell inside a nested row belongs to that row, and a hidden one is nowhere to land
	return [...own, ...inner].filter(
		(cell) =>
			cell.closest('[data-grid-row]') === row &&
			!cell.closest(CLOSED_DETAILS_BODY) &&
			cell.getClientRects().length > 0,
	);
}

interface GridPlace {
	row: number;
	cell: number;
}

/** Where a key moves the focus from `at` in a grid of `rows` rows and `cells` cells in this row;
 *  null for a key that is not the grid's. ←/→ mirror right to left. */
function stepTo(
	key: { code: string; ctrlKey: boolean },
	rtl: boolean,
	at: GridPlace & { rows: number; cells: number },
): GridPlace | null {
	const { row, cell } = at;
	const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
	const back = rtl ? 'ArrowRight' : 'ArrowLeft';
	if (key.code === 'ArrowDown') return { row: Math.min(at.rows - 1, row + 1), cell };
	if (key.code === 'ArrowUp') return { row: Math.max(0, row - 1), cell };
	if (key.code === forward) return { row, cell: Math.min(at.cells - 1, cell + 1) };
	if (key.code === back) return { row, cell: Math.max(0, cell - 1) };
	if (key.code === 'Home') return key.ctrlKey ? { row: 0, cell: 0 } : { row, cell: 0 };
	if (key.code === 'End')
		return key.ctrlKey ? { row: at.rows - 1, cell: 0 } : { row, cell: at.cells - 1 };
	return null;
}

/** Run `settle` once a change under `node` has landed — rows re-render under a list (a cast spends a
 *  pip, a filter hides a row) — rather than once per mutation. Returns the way to stop. */
function afterEachChange(node: HTMLElement, settle: () => void): () => void {
	let pending = 0;
	const observer = new MutationObserver(() => {
		if (pending) return;
		pending = requestAnimationFrame(() => {
			pending = 0;
			settle();
		});
	});
	observer.observe(node, { childList: true, subtree: true, attributeFilter: ['open'] });
	return () => {
		observer.disconnect();
		cancelAnimationFrame(pending);
	};
}

export const rowGrid: Action<HTMLElement, string> = (node, rowSelector) => {
	let selector = rowSelector;
	/** Where the list's one Tab stop stands: a row and a cell in it, by position. */
	let at = { row: 0, cell: 0 };
	let tabStop: HTMLElement | undefined;

	const rows = (): HTMLElement[] => {
		const found = [...node.querySelectorAll<HTMLElement>(selector)];
		for (const row of found) row.setAttribute('data-grid-row', '');
		return found.filter((row) => cellsOf(row).length > 0);
	};

	/** Every cell out of the Tab order but the one the list remembers. */
	const settle = () => {
		if (tabStop) tabStop.tabIndex = -1;
		tabStop = undefined;
		const all = rows();
		at.row = Math.min(at.row, Math.max(0, all.length - 1));
		all.forEach((row, r) =>
			cellsOf(row).forEach((cell, c, cells) => {
				const current = r === at.row && c === Math.min(at.cell, cells.length - 1);
				cell.setAttribute(CELL_MARK, '');
				cell.tabIndex = current ? 0 : -1;
				if (current) tabStop = cell;
			}),
		);
	};

	const focusAt = (row: number, cell: number) => {
		const all = rows();
		const target = all[row];
		if (!target) return;
		const cells = cellsOf(target);
		const index = Math.max(0, Math.min(cell, cells.length - 1));
		at = { row, cell: index };
		settle();
		cells[index]?.focus();
	};

	const onFocusIn = (event: FocusEvent) => {
		const cell = event.target;
		if (!(cell instanceof HTMLElement)) return;
		const all = rows();
		const row = all.findIndex((r) => r.contains(cell));
		if (row < 0) return;
		const index = cellsOf(all[row] ?? cell).indexOf(cell);
		if (index < 0) return;
		at = { row, cell: index };
		settle();
	};

	const onKeydown = (event: KeyboardEvent) => {
		// a control that answered the key itself (a grip moving its row) keeps it
		if (event.defaultPrevented || event.altKey || event.metaKey) return;
		const cell = event.target;
		if (!(cell instanceof HTMLElement) || cell.matches(EDITABLE)) return;
		const all = rows();
		const row = all.findIndex((r) => r.contains(cell));
		if (row < 0) return;
		const cells = cellsOf(all[row] ?? cell);
		const next = stepTo(event, getComputedStyle(node).direction === 'rtl', {
			row,
			cell: Math.max(0, cells.indexOf(cell)),
			rows: all.length,
			cells: cells.length,
		});
		if (!next) return;
		event.preventDefault();
		focusAt(next.row, next.cell);
	};

	const stopWatching = afterEachChange(node, settle);
	settle();
	node.addEventListener('focusin', onFocusIn);
	node.addEventListener('keydown', onKeydown);

	return {
		update(next: string) {
			selector = next;
			settle();
		},
		destroy() {
			stopWatching();
			node.removeEventListener('focusin', onFocusIn);
			node.removeEventListener('keydown', onKeydown);
		},
	};
};
