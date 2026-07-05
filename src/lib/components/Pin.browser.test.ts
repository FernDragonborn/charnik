import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Pin from './Pin.svelte';

describe('Pin (browser)', () => {
	it('shows a filled star when pinned', async () => {
		const screen = render(Pin, { on: true });
		await expect.element(screen.getByRole('button')).toHaveTextContent('★');
	});

	it('shows a hollow star when not pinned', async () => {
		const screen = render(Pin, { on: false });
		await expect.element(screen.getByRole('button')).toHaveTextContent('☆');
	});

	it('fires onclick when clicked', async () => {
		const onclick = vi.fn();
		const screen = render(Pin, { on: false, onclick });
		await screen.getByRole('button').click();
		expect(onclick).toHaveBeenCalledOnce();
	});
});
