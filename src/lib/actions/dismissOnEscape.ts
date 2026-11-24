import type { Action } from 'svelte/action';

const escapeLayers: { handler: (() => void) | undefined }[] = [];

/**
 * Call `onEscape` when the Escape key is pressed while the node is mounted (AUDIT F8) — the one home
 * for the `<svelte:window onkeydown>` + Escape-check every attention dialog hand-wrote. Applied to
 * the dialog root, so the listener lives exactly as long as the dialog is open. `preventDefault` is
 * called so Escape doesn't also trip a parent handler. Reactive: pass a new closure and it's used.
 *
 * NOT for dialogs with richer key handling (CommandPalette's arrows) — those keep their own handler.
 * Passing `undefined` is the must-acknowledge case: the action stays inert, so a modal that refuses
 * Escape (DataMigrationDialog) needs no second code path.
 */
export const dismissOnEscape: Action<HTMLElement, (() => void) | undefined> = (_node, onEscape) => {
	const layer = { handler: onEscape };
	escapeLayers.push(layer);
	const onKeydown = (e: KeyboardEvent) => {
		if (
			e.key === 'Escape' &&
			!e.defaultPrevented &&
			escapeLayers.at(-1) === layer &&
			layer.handler
		) {
			e.preventDefault();
			layer.handler();
		}
	};
	window.addEventListener('keydown', onKeydown);
	return {
		update(next: (() => void) | undefined) {
			layer.handler = next;
		},
		destroy() {
			escapeLayers.splice(escapeLayers.indexOf(layer), 1);
			window.removeEventListener('keydown', onKeydown);
		},
	};
};
