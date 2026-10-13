import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { anchored } from './anchored';

/** A fixed box of a given size at a given place — a control, or the surface that opens from it. */
function box(style: Partial<CSSStyleDeclaration>): HTMLElement {
	const node = document.createElement('div');
	Object.assign(node.style, { position: 'fixed', ...style });
	document.body.append(node);
	return node;
}
const press = (target: Element) =>
	target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
const at = (node: HTMLElement) => ({
	top: parseFloat(node.style.top),
	left: parseFloat(node.style.left),
});

describe('anchored (ui.md ▸ a step inside a panel is a popover)', () => {
	let cleanup: (() => void) | undefined;
	beforeEach(() => {
		document.body.innerHTML = '';
	});
	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
	});

	it('opens just below its control, right edges aligned', () => {
		const anchor = box({ top: '100px', left: '300px', width: '40px', height: '20px' });
		const surface = box({ width: '200px', height: '80px' });
		cleanup = anchored(surface, { anchor, onclose: () => {} })?.destroy;
		expect(at(surface)).toEqual({ top: 126, left: 140 });
	});

	it('opens above the control when there is no room below, and never off the left edge', () => {
		const bottom = window.innerHeight - 30;
		const anchor = box({ top: `${bottom}px`, left: '20px', width: '40px', height: '20px' });
		const surface = box({ width: '200px', height: '80px' });
		cleanup = anchored(surface, { anchor, onclose: () => {} })?.destroy;
		expect(at(surface)).toEqual({ top: bottom - 80 - 6, left: 8 });
	});

	it('stays on the side it opened on: a scroll inside it moves nothing, a scroll outside carries it', () => {
		const bottom = window.innerHeight - 30;
		const anchor = box({ top: `${bottom}px`, left: '300px', width: '40px', height: '20px' });
		const surface = box({ width: '200px', height: '80px' });
		const list = document.createElement('div');
		surface.append(list);
		cleanup = anchored(surface, { anchor, onclose: () => {} })?.destroy;
		const above = { top: bottom - 80 - 6, left: 140 };
		expect(at(surface)).toEqual(above);

		list.dispatchEvent(new Event('scroll'));
		expect(at(surface)).toEqual(above);

		// the page scrolls and the control moves up with it: the surface goes too, still above
		anchor.style.top = `${bottom - 50}px`;
		document.dispatchEvent(new Event('scroll'));
		expect(at(surface)).toEqual({ top: above.top - 50, left: 140 });
	});

	it('closes on a press outside, and not on one inside, on its control or on a companion', () => {
		const anchor = box({ top: '100px', left: '300px', width: '40px', height: '20px' });
		const surface = box({ width: '200px', height: '80px' });
		const companion = box({ top: '0px', left: '0px', width: '10px', height: '10px' });
		companion.className = 'picker-card';
		const elsewhere = box({ top: '400px', left: '400px', width: '10px', height: '10px' });
		const onclose = vi.fn();
		cleanup = anchored(surface, { anchor, onclose, companions: '.picker-card' })?.destroy;

		press(surface);
		press(anchor);
		press(companion);
		expect(onclose).not.toHaveBeenCalled();
		press(elsewhere);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('stops listening once it is gone', () => {
		const anchor = box({ top: '100px', left: '300px', width: '40px', height: '20px' });
		const surface = box({ width: '200px', height: '80px' });
		const onclose = vi.fn();
		anchored(surface, { anchor, onclose })?.destroy?.();
		press(document.body);
		expect(onclose).not.toHaveBeenCalled();
	});
});
