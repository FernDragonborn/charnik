import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import HashDriftModal from './HashDriftModal.svelte';
import { startI18n, locale, waitLocale } from '#lib/i18n/index.ts';
import type { DriftItem } from '#lib/content/meta.ts';

const items: DriftItem[] = [
	{ file: 'content/homebrew/spells.csv', declaredDate: '2026-06-20', changedAt: '2026-07-06' },
	{ file: 'content/homebrew/monsters.csv', declaredDate: '2026-05-01', changedAt: '2026-07-05' },
];

beforeAll(async () => {
	await startI18n('uk');
	void locale.set('uk');
	await waitLocale();
});

describe('HashDriftModal (browser)', () => {
	it('lists the drifted files and updates only the checked ones', async () => {
		const onUpdate = vi.fn();
		await render(HashDriftModal, { items, onUpdate, onSkip: () => {}, onNeverAsk: () => {} });
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		await expect.element(page.getByText('spells.csv').first()).toBeInTheDocument();
		await expect.element(page.getByText('monsters.csv').first()).toBeInTheDocument();

		// every file is recorded by default; pressing a file's arrow leaves it out
		await page.getByRole('button', { name: /: spells\.csv$/ }).click();
		// by ROLE + a fragment, not the whole sentence — the confirm copy is prose and gets rewritten
		await page.getByRole('button', { name: /це мої зміни/i }).click();
		expect(onUpdate).toHaveBeenCalledWith(['content/homebrew/monsters.csv']);
	});
});
