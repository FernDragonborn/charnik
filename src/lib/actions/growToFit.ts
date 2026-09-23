import type { Action } from 'svelte/action';

/**
 * Open a textarea at the height of the text already in it, and keep it there as that text changes —
 * so a rewrite of a long description starts fully visible instead of in a guessed box the reader has
 * to drag open before they can read what they are editing.
 *
 * A manual drag still wins, permanently: the browser writes the dragged size as an inline height,
 * which no longer matches the one this action last set, and that mismatch is the signal to stop
 * touching it. So `resize` stays useful rather than being fought on every keystroke.
 */
export const growToFit: Action<HTMLTextAreaElement> = (node) => {
	let ours = '';
	const fit = () => {
		if (node.style.height && node.style.height !== ours) return;
		node.style.height = 'auto';
		ours = `${node.scrollHeight}px`;
		node.style.height = ours;
	};
	fit();
	node.addEventListener('input', fit);
	return {
		destroy() {
			node.removeEventListener('input', fit);
		},
	};
};
