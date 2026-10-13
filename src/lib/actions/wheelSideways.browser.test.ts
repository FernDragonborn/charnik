import { describe, it, expect, beforeEach } from 'vitest';
import { wheelSideways } from './wheelSideways';

/** A rail `width` wide holding `content` of chips, with the action on it. */
function rail(width: number, content: number, dir = 'ltr'): HTMLElement {
	const node = document.createElement('div');
	node.dir = dir;
	node.style.cssText = `display:flex;overflow-x:auto;width:${width}px`;
	const chips = document.createElement('div');
	chips.style.cssText = `flex:none;width:${content}px;height:20px`;
	node.append(chips);
	document.body.append(node);
	wheelSideways(node);
	return node;
}

/** Turn the wheel over a rail; false when the rail took the turn for itself. */
const turn = (node: HTMLElement, init: WheelEventInit): boolean =>
	node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));

describe('wheelSideways', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('moves an overflowing rail with a plain wheel turn, and keeps the turn from the page', () => {
		const node = rail(100, 400);
		expect(turn(node, { deltaY: 120 })).toBe(false);
		expect(node.scrollLeft).toBe(120);
		turn(node, { deltaY: -50 });
		expect(node.scrollLeft).toBe(70);
	});

	it('moves towards the end of a right-to-left rail', () => {
		const node = rail(100, 400, 'rtl');
		turn(node, { deltaY: 120 });
		expect(node.scrollLeft).toBe(-120);
	});

	it('leaves a rail that fits, and a gesture that is already sideways, to the browser', () => {
		expect(turn(rail(400, 100), { deltaY: 120 })).toBe(true);
		const node = rail(100, 400);
		expect(turn(node, { deltaY: 120, shiftKey: true })).toBe(true);
		expect(turn(node, { deltaX: 40, deltaY: 3 })).toBe(true);
		expect(node.scrollLeft).toBe(0);
	});
});
