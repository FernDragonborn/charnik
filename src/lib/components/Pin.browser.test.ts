import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Pin from './Pin.svelte';

// The pinned/unpinned difference is now a FILLED vs outline star icon rather than ★/☆ text, so the
// assertion is on what the control reports (aria-pressed) and what the icon draws (fill), not on a
// character that a font may or may not have.
const starFill = (button: HTMLElement) => button.querySelector('svg')?.getAttribute('fill');

describe('Pin (browser)', () => {
	it('reports pressed and fills the star when pinned', async () => {
		const screen = await render(Pin, { on: true });
		const button = screen.getByRole('button');
		await expect.element(button).toHaveAttribute('aria-pressed', 'true');
		expect(starFill(button.element() as HTMLElement)).toBe('currentColor');
	});

	it('reports unpressed and leaves the star hollow when not pinned', async () => {
		const screen = await render(Pin, { on: false });
		const button = screen.getByRole('button');
		await expect.element(button).toHaveAttribute('aria-pressed', 'false');
		expect(starFill(button.element() as HTMLElement)).toBe('none');
	});

	it('fires onclick when clicked', async () => {
		const onclick = vi.fn();
		const screen = await render(Pin, { on: false, onclick });
		await screen.getByRole('button').click();
		expect(onclick).toHaveBeenCalledOnce();
	});
});
