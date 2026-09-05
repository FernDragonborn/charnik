import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SchemaDiscardDialog from './SchemaDiscardDialog.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import type { DraftEnvelope } from '$lib/drafts/store';

const stale: DraftEnvelope = {
	schemaVersion: 999,
	target: { kind: 'add', type: 'spell', addGuid: 'guid-1' },
	data: { name_en: 'Half-written spell' },
	savedAt: '2026-08-01T00:00:00.000Z',
};

// rendered in Ukrainian on purpose: the dialog's counts are whole sentences per plural branch,
// and Ukrainian has three where English has two — the branch English never exercises.
beforeAll(async () => {
	await startI18n('uk');
	void locale.set('uk');
	await waitLocale();
});

describe('SchemaDiscardDialog (browser)', () => {
	it('lists an unmigratable draft and an unreadable FILE side by side, and counts both', async () => {
		const onDiscard = vi.fn();
		await render(SchemaDiscardDialog, {
			drafts: [stale],
			unreadable: ['drafts/broken.json'],
			onDiscard,
			onKeep: () => {},
		});
		await expect.element(page.getByText('Half-written spell')).toBeInTheDocument();
		// the damaged file has no readable contents, so its name is what identifies it
		await expect.element(page.getByText('broken.json')).toBeInTheDocument();
		await expect.element(page.getByText('нечитаний файл')).toBeInTheDocument();
		// the button counts BOTH kinds — discarding acts on everything listed
		await page.getByRole('button', { name: /Відкинути 2 чернетки/ }).click();
		expect(onDiscard).toHaveBeenCalled();
	});
});
