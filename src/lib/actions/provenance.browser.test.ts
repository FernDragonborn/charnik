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

	it('a focused value below the fold keeps the popover its own scroll-into-view would close', async () => {
		const spacer = document.createElement('div');
		spacer.style.height = `${window.innerHeight * 3}px`;
		document.body.append(spacer);
		const node = mountValue();
		cleanup = provenance(node, 'Armor +11')?.destroy;

		const scrolled = new Promise((resolve) =>
			window.addEventListener('scroll', resolve, { once: true }),
		);
		node.focus();
		await scrolled;
		expect(window.scrollY).toBeGreaterThan(0);
		expect(isOpen()).toBe(true);
		// it followed the value rather than standing where the value was before the scroll
		const tip = popover()?.getBoundingClientRect();
		const at = node.getBoundingClientRect();
		expect(
			Math.abs((tip?.bottom ?? 0) - at.top) < 12 || Math.abs((tip?.top ?? 0) - at.bottom) < 12,
		).toBe(true);

		// scrolled off screen, there is nothing left for it to stand beside
		const away = new Promise((resolve) =>
			window.addEventListener('scroll', resolve, { once: true }),
		);
		window.scrollTo(0, 0);
		await away;
		expect(isOpen()).toBe(false);
	});

	it('a hovered value closes on scroll: the pointer no longer rests on it', async () => {
		const spacer = document.createElement('div');
		spacer.style.height = `${window.innerHeight * 3}px`;
		const node = mountValue();
		document.body.append(spacer);
		cleanup = provenance(node, 'Armor +11')?.destroy;
		enter(node);
		expect(isOpen()).toBe(true);
		const scrolled = new Promise((resolve) =>
			window.addEventListener('scroll', resolve, { once: true }),
		);
		window.scrollTo(0, 40);
		await scrolled;
		expect(isOpen()).toBe(false);
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
