import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import HashDriftModal from './HashDriftModal.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import type { DriftItem } from '$lib/content/meta';

const items: DriftItem[] = [
	{ file: 'spells_homebrew.csv', declaredDate: '2026-06-20', changedAt: '2026-07-06' },
	{ file: 'monsters_homebrew.csv', declaredDate: '2026-05-01', changedAt: '2026-07-05' }
];

beforeAll(async () => {
	await startI18n('uk');
	locale.set('uk');
	await waitLocale();
});

describe('HashDriftModal (browser)', () => {
	it('lists the drifted files and updates only the checked ones', async () => {
		const onUpdate = vi.fn();
		render(HashDriftModal, { items, onUpdate, onSkip: () => {}, onNeverAsk: () => {} });
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		await expect.element(page.getByText('spells_homebrew.csv')).toBeInTheDocument();
		await expect.element(page.getByText('monsters_homebrew.csv')).toBeInTheDocument();

		// uncheck the first file (checked by default), then apply → only the second should be updated
		await page.getByRole('checkbox').nth(0).click();
		await page.getByText('Оновити дати та хеші').click();
		expect(onUpdate).toHaveBeenCalledWith(['monsters_homebrew.csv']);
	});

	it('Escape skips', async () => {
		const onSkip = vi.fn();
		render(HashDriftModal, { items, onUpdate: () => {}, onSkip, onNeverAsk: () => {} });
		await page
			.getByRole('dialog')
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onSkip).toHaveBeenCalled();
	});
});
