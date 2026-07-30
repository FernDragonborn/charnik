import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trapFocus } from './trapFocus';

// A dialog with three buttons (first/mid/last) + an outside button focus must never reach via Tab.
function mount(): {
	node: HTMLElement;
	first: HTMLButtonElement;
	last: HTMLButtonElement;
	outside: HTMLButtonElement;
} {
	const outside = document.createElement('button');
	outside.textContent = 'outside';
	document.body.append(outside);
	outside.focus(); // pretend this triggered the dialog

	const node = document.createElement('div');
	node.tabIndex = -1;
	const button = (label: string) => {
		const b = document.createElement('button');
		b.textContent = label;
		node.append(b);
		return b;
	};
	const first = button('a');
	button('b');
	const last = button('c');
	document.body.append(node);
	return { node, first, last, outside };
}

const tab = (node: HTMLElement, shiftKey = false) =>
	node.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
	);

describe('trapFocus (AUDIT F8)', () => {
	let cleanup: (() => void) | undefined;
	beforeEach(() => {
		document.body.innerHTML = '';
	});
	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
	});

	it('moves focus into the dialog on mount', () => {
		const { node, first } = mount();
		cleanup = trapFocus(node)?.destroy;
		expect(document.activeElement).toBe(first);
	});

	it('wraps Shift+Tab off the first element to the last', () => {
		const { node, first, last } = mount();
		cleanup = trapFocus(node)?.destroy;
		first.focus();
		tab(node, true);
		expect(document.activeElement).toBe(last);
	});

	it('wraps Tab off the last element to the first', () => {
		const { node, first, last } = mount();
		cleanup = trapFocus(node)?.destroy;
		last.focus();
		tab(node, false);
		expect(document.activeElement).toBe(first);
	});

	it('restores focus to the previously-focused element on destroy', () => {
		const { node, outside } = mount();
		const handle = trapFocus(node);
		handle?.destroy?.();
		expect(document.activeElement).toBe(outside);
	});
});
