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

/*
 * TOUCH: a drag is TAKEN, not started. A row is a tap target first — it casts, rolls, toggles — so on
 * a finger the two gestures are told apart by time: hold still and the row becomes yours to move.
 * The holding itself is the library's (`delayTouchStart` on each zone), including the part that
 * matters most — it does not `preventDefault` while waiting, so a finger that MOVES is scrolling the
 * page and the drag attempt is dropped. What the library has no opinion about is whether the player
 * can SEE any of that, which is this ring.
 *
 * The first stretch is deliberately silent: a tap is about 100ms, and a ring that flashed under every
 * one of them would be noise on the most common gesture in the app.
 */
/** Silence before the ring appears — long enough that an ordinary tap never draws one. */
const HOLD_QUIET_MS = 150;
/** The ring's fill. It closes exactly as the drag arms, so the ring IS the wait, not a decoration of
 *  it — `delayTouchStart` on every zone must stay HOLD_QUIET_MS + HOLD_FILL_MS. */
const HOLD_FILL_MS = 400;
/** What every zone passes as `delayTouchStart`: the silence plus the fill, so the ring closes at the
 *  exact moment the drag arms. Native long-press is 500ms on both phone platforms and the web cannot
 *  read the machine's own setting for it — there is no API — so this is a number we choose, and one
 *  a player may eventually be given (`work/ui.md` ▸ A11Y-TIMING). */
export const TOUCH_HOLD_MS = HOLD_QUIET_MS + HOLD_FILL_MS;

/** How far a finger may drift and still be holding rather than scrolling. Matched to the library's
 *  own `MIN_MOVEMENT_BEFORE_DRAG_START_PX`: past it, it has already dropped the drag, and a ring that
 *  kept filling would be promising something that is no longer going to happen. */
const HOLD_SLOP_PX = 3;
/** The ring's size and weight. Drawn, not typed, and in rem so it scales with everything else. */
const RING_REM = 2.5;
const RING_STROKE_REM = 0.1875;

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

/** The ONE ring every zone shares — only one finger can be arming a drag at a time, so one exists.
 *  Re-attached rather than assumed present, the same way the provenance popover is. */
let ring: HTMLElement | null = null;

function ringElement(): HTMLElement {
	if (!ring) {
		const size = `${RING_REM}rem`;
		const r = 20 - (RING_STROKE_REM / RING_REM) * 20; // in the viewBox's own units
		const circumference = 2 * Math.PI * r;
		ring = document.createElement('div');
		ring.className = 'drag-hold-ring';
		ring.setAttribute('aria-hidden', 'true');
		ring.style.cssText = `position:fixed;width:${size};height:${size};pointer-events:none;z-index:70`;
		ring.innerHTML =
			`<svg viewBox="0 0 40 40" style="width:100%;height:100%;transform:rotate(-90deg)">` +
			`<circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--color-text-muted)" stroke-opacity="0.25" stroke-width="${(RING_STROKE_REM / RING_REM) * 40}"/>` +
			`<circle class="arc" cx="20" cy="20" r="${r}" fill="none" stroke="var(--color-text)" stroke-opacity="0.55" stroke-width="${(RING_STROKE_REM / RING_REM) * 40}" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"/>` +
			`</svg>`;
	}
	if (!ring.isConnected) document.body.append(ring);
	return ring;
}

function hideRing(): void {
	ring?.remove();
}

/** The touch hold, SHOWN: the ring that says a row is about to become yours to move. Its own
 *  function because it shares nothing with the drag's motion but the zone it watches — and because
 *  the action that hosts both should read as the two things it does. Returns its own teardown. */
function watchTouchHold(zone: HTMLElement): () => void {
	/** Where the finger went down, so drift can be measured against it, and the pending reveal. */
	let holdFrom: { x: number; y: number } | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;

	function endHold(): void {
		clearTimeout(holdTimer);
		holdTimer = undefined;
		holdFrom = null;
		hideRing();
	}

	function reveal(): void {
		const at = holdFrom;
		if (!at) return;
		const el = ringElement();
		const half = el.getBoundingClientRect().width / 2;
		el.style.left = `${at.x - half}px`;
		el.style.top = `${at.y - half}px`;
		// the arc is the WAIT itself, so it is animated even under `prefers-reduced-motion`: that rule
		// covers decoration, and a progress that does not progress says nothing about how long is left.
		// Web Animations is outside the global rule's reach in any case.
		const arc = el.querySelector<SVGCircleElement>('.arc');
		arc?.animate(
			[{ strokeDashoffset: arc.getAttribute('stroke-dasharray') }, { strokeDashoffset: '0' }],
			{ duration: HOLD_FILL_MS, easing: 'linear', fill: 'forwards' },
		);
	}

	function onTouchStart(event: TouchEvent): void {
		const touch = event.touches[0];
		// a second finger is a pinch, not a take
		if (!touch || event.touches.length > 1) return endHold();
		holdFrom = { x: touch.clientX, y: touch.clientY };
		holdTimer = setTimeout(reveal, HOLD_QUIET_MS);
	}

	/** A finger that DRIFTS is scrolling — the library has already dropped the drag by the same
	 *  measure, so the ring goes with it rather than promising a take that will not happen. */
	function onTouchMove(event: TouchEvent): void {
		const touch = event.touches[0];
		if (!holdFrom || !touch) return;
		const drifted =
			Math.abs(touch.clientX - holdFrom.x) >= HOLD_SLOP_PX ||
			Math.abs(touch.clientY - holdFrom.y) >= HOLD_SLOP_PX;
		if (drifted) endHold();
	}

	// CAPTURE, and it is not optional: the library's own `touchstart` sits on the draggable ITEM and
	// calls `stopPropagation`, so a listener waiting on the way back up is never reached at all.
	const phase = { passive: true, capture: true } as const;
	zone.addEventListener('touchstart', onTouchStart, phase);
	zone.addEventListener('touchmove', onTouchMove, phase);
	zone.addEventListener('touchend', endHold, phase);
	zone.addEventListener('touchcancel', endHold, phase);
	return () => {
		endHold();
		zone.removeEventListener('touchstart', onTouchStart, phase);
		zone.removeEventListener('touchmove', onTouchMove, phase);
		zone.removeEventListener('touchend', endHold, phase);
		zone.removeEventListener('touchcancel', endHold, phase);
	};
}

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
	const unwatchHold = watchTouchHold(zone);
	zone.addEventListener('consider', considerListener);
	zone.addEventListener('finalize', onFinalize);
	return {
		destroy() {
			unwatchHold();
			zone.removeEventListener('consider', considerListener);
			zone.removeEventListener('finalize', onFinalize);
		},
	};
};
