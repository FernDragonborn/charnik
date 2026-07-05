import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EyeToggle from './EyeToggle.svelte';

// First real component test — mounts the component in headless Chromium and asserts rendered DOM +
// a click, which the node/logic tests can't reach. One render per test (they share the page).
describe('EyeToggle (browser)', () => {
	it('is aria-pressed=true when on', async () => {
		const screen = render(EyeToggle, { on: true, title: 'Show on sheet' });
		await expect.element(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
	});

	it('is aria-pressed=false when off', async () => {
		const screen = render(EyeToggle, { on: false });
		await expect.element(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
	});

	it('fires onclick when clicked', async () => {
		const onclick = vi.fn();
		const screen = render(EyeToggle, { on: false, onclick });
		await screen.getByRole('button').click();
		expect(onclick).toHaveBeenCalledOnce();
	});
});
