import type { Action } from 'svelte/action';

export interface AnchoredOptions {
	/** The control this surface came from: it opens beside it and travels with it. */
	anchor: HTMLElement;
	onclose: () => void;
	/** Floating parts that belong to this surface though they live elsewhere in the body — a
	 *  picker's detail card. A press on one is not a press outside. */
	companions?: string;
}

/** Air between the control and the surface, and between the surface and the screen's edge. */
const GAP = 6;
const MARGIN = 8;

/**
 * Keep a `position: fixed` surface with the control that opened it: just below, right edges
 * aligned, and closed by a press anywhere else.
 *
 * It is pulled back on screen — left, or above the control — for the OPENING placement and on a
 * resize only. While the page scrolls it travels with its control instead, on the side it opened
 * on, because a surface pinned to an edge its control has already left belongs to nothing.
 *
 * Closing is a listener rather than a full-screen catcher: a fixed catcher's scroll parent is the
 * viewport, which does not scroll in this app, so it froze the page under the open surface. Scroll
 * is heard in the capture phase, because the control may sit inside a panel that scrolls on its own
 * and that scroll never reaches `window`.
 */
export const anchored: Action<HTMLElement, AnchoredOptions> = (node, initial) => {
	let options = initial;

	/** Where the surface sits relative to its control, as the last fit left it. */
	let offset = { left: 0, top: 0 };
	const moveTo = (control: DOMRect): void => {
		node.style.top = `${control.top + offset.top}px`;
		node.style.left = `${control.left + offset.left}px`;
	};

	/** Choose the side: below the control, or above it and pulled in from the left edge where below
	 *  would leave the screen. */
	function reflow(): void {
		const control = options.anchor.getBoundingClientRect();
		let left = control.right - node.offsetWidth;
		let top = control.bottom + GAP;
		if (left < MARGIN) left = MARGIN;
		if (top + node.offsetHeight > window.innerHeight - MARGIN)
			top = Math.max(MARGIN, control.top - node.offsetHeight - GAP);
		offset = { left: left - control.left, top: top - control.top };
		moveTo(control);
	}
	/** Travel with the control on the side already chosen. A scroll INSIDE the surface — its own
	 *  list, a rail of chips — moves nothing: the control has not gone anywhere. */
	const follow = (event: Event): void => {
		if (event.target instanceof Node && node.contains(event.target)) return;
		moveTo(options.anchor.getBoundingClientRect());
	};
	const closeOnOutside = (event: PointerEvent) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (node.contains(target) || options.anchor.contains(target)) return;
		if (options.companions && target instanceof Element && target.closest(options.companions))
			return;
		options.onclose();
	};

	// The first placement measures a surface whose body may not have laid out yet, so its clamp runs
	// against a height of nothing; the same observer covers one that RESIZES while open.
	const refit = new ResizeObserver(reflow);
	refit.observe(node);
	reflow();
	window.addEventListener('scroll', follow, true);
	window.addEventListener('resize', reflow);
	window.addEventListener('pointerdown', closeOnOutside, true);
	return {
		update(next) {
			options = next;
			reflow();
		},
		destroy() {
			refit.disconnect();
			window.removeEventListener('scroll', follow, true);
			window.removeEventListener('resize', reflow);
			window.removeEventListener('pointerdown', closeOnOutside, true);
		},
	};
};
