import type { Action } from 'svelte/action';
import { FOCUSABLE } from './trapFocus';
import { renderContentMarkdown } from '#lib/content/markdown.ts';

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

/**
 * What a popover says: a line of the app's own text, or a content row's PROSE — which is Markdown,
 * so it is said as `{ markdown }` and goes through the one sanitizing renderer every other surface
 * uses. A plain string is never read as markup, whatever it contains.
 *
 * `pin` is for prose somebody may want to KEEP in front of them — a condition's rules, a spell's
 * text behind an ⓘ. A press on the trigger then pins the popover: it stays through pointer-leave
 * and blur, its text can be selected and copied, and it goes on the next press anywhere outside its
 * own box (a press inside is a selection, never a dismissal) or on Escape. Pinned is a state only
 * that press enters; hover and focus open it exactly as they open any other.
 */
export type Explanation = string | { markdown: string; pin?: boolean } | null | undefined;

/** An explanation ready to show: its words for a screen reader, its markup when it is prose, and
 *  whether a press on its trigger pins it. */
interface Said {
	text: string;
	html: string | null;
	pins: boolean;
}
const NOTHING: Said = { text: '', html: null, pins: false };

function sayOf(given: Explanation): Said {
	if (!given) return NOTHING;
	if (typeof given === 'string') return { text: given, html: null, pins: false };
	if (!given.markdown) return NOTHING;
	const html = renderContentMarkdown(given.markdown);
	const holder = document.createElement('div');
	holder.innerHTML = html;
	return { text: holder.textContent.trim(), html, pins: given.pin === true };
}

/** Gap between the value and its popover — the anchored menus' own offset (`menu-overlay`). */
const GAP_PX = 6;
/** Room kept from the viewport edge, so a value at the far right is still read in full. */
const EDGE_PX = 8;
/** How long the pointer rests on a CONTROL before its hint opens, so a pointer crossing a toolbar
 *  on its way elsewhere flashes nothing. A value opens at once: its popover is the answer to
 *  pointing at it. */
export const CONTROL_HINT_DWELL_MS = 400;
/** While a hint is up, or this soon after one closed, the next opens with no dwell — what every
 *  toolbar does once the reader is reading its hints one after another. */
export const HINT_WARM_MS = 300;

let popover: HTMLDivElement | null = null;
let openFor: HTMLElement | null = null;
/** When the last popover closed, for the warm window. */
let closedAt = Number.NEGATIVE_INFINITY;
/** The trigger whose popover is PINNED, or null. While one is, nothing else opens over it. */
let pinnedFor: HTMLElement | null = null;
let described = 0;

/** A press anywhere but the pinned popover and its own trigger lets it go. The trigger is left out
 *  because its press is the same gesture that pinned it, and it answers for itself. */
function releaseOnOutsidePress(e: MouseEvent): void {
	const pressed = e.target;
	if (!(pressed instanceof Node)) return;
	if (popover?.contains(pressed) || pinnedFor?.contains(pressed)) return;
	hide();
}
/** Escape lets a pinned popover go from wherever focus is — it outlives its trigger's focus. */
function releaseOnEscape(e: KeyboardEvent): void {
	if (e.key === 'Escape') hide();
}

function pin(node: HTMLElement): void {
	pinnedFor = node;
	popover?.classList.add('is-pinned');
	node.setAttribute('aria-expanded', 'true');
	document.addEventListener('click', releaseOnOutsidePress, true);
	document.addEventListener('keydown', releaseOnEscape, true);
}

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
		window.addEventListener('scroll', followOrHide, true);
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
	if (openFor) closedAt = performance.now();
	popover?.classList.remove('is-open', 'is-pinned');
	if (pinnedFor) {
		pinnedFor.setAttribute('aria-expanded', 'false');
		document.removeEventListener('click', releaseOnOutsidePress, true);
		document.removeEventListener('keydown', releaseOnEscape, true);
	}
	openFor = null;
	pinnedFor = null;
}

/** A value that holds FOCUS keeps its popover through a scroll, and the popover follows it: the
 *  browser scrolls a focused value into view, so that scroll belongs to the same act that opened the
 *  popover, and closing on it leaves a keyboard nothing to read below the fold. A hovered value
 *  closes — the pointer no longer rests on what it explained — and so does one scrolled off screen. */
function followOrHide(): void {
	if (!openFor || !popover) return;
	const at = openFor.getBoundingClientRect();
	const isInView = at.bottom > 0 && at.top < window.innerHeight;
	const stays = pinnedFor === openFor || openFor.contains(document.activeElement);
	if (isInView && stays) place(openFor, popover);
	else hide();
}

function show(node: HTMLElement, said: Said): void {
	const tip = popoverElement();
	// prose wraps as paragraphs; a breakdown keeps its one line per newline
	tip.classList.toggle('is-prose', said.html !== null);
	if (said.html === null) tip.textContent = said.text;
	else tip.innerHTML = said.html;
	// shown before it is placed: an element has no measurable size until it is laid out, and the
	// alternative — placing it from the previous value's coordinates — is a flash in the wrong spot
	tip.classList.add('is-open');
	place(node, tip);
	openFor = node;
}

/** An icon control's hint IS its name: described by it too, a screen reader says it twice. */
function describeUnlessNamed(node: HTMLElement, label: HTMLElement): void {
	if (label.textContent === node.getAttribute('aria-label'))
		node.removeAttribute('aria-describedby');
	else node.setAttribute('aria-describedby', label.id);
}

/** The pointer's way into a hint. A pointer on a control waits out the dwell unless a hint is already
 *  being read; anything else opens at once. Focus never comes through here: a keyboard arriving on a
 *  control has stopped on it. */
function pointerDwell(open: () => void): {
	start: (isControl: boolean) => void;
	cancel: () => void;
} {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cancel = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	const start = (isControl: boolean) => {
		const isWarm = openFor !== null || performance.now() - closedAt < HINT_WARM_MS;
		if (isControl && !isWarm) timer = setTimeout(open, CONTROL_HINT_DWELL_MS);
		else open();
	};
	return { start, cancel };
}

export const provenance: Action<HTMLElement, Explanation> = (node, initial) => {
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
	let said = NOTHING;

	/** Empty provenance is no provenance: nothing to read, so no tab stop and no description either.
	 *  A value can arrive before the sheet that explains it, so this is re-decided on every update. */
	const describe = (given: Explanation) => {
		said = sayOf(given);
		const next = said.text;
		label.textContent = next;
		// a trigger that pins says whether it has, the way any control that reveals something does
		if (said.pins) node.setAttribute('aria-expanded', String(pinnedFor === node));
		else node.removeAttribute('aria-expanded');
		if (next && !label.isConnected) {
			node.append(label);
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
		if (next) describeUnlessNamed(node, label);
	};

	const open = () => {
		dwell.cancel();
		// a pinned popover is being read; another value passing under the pointer does not take it
		if (said.text && (!pinnedFor || pinnedFor === node)) show(node, said);
	};
	const dwell = pointerDwell(open);
	// a pinning ⓘ is an explanation first, so it opens like a value
	const openOnPointer = () => dwell.start(!ownsTabStop && !said.pins);
	const close = () => {
		dwell.cancel();
		if (openFor === node && pinnedFor !== node) hide();
	};
	// A CONTROL's press does something — often opens a menu exactly where the popover stands — so
	// the explanation gives way to it. A plain value has no press of its own, and on touch a tap is
	// the only way to open its popover at all, so that one stays. A trigger that PINS is the third
	// case: its press is what keeps the popover, and a second press lets it go.
	const onClick = () => {
		dwell.cancel();
		if (!said.pins) {
			if (!ownsTabStop) close();
		} else if (pinnedFor === node) hide();
		else if (said.text) {
			if (pinnedFor) hide();
			show(node, said);
			pin(node);
		}
	};
	const onKeydown = (e: KeyboardEvent) => {
		// Escape dismisses without moving focus — the ordinary way out of a tooltip you have read
		if (e.key === 'Escape' && openFor === node) {
			e.stopPropagation();
			hide();
		}
	};

	describe(initial);
	const listening = new AbortController();
	const { signal } = listening;
	node.addEventListener('pointerenter', openOnPointer, { signal });
	node.addEventListener('pointerleave', close, { signal });
	node.addEventListener('focusin', open, { signal });
	node.addEventListener('focusout', close, { signal });
	node.addEventListener('click', onClick, { signal });
	node.addEventListener('keydown', onKeydown, { signal });

	return {
		update(next: Explanation) {
			describe(next);
			if (openFor !== node) return;
			if (said.text) show(node, said);
			else hide();
		},
		destroy() {
			dwell.cancel();
			if (openFor === node) hide();
			listening.abort();
			describe('');
		},
	};
};
