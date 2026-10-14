import type { Action } from 'svelte/action';

/** Input types where Enter means nothing of their own, so it can mean "do it". */
const TYPED_FIELD = new Set(['text', 'number', 'search', 'url', 'email', 'tel', 'password']);

/**
 * Enter in a one-line field inside `node` does what the context's main button does (ui.md ▸ rule
 * 19) — one home for what each panel would otherwise hand-write per field. On the panel, not on each
 * field, so a field added later is covered without remembering. A field that handled Enter itself
 * (its own menu, its own completion) calls `preventDefault` and is left alone, and a `<textarea>`
 * keeps Enter for the newline. Passing `undefined` leaves the action inert, for a main act that is
 * not available right now.
 */
export const submitOnEnter: Action<HTMLElement, (() => void) | undefined> = (node, onSubmit) => {
	let submit = onSubmit;
	const onKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || !submit) return;
		if (!(e.target instanceof HTMLInputElement) || !TYPED_FIELD.has(e.target.type)) return;
		e.preventDefault();
		submit();
	};
	node.addEventListener('keydown', onKeydown);
	return {
		update(next: (() => void) | undefined) {
			submit = next;
		},
		destroy() {
			node.removeEventListener('keydown', onKeydown);
		},
	};
};
