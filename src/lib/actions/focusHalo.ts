import type { Action } from 'svelte/action';

/** The key that answers a focused button, as the keyboard prints it. */
export interface FocusHaloWords {
	enterKey: string;
}

const HALO = 'focus-halo';
const KEY = 'focus-key';
const SHOWN = 'focusShown';
const ARROWS = new Set(['ArrowLeft', 'ArrowRight']);

/**
 * A dialog's answers carry their focus as a soft halo that TRAVELS between them, with the key that
 * presses the focused one under it — shown from the moment the dialog opens, because it says where
 * Enter goes, and a halo that moves reads as "you are here" where a still ring reads as the
 * button's own look (`docs/internals/ui.md` ▸ Accessibility). The left and right arrows walk the
 * answers in the order they stand on screen, so a right-to-left layout needs nothing of its own.
 *
 * Applied to the dialog root; it marks the `.dialog-foot` a focused button sits in, whichever footer
 * the dialog shows at that moment. Focus elsewhere in the dialog — a search box, a list — takes the
 * marks away and leaves that control its ordinary ring.
 */
export const focusHalo: Action<HTMLElement, FocusHaloWords> = (node, words) => {
	let enterKey = words.enterKey;

	const marksIn = (footer: HTMLElement): { halo: HTMLElement; key: HTMLElement } => {
		const found = (name: string): HTMLElement => {
			const held = footer.querySelector<HTMLElement>(`:scope > .${name}`);
			if (held) return held;
			const made = document.createElement('span');
			made.className = name;
			made.setAttribute('aria-hidden', 'true');
			footer.prepend(made);
			return made;
		};
		return { halo: found(HALO), key: found(KEY) };
	};

	const answerOf = (element: Element | null): HTMLButtonElement | null =>
		element instanceof HTMLButtonElement && element.closest('.dialog-foot') ? element : null;

	const hideAll = (): void => {
		for (const footer of node.querySelectorAll<HTMLElement>('.dialog-foot'))
			delete footer.dataset[SHOWN];
	};

	const show = (): void => {
		const focused = answerOf(document.activeElement);
		if (!focused || !node.contains(focused)) {
			// the app losing the focus to another window keeps the mark: back here, Enter is the same
			if (document.hasFocus()) hideAll();
			return;
		}
		const footer = focused.closest<HTMLElement>('.dialog-foot');
		if (!footer) return;
		hideAll();
		const { halo, key } = marksIn(footer);
		key.textContent = enterKey;
		// measured against the footer itself, whatever wraps the button inside it
		const box = footer.getBoundingClientRect();
		const at = focused.getBoundingClientRect();
		for (const mark of [halo, key]) {
			mark.style.left = `${at.left - box.left}px`;
			mark.style.width = `${at.width}px`;
		}
		halo.style.top = `${at.top - box.top}px`;
		halo.style.height = `${at.height}px`;
		key.style.top = `${at.bottom - box.top}px`;
		footer.dataset[SHOWN] = '';
	};

	const walk = (event: KeyboardEvent): void => {
		if (!ARROWS.has(event.code)) return;
		const focused = answerOf(document.activeElement);
		const footer = focused?.closest<HTMLElement>('.dialog-foot');
		if (!focused || !footer) return;
		const answers = [...footer.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].sort(
			(a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
		);
		const at = answers.indexOf(focused);
		const next = answers[at + (event.code === 'ArrowRight' ? 1 : -1)];
		if (!next) return;
		event.preventDefault();
		next.focus();
	};

	const later = (): void => {
		requestAnimationFrame(show);
	};
	node.addEventListener('focusin', show);
	node.addEventListener('focusout', later);
	node.addEventListener('keydown', walk);
	// the dialog's own first focus lands before this action runs
	later();
	return {
		update(next) {
			enterKey = next.enterKey;
			show();
		},
		destroy() {
			node.removeEventListener('focusin', show);
			node.removeEventListener('focusout', later);
			node.removeEventListener('keydown', walk);
		},
	};
};
