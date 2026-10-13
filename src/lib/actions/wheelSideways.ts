/**
 * A rail that overflows sideways scrolls with the wheel a mouse has. A browser sends a plain wheel
 * turn down the page — past a rail that only scrolls sideways — so a strip of chips wider than its
 * pane could be moved by a trackpad, or by dragging its scrollbar, and by nothing a mouse user
 * reaches for first.
 *
 * A gesture that is already sideways (a trackpad, Shift + wheel) is left to the browser, and so is
 * a rail that fits. The listener is not passive, because the turn must not also scroll whatever is
 * under the rail.
 */
const LINE_PX = 16;

export function wheelSideways(node: HTMLElement) {
	const onWheel = (e: WheelEvent): void => {
		if (e.deltaY === 0 || e.deltaX !== 0 || e.shiftKey || e.ctrlKey) return;
		if (node.scrollWidth <= node.clientWidth) return;
		const turned = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * LINE_PX : e.deltaY;
		// scrolling "down" moves towards the END of the rail, which is the left in a right-to-left one
		const towardsEnd = getComputedStyle(node).direction === 'rtl' ? -1 : 1;
		node.scrollLeft += turned * towardsEnd;
		e.preventDefault();
	};
	node.addEventListener('wheel', onWheel, { passive: false });
	return { destroy: () => node.removeEventListener('wheel', onWheel) };
}
