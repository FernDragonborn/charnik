/**
 * Move a floating element to `document.body` for as long as it lives.
 *
 * A `position: fixed` box is laid out against the viewport — UNLESS an ancestor carries a transform,
 * which makes that ancestor the containing block instead. Every dialog in the app centres itself with
 * `translate(-50%, -50%)`, so anything fixed rendered inside one silently switches coordinate spaces:
 * the geometry still computes viewport numbers and the element lands somewhere else entirely. It
 * showed as a picker card hanging off the bottom of the window when the picker was opened from
 * combat's add-item dialog.
 *
 * The same reasoning already puts the provenance popover in the body (`styles/components.css`).
 */
export function floatInBody(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}
