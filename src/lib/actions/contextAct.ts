import type { Action } from 'svelte/action';
import { touchHoldDrifted, TOUCH_HOLD_MS } from './dragMotion';

interface ContextActOptions {
	open: (event: Event) => void;
	touch: boolean;
}

const ROW_HOLD = 'charnik:row-hold';
const TOUCH_POINTER = 'touch';

/**
 * A row's secondary menu. All entry paths deliver an event with the same row as its
 * `currentTarget`, so the menu can anchor to it and return focus to the control inside it.
 */
export const contextAct: Action<HTMLElement, ContextActOptions> = (node, options) => {
	let gesture: AbortController | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let held = false;

	function finish(): void {
		gesture?.abort();
		gesture = undefined;
		clearTimeout(timer);
		held = false;
	}

	function onTouchStart(event: TouchEvent): void {
		const finger = event.touches[0];
		if (!options.touch || !finger || event.touches.length !== 1) return;
		finish();
		const target = event.target;
		if (!(target instanceof Element)) return;
		gesture = new AbortController();
		const phase = { capture: true, signal: gesture.signal };
		const doc = node.ownerDocument;
		// Observe outside the row too, so starting a pinch with a finger elsewhere cancels the hold.
		doc.addEventListener(
			'touchstart',
			(next) => {
				if (!held && next.touches.length > 1) finish();
			},
			phase,
		);
		doc.addEventListener(
			'touchmove',
			(move) => {
				const moving = move.touches[0];
				if (!held && moving && touchHoldDrifted(finger, moving)) finish();
			},
			{ ...phase, passive: true },
		);
		doc.addEventListener('touchcancel', finish, phase);
		doc.addEventListener(
			'touchend',
			(end) => {
				if (Array.from(end.touches).some((touch) => touch.identifier === finger.identifier)) return;
				// A completed hold consumes the release, so it cannot also cast, roll or use the row.
				if (held) end.preventDefault();
				finish();
			},
			{ ...phase, passive: false },
		);
		timer = setTimeout(() => {
			if (!options.touch || !node.contains(target)) return finish();
			held = true;
			target.dispatchEvent(new Event(ROW_HOLD, { bubbles: true }));
		}, TOUCH_HOLD_MS);
	}

	const onContextMenu = (event: MouseEvent) => {
		event.preventDefault();
		if (gesture || (event instanceof PointerEvent && event.pointerType === TOUCH_POINTER)) return;
		options.open(event);
	};
	const onKeydown = (event: KeyboardEvent) => {
		const asked = event.code === 'ContextMenu' || (event.code === 'F10' && event.shiftKey);
		if (!asked) return;
		event.preventDefault();
		options.open(event);
	};
	const onHold = (event: Event) => options.open(event);
	node.addEventListener('contextmenu', onContextMenu);
	node.addEventListener('keydown', onKeydown);
	node.addEventListener('touchstart', onTouchStart, { passive: true });
	node.addEventListener(ROW_HOLD, onHold);
	return {
		update(next) {
			options = next;
		},
		destroy() {
			finish();
			node.removeEventListener('contextmenu', onContextMenu);
			node.removeEventListener('keydown', onKeydown);
			node.removeEventListener('touchstart', onTouchStart);
			node.removeEventListener(ROW_HOLD, onHold);
		},
	};
};
