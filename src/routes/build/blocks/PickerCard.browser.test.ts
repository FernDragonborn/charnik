import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { startI18n } from '$lib/i18n';
import PickerCard from './PickerCard.svelte';

beforeAll(() => startI18n('en'));

async function card(taken: boolean, blocked: string | null = null) {
	const picker = document.createElement('div');
	const ontake = vi.fn();
	await render(PickerCard, {
		picker,
		entryId: 'test-entry',
		title: 'Test entry',
		detail: null,
		taken,
		blocked,
		ontake,
		onclose: () => {},
	});
	const button = document.querySelector<HTMLButtonElement>('.picker-card .take');
	if (!button) throw new Error('Missing card action');
	return { button, ontake };
}

describe('PickerCard reversible action', () => {
	it('offers Take before selection', async () => {
		const { button, ontake } = await card(false);
		expect(button.textContent?.trim()).toBe('Take');
		button.click();
		expect(ontake).toHaveBeenCalledOnce();
	});

	it('offers Clear for a reversible taken choice and activates it with Enter', async () => {
		const { button, ontake } = await card(true);
		expect(button.textContent?.trim()).toBe('Clear');
		button.focus();
		await userEvent.keyboard('{Enter}');
		expect(ontake).toHaveBeenCalledOnce();
	});

	it('keeps a settled Taken focusable and explains why it cannot be cleared', async () => {
		const { button, ontake } = await card(true, 'Strict preserves this choice');
		expect(button.innerText.trim()).toMatch(/^Taken\b/);
		expect(button.getAttribute('aria-disabled')).toBe('true');
		expect(button.disabled).toBe(false);
		button.focus();
		expect(document.activeElement).toBe(button);
		await userEvent.keyboard('{Enter}');
		expect(ontake).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('Strict preserves this choice');
	});
});
