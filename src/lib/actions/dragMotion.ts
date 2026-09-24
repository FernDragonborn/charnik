import { tick } from 'svelte';
import type { Action } from 'svelte/action';

/*
 * The weight of a dragged block: the two beats `svelte-dnd-action` does not animate.
 *
 * The library moves the OTHER rows for us (its FLIP), and it lifts a clone under the pointer. What
 * it does not do is give the drag any mass — the clone is the same size it always was, and the gap
 * it will drop into appears at full height the instant the drag starts, so a row arrives in a hole
 * that was already waiting for it. Both read as a diagram of a drag rather than a drag.
 *
 * So: the gap GROWS to meet the block (the neighbours below it move because the gap moved them, not
 * because a placeholder was allocated), and on release the block settles — it is carried squashed
 * (that part is CSS on the clone) and spreads back out as it lands. Squash and stretch, which is how
 * a physical thing reports its own mass.
 *
 * Applied to a dnd ZONE, not to a row: the element the library marks as the gap is its business, and
 * this reads it back out of the DOM (`data-is-dnd-shadow-item-internal`) rather than asking every
 * panel to mark its own rows.
 *
 * Heights are measured rather than written in CSS because a row is not one height — a feature row is
 * 36px and an action row 53 — and because the collapse must work whatever `display` the row uses: a
 * `grid-template-rows: 0fr` trick would have to make an inventory row a grid, which rearranges its
 * insides mid-drag.
 */

/** The gap opening. Short: it races the pointer, and a slow gap feels like lag, not like weight. */
const SLOT_OPEN_MS = 180;
/** The landing. Longer than the opening — the end of a gesture is where a settle is readable. */
const SETTLE_MS = 220;
/** How far a landing block spreads sideways before it settles back. */
const SETTLE_STRETCH = 1.03;
/** and how flat it still is at the moment it lands — it was carried squashed. */
const SETTLE_SQUASH = 0.94;
const SHADOW_SELECTOR = '[data-is-dnd-shadow-item-internal]';
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** The global `prefers-reduced-motion` rule in `app.css` cannot reach the Web Animations API, so the
 *  same answer is given here by hand. Read per call: a user may change it while the app is open. */
const motionWanted = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const dragMotion: Action<HTMLElement> = (zone) => {
	/** The gap this zone is currently showing, so a re-consider does not restart its animation. */
	let slot: HTMLElement | null = null;

	/** `tick` first: the event fires before Svelte has rendered the gap, so reading the DOM straight
	 *  from the handler finds nothing on the FIRST consider — which is the one that matters, and the
	 *  one that was silently arriving at full height. A tick resolves before paint, so the gap is
	 *  still caught at zero. */
	async function onConsider(): Promise<void> {
		await tick();
		const next = zone.querySelector<HTMLElement>(SHADOW_SELECTOR);
		if (next === slot) return;
		slot = next;
		if (!slot || !motionWanted()) return;
		const open = `${slot.getBoundingClientRect().height}px`;
		slot.animate(
			[
				{ height: '0px', overflow: 'hidden' },
				{ height: open, overflow: 'hidden' },
			],
			{ duration: SLOT_OPEN_MS, easing: EASE_OUT },
		);
	}

	/** The gap's element BECOMES the dropped row — same id, so Svelte keeps the node — which is why
	 *  the settle plays on the reference kept from the last consider. */
	function onFinalize(): void {
		const landed = slot;
		slot = null;
		if (!landed || !motionWanted()) return;
		landed.animate([{ scale: `${SETTLE_STRETCH} ${SETTLE_SQUASH}` }, { scale: '1 1' }], {
			duration: SETTLE_MS,
			easing: EASE_OUT,
		});
	}

	/** named, so `destroy` can actually take it off again */
	const considerListener = (): void => void onConsider();
	zone.addEventListener('consider', considerListener);
	zone.addEventListener('finalize', onFinalize);
	return {
		destroy() {
			zone.removeEventListener('consider', considerListener);
			zone.removeEventListener('finalize', onFinalize);
		},
	};
};
