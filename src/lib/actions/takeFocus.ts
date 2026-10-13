import { tick } from 'svelte';
import type { Action } from 'svelte/action';

/**
 * Put the caret in a field the moment it appears, with what it holds selected so the first key
 * typed replaces it.
 *
 * `autofocus` is not this: on an element added to a live page it only takes focus when nothing else
 * has it, and a popover is opened by a press — so the focus is on the button that opened it, and
 * the field the popover exists for sits unfocused one click away.
 */
export const takeFocus: Action<HTMLInputElement> = (node) => {
	node.focus();
	// once the field holds its value: an action runs before a `bind:value` beside it has written
	void tick().then(() => node.select());
};
