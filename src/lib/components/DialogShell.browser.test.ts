import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createRawSnippet } from 'svelte';
import DialogShell from './DialogShell.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';

// The shell owns the way OUT of every attention dialog — Escape and the backdrop — for six
// components. It used to be tested through whichever consumer happened to have a test
// (ContentMetaModal, HashDriftModal), which left the other four unguarded and duplicated the same
// assertion twice; the dismissal contract belongs where the code is.
beforeAll(async () => {
	await startI18n('uk'); // the header renders a LangSwitcher
	void locale.set('uk');
	await waitLocale();
});

const body = createRawSnippet(() => ({ render: () => '<p>body</p>' }));

const shell = (onDismiss?: () => void) =>
	render(DialogShell, {
		titleId: 'dialog-title',
		title: 'Title',
		subtitle: 'Subtitle',
		width: '400px',
		children: body,
		...(onDismiss ? { onDismiss } : {}),
	});

const pressEscape = () =>
	page
		.getByRole('dialog')
		.element()
		.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('DialogShell — the way out', () => {
	it('Escape dismisses', async () => {
		const onDismiss = vi.fn();
		await shell(onDismiss);
		pressEscape();
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it('a click on the backdrop dismisses', async () => {
		const onDismiss = vi.fn();
		const screen = await shell(onDismiss);
		screen.container.querySelector<HTMLElement>('.dialog-backdrop')?.click();
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	// The reverse state: a dialog with no `onDismiss` is one the user MUST resolve (the death screen,
	// the first-run modal). Neither exit may fire, or a stray click closes the only way back.
	it('without onDismiss neither Escape nor the backdrop does anything', async () => {
		const screen = await shell();
		pressEscape();
		screen.container.querySelector<HTMLElement>('.dialog-backdrop')?.click();
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
	});

	it('is a labelled modal dialog', async () => {
		await shell(() => {});
		const dialog = page.getByRole('dialog');
		await expect.element(dialog).toHaveAttribute('aria-modal', 'true');
		await expect.element(dialog).toHaveAttribute('aria-labelledby', 'dialog-title');
	});
});
