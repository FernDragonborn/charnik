import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provenance } from './provenance';

/** A value on the page, as any sheet renders one: a plain element, not a control. */
function mountValue(): HTMLElement {
	const node = document.createElement('div');
	node.textContent = '15';
	document.body.append(node);
	return node;
}

const popover = () => document.querySelector('.provenance-popover');
const isOpen = () => popover()?.classList.contains('is-open') === true;
const enter = (node: HTMLElement) => node.dispatchEvent(new Event('pointerenter'));
const leave = (node: HTMLElement) => node.dispatchEvent(new Event('pointerleave'));
const escape = (node: HTMLElement) =>
	node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('provenance (ui.md ▸ UX pattern contract, rule 3)', () => {
	let cleanup: (() => void) | undefined;
	beforeEach(() => {
		document.body.innerHTML = '';
	});
	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
	});

	it('makes the value focusable and describes it, so a keyboard reaches the breakdown', () => {
		const node = mountValue();
		cleanup = provenance(node, 'Armor +11, DEX +1')?.destroy;
		expect(node.tabIndex).toBe(0);
		const description = document.getElementById(node.getAttribute('aria-describedby') ?? '');
		expect(description?.textContent).toBe('Armor +11, DEX +1');
	});

	it('shows on hover AND on focus — the half `title` could never do', () => {
		const node = mountValue();
		cleanup = provenance(node, 'Armor +11')?.destroy;

		enter(node);
		expect(isOpen()).toBe(true);
		expect(popover()?.textContent).toBe('Armor +11');
		leave(node);
		expect(isOpen()).toBe(false);

		node.focus();
		expect(isOpen()).toBe(true);
		node.blur();
		expect(isOpen()).toBe(false);
	});

	it('Escape dismisses a popover that is in the way, without moving focus', () => {
		const node = mountValue();
		cleanup = provenance(node, 'Armor +11')?.destroy;
		node.focus();
		expect(isOpen()).toBe(true);
		escape(node);
		expect(isOpen()).toBe(false);
		expect(document.activeElement).toBe(node);
	});

	it('empty provenance is no provenance: no tab stop, no description, nothing to open', () => {
		const node = mountValue();
		const handle = provenance(node, '');
		cleanup = handle?.destroy;
		expect(node.hasAttribute('tabindex')).toBe(false);
		expect(node.hasAttribute('aria-describedby')).toBe(false);
		enter(node);
		expect(isOpen()).toBe(false);

		// the sheet that explains the value can arrive after the value does
		handle?.update?.('Base +10');
		expect(node.tabIndex).toBe(0);
		enter(node);
		expect(isOpen()).toBe(true);
	});

	it('leaves a control the tab stop it already had, and gives back what it took', () => {
		const button = document.createElement('button');
		document.body.append(button);
		const handle = provenance(button, 'Armor +11');
		expect(button.hasAttribute('tabindex')).toBe(false); // a button is already reachable

		const node = mountValue();
		const own = provenance(node, 'Armor +11');
		own?.destroy?.();
		expect(node.hasAttribute('tabindex')).toBe(false);
		expect(node.hasAttribute('aria-describedby')).toBe(false);
		handle?.destroy?.();
	});
});
