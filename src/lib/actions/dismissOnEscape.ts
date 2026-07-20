import type { Action } from 'svelte/action';

/**
 * Call `onEscape` when the Escape key is pressed while the node is mounted (AUDIT F8) — the one home
 * for the `<svelte:window onkeydown>` + Escape-check every attention dialog hand-wrote. Applied to
 * the dialog root, so the listener lives exactly as long as the dialog is open. `preventDefault` is
 * called so Escape doesn't also trip a parent handler. Reactive: pass a new closure and it's used.
 *
 * NOT for dialogs with richer key handling (CommandPalette's arrows) or a must-acknowledge modal
 * that deliberately refuses Escape (DataMigrationDialog) — those keep their own handler.
 */
export const dismissOnEscape: Action<HTMLElement, () => void> = (_node, onEscape) => {
	let handler = onEscape;
	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			handler();
		}
	};
	window.addEventListener('keydown', onKeydown);
	return {
		update(next: () => void) {
			handler = next;
		},
		destroy() {
			window.removeEventListener('keydown', onKeydown);
		}
	};
};
