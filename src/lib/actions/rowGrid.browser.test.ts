import { describe, it, expect, afterEach } from 'vitest';
import { rowGrid } from './rowGrid';

/** Three rows the way a panel draws them: a grip, a name that is the row's act, a pin. */
function mountList(): HTMLElement {
	const list = document.createElement('div');
	list.innerHTML = ['Fire Bolt', 'Shield', 'Fireball']
		.map(
			(name) => `<div class="spell-row">
				<span class="row-grip" tabindex="0" role="button">⋮</span>
				<button class="name">${name}</button>
				<button class="pin">☆</button>
			</div>`,
		)
		.join('');
	document.body.append(list);
	return list;
}
const press = (code: string, extra: KeyboardEventInit = {}) =>
	document.activeElement?.dispatchEvent(
		new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra }),
	);
const focused = () => document.activeElement?.textContent?.trim();
const stops = (list: HTMLElement) =>
	[...list.querySelectorAll<HTMLElement>('[data-grid-cell]')].filter((el) => el.tabIndex === 0);

describe('rowGrid (work/ui.md ▸ KEYBOARD-NAV: a row is one Tab stop)', () => {
	let cleanup: (() => void) | undefined;
	afterEach(() => {
		cleanup?.();
		document.body.innerHTML = '';
	});

	it('leaves ONE Tab stop in the whole list', () => {
		const list = mountList();
		cleanup = rowGrid(list, '.spell-row')?.destroy;
		expect(stops(list)).toHaveLength(1);
	});

	it('hands the Tab stop to a visible row when its category closes', async () => {
		const list = mountList();
		const firstRow = list.firstElementChild;
		if (!firstRow) throw new Error('The list must have a first row');
		const category = document.createElement('details');
		category.open = true;
		category.append(document.createElement('summary'), firstRow);
		list.prepend(category);
		cleanup = rowGrid(list, '.spell-row')?.destroy;
		firstRow.querySelector('button')?.focus();
		category.open = false;
		await expect.poll(() => stops(list)[0]?.closest('.spell-row')?.textContent).toContain('Shield');
		expect(stops(list)).toHaveLength(1);
	});

	it('walks rows on ↑/↓ keeping the column, and cells on ←/→', () => {
		const list = mountList();
		cleanup = rowGrid(list, '.spell-row')?.destroy;
		list.querySelector<HTMLElement>('.name')?.focus();
		press('ArrowDown');
		expect(focused()).toBe('Shield');
		press('ArrowRight');
		expect(focused()).toBe('☆');
		press('ArrowDown');
		expect(document.activeElement?.closest('.spell-row')?.textContent).toContain('Fireball');
		expect(focused()).toBe('☆');
		press('Home');
		expect(focused()).toBe('⋮');
		press('Home', { ctrlKey: true });
		expect(document.activeElement?.closest('.spell-row')?.textContent).toContain('Fire Bolt');
		expect(stops(list)).toHaveLength(1);
	});

	it('remembers where it stood: Tab back into the list lands on the last cell used', () => {
		const list = mountList();
		cleanup = rowGrid(list, '.spell-row')?.destroy;
		const shieldPin = list.querySelectorAll<HTMLElement>('.pin')[1];
		shieldPin?.focus();
		expect(stops(list)).toEqual([shieldPin]);
	});

	it('leaves a key to a control that answered it itself, as a grip moving its row does', () => {
		const list = mountList();
		cleanup = rowGrid(list, '.spell-row')?.destroy;
		const grip = list.querySelector<HTMLElement>('.row-grip');
		grip?.addEventListener('keydown', (e) => e.preventDefault());
		grip?.focus();
		press('ArrowDown');
		expect(document.activeElement).toBe(grip);
	});
});
