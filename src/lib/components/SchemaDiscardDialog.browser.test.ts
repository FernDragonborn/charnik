import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SchemaDiscardDialog from './SchemaDiscardDialog.svelte';
import type { DraftEnvelope } from '$lib/drafts/store';

const stale: DraftEnvelope = {
	schemaVersion: 999,
	target: { kind: 'add', type: 'spell', addGuid: 'guid-1' },
	data: { name_en: 'Half-written spell' },
	savedAt: '2026-08-01T00:00:00.000Z',
};

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
		await expect.element(page.getByText('unreadable file')).toBeInTheDocument();
		// the button counts BOTH kinds — discarding acts on everything listed
		await page.getByRole('button', { name: /Discard 2 drafts/ }).click();
		expect(onDiscard).toHaveBeenCalled();
	});
});
