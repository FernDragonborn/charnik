import { describe, it, expect } from 'vitest';
import { dragMotion } from './dragMotion';

/*
 * The touch hold, as the player experiences it: quiet at first, then a ring that fills, and nothing
 * at all if the finger was scrolling. Driven with synthesised `TouchEvent`s, which is what the action
 * reads — the ARMING itself is the library's `delayTouchStart` and is not re-tested here.
 *
 * In the browser project rather than node: the ring is measured off computed style, and a Web
 * Animation only advances in a real compositor.
 */
const ring = () => document.querySelector('.drag-hold-ring');
const filledPercent = (): number | null => {
	const arc = ring()?.querySelector('.arc');
	if (!arc) return null;
	const style = getComputedStyle(arc);
	const dash = parseFloat(style.strokeDasharray);
	return Math.round((1 - parseFloat(style.strokeDashoffset) / dash) * 100);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function zoneWithARow(): { zone: HTMLElement; row: HTMLElement; destroy: () => void } {
	const zone = document.createElement('div');
	const row = document.createElement('div');
	row.style.cssText = 'height:40px';
	// what `svelte-dnd-action` does to every draggable item: its own touchstart handler stops the
	// event dead, so a zone listener that waited for it to bubble would never run. The action listens
	// on the way DOWN, and this is what proves it still does.
	row.addEventListener('touchstart', (event) => event.stopPropagation());
	zone.append(row);
	document.body.append(zone);
	const action = dragMotion(zone);
	return {
		zone,
		row,
		destroy: () => {
			action?.destroy?.();
			zone.remove();
			ring()?.remove();
		},
	};
}

const touchAt = (row: HTMLElement, x: number, y: number) =>
	new Touch({ identifier: 1, target: row, clientX: x, clientY: y });
const fire = (row: HTMLElement, type: string, touches: Touch[]) =>
	row.dispatchEvent(
		new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches: touches }),
	);

describe('dragMotion · the touch hold is shown', () => {
	it('says nothing for the length of an ordinary tap, then fills and stays put', async () => {
		const { row, destroy } = zoneWithARow();
		try {
			fire(row, 'touchstart', [touchAt(row, 100, 100)]);
			await wait(90);
			expect(ring(), 'a tap must never draw one').toBeNull();
			await wait(160);
			const early = filledPercent();
			expect(early, 'the ring is up once the quiet is over').not.toBeNull();
			expect(early).toBeLessThan(80);
			await wait(320);
			expect(filledPercent(), 'and closed by the time the drag arms').toBeGreaterThan(90);
			fire(row, 'touchend', []);
			await wait(40);
			expect(ring(), 'lifting takes it away').toBeNull();
		} finally {
			destroy();
		}
	});

	it('gives up the moment the finger drifts — that gesture is a scroll', async () => {
		const { row, destroy } = zoneWithARow();
		try {
			fire(row, 'touchstart', [touchAt(row, 100, 100)]);
			await wait(250);
			expect(filledPercent(), 'filling while the finger is still').not.toBeNull();
			fire(row, 'touchmove', [touchAt(row, 100, 80)]);
			await wait(40);
			expect(ring(), 'and gone once it moves').toBeNull();
		} finally {
			destroy();
		}
	});

	it('ignores a second finger, which is a pinch and not a take', async () => {
		const { row, destroy } = zoneWithARow();
		try {
			fire(row, 'touchstart', [touchAt(row, 100, 100), touchAt(row, 140, 140)]);
			await wait(250);
			expect(ring()).toBeNull();
		} finally {
			destroy();
		}
	});
});
