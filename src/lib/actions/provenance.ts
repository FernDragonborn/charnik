import type { Action } from 'svelte/action';
import { FOCUSABLE } from './trapFocus';

/*
 * The provenance popover: how an auto-calculated value explains itself (docs/internals/ui.md ▸ The
 * UX pattern contract, rule 3). It replaces `title`, which could only ever satisfy half the rule —
 * no browser shows a native tooltip on keyboard focus, so the users the rule exists for could not
 * read a breakdown at all.
 *
 * It is an ACTION rather than a component so a value keeps the markup it already had: the tiles,
 * rows and chips that carry provenance are two dozen different layouts, and injecting a trigger into
 * each of them would move pixels on every sheet to say the same thing.
 *
 * The element showing the value is the trigger — focusable, described by the text, and showing it on
 * hover AND on focus. That is the APG tooltip pattern, and it asks for no new gesture: a value you
 * can reach explains itself when you reach it.
 */

/** Gap between the value and its popover — the anchored menus' own offset (`menu-overlay`). */
const GAP_PX = 6;
/** Room kept from the viewport edge, so a value at the far right is still read in full. */
const EDGE_PX = 8;

let popover: HTMLDivElement | null = null;
let openFor: HTMLElement | null = null;
let described = 0;

/** The ONE popover element every traced value shares — only one is open at a time, so one exists.
 *  Re-attached rather than assumed present: whoever emptied the body around it did not mean to take
 *  the explanation of every number with it. */
function popoverElement(): HTMLDivElement {
	if (!popover) {
		popover = document.createElement('div');
		popover.className = 'provenance-popover';
		popover.setAttribute('role', 'tooltip');
	}
	if (!popover.isConnected) {
		document.body.append(popover);
		// a popover is placed against a rectangle that scrolling moves out from under it; captured, so
		// a panel scrolling inside the page counts as much as the page itself. Bound to the ELEMENT,
		// not to each value: one open popover means one listener, not one per number on the sheet.
		window.addEventListener('scroll', hide, true);
		window.addEventListener('resize', hide);
	}
	return popover;
}

/** Under the value, flipped above once the room below runs out, and never off either edge. */
function place(node: HTMLElement, tip: HTMLDivElement): void {
	const at = node.getBoundingClientRect();
	const size = tip.getBoundingClientRect();
	const left = Math.min(
		Math.max(EDGE_PX, at.left + at.width / 2 - size.width / 2),
		Math.max(EDGE_PX, window.innerWidth - size.width - EDGE_PX),
	);
	const below = at.bottom + GAP_PX;
	const fitsBelow = below + size.height <= window.innerHeight - EDGE_PX;
	tip.style.left = `${left}px`;
	tip.style.top = `${fitsBelow ? below : Math.max(EDGE_PX, at.top - size.height - GAP_PX)}px`;
}

function hide(): void {
	popover?.classList.remove('is-open');
	openFor = null;
}

function show(node: HTMLElement, text: string): void {
	const tip = popoverElement();
	tip.textContent = text;
	// shown before it is placed: an element has no measurable size until it is laid out, and the
	// alternative — placing it from the previous value's coordinates — is a flash in the wrong spot
	tip.classList.add('is-open');
	place(node, tip);
	openFor = node;
}

export const provenance: Action<HTMLElement, string> = (node, initial) => {
	// the description travels with the VALUE, not with the shared popover: a screen reader reads it
	// on focus whether or not the popover is what showed it
	const label = document.createElement('span');
	// `display: none`, not the visually-hidden clip: an out-of-flow node inside a scrolled panel still
	// counts toward the DOCUMENT's overflow, and there is one per traced value — 56 on the build
	// sheet, which is 242px of page that nothing draws. `aria-describedby` reads a hidden element by
	// design, so nothing is lost by hiding it outright.
	label.className = 'provenance-description';
	label.id = `provenance-${++described}`;
	/** Did WE make this a tab stop? A value that is already a control keeps the one it had. */
	let ownsTabStop = false;
	let text = '';

	/** Empty provenance is no provenance: nothing to read, so no tab stop and no description either.
	 *  A value can arrive before the sheet that explains it, so this is re-decided on every update. */
	const describe = (next: string) => {
		text = next;
		label.textContent = next;
		if (next && !label.isConnected) {
			node.append(label);
			node.setAttribute('aria-describedby', label.id);
			node.classList.add('has-provenance');
			// a control is already reachable, and a disabled one cannot be made reachable at all
			if (!node.matches(FOCUSABLE) && !node.matches(':disabled')) {
				node.tabIndex = 0;
				ownsTabStop = true;
			}
		} else if (!next && label.isConnected) {
			label.remove();
			node.removeAttribute('aria-describedby');
			node.classList.remove('has-provenance');
			if (ownsTabStop) node.removeAttribute('tabindex');
			ownsTabStop = false;
		}
	};

	const open = () => {
		if (text) show(node, text);
	};
	const close = () => {
		if (openFor === node) hide();
	};
	const onKeydown = (e: KeyboardEvent) => {
		// Escape dismisses without moving focus — the ordinary way out of a tooltip you have read
		if (e.key === 'Escape' && openFor === node) {
			e.stopPropagation();
			hide();
		}
	};

	describe(initial);
	node.addEventListener('pointerenter', open);
	node.addEventListener('pointerleave', close);
	node.addEventListener('focusin', open);
	node.addEventListener('focusout', close);
	node.addEventListener('keydown', onKeydown);

	return {
		update(next: string) {
			describe(next);
			if (openFor !== node) return;
			if (text) show(node, text);
			else hide();
		},
		destroy() {
			close();
			node.removeEventListener('pointerenter', open);
			node.removeEventListener('pointerleave', close);
			node.removeEventListener('focusin', open);
			node.removeEventListener('focusout', close);
			node.removeEventListener('keydown', onKeydown);
			describe('');
		},
	};
};
