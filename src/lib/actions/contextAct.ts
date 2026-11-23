import type { Action } from 'svelte/action';

/**
 * A row's secondary menu, reached the ways a desktop reaches one (`work/play-layout.md` ▸ ROW-MENU):
 * a right click — which takes the browser's own context menu's place on that row, the maintainer's
 * call — and, from the keyboard, the context-menu key or Shift+F10 on the row or anything in it.
 * The event handed on has the row as its `currentTarget`, so the menu anchors under the row.
 */
export const contextAct: Action<HTMLElement, (event: Event) => void> = (node, initial) => {
	let open = initial;
	const onContextMenu = (event: MouseEvent) => {
		event.preventDefault();
		open(event);
	};
	const onKeydown = (event: KeyboardEvent) => {
		const asked = event.code === 'ContextMenu' || (event.code === 'F10' && event.shiftKey);
		if (!asked) return;
		event.preventDefault();
		open(event);
	};
	node.addEventListener('contextmenu', onContextMenu);
	node.addEventListener('keydown', onKeydown);
	return {
		update(next) {
			open = next;
		},
		destroy() {
			node.removeEventListener('contextmenu', onContextMenu);
			node.removeEventListener('keydown', onKeydown);
		},
	};
};
