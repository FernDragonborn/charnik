import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Switch from './Switch.svelte';

describe('Switch (browser)', () => {
	it('reflects the on state and fires onclick', async () => {
		const onclick = vi.fn();
		const screen = render(Switch, { on: true, onclick });
		const btn = screen.getByRole('button');
		await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
		await btn.click();
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('is disabled and unclickable when locked', async () => {
		const onclick = vi.fn();
		const screen = render(Switch, { on: true, lock: true, onclick });
		const btn = screen.getByRole('button');
		await expect.element(btn).toBeDisabled();
		await btn.click({ force: true }).catch(() => {}); // disabled → no handler
		expect(onclick).not.toHaveBeenCalled();
	});
});
