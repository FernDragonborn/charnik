/*
 * The upcast builder writes a TOKEN, and the token is the same string an author could have typed —
 * which is the whole contract: the file and the form never hold two names for one fact.
 *
 * The assertion is the PREVIEW, because the preview is that string: it is what `add` appends, and it
 * is read back through the parser the LOADER uses, so the form cannot offer what the app refuses.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import UpcastBuilder from './UpcastBuilder.svelte';
import { startI18n } from '$lib/i18n';
import { parseUpcast } from '$lib/effects/upcast';

beforeAll(() => startI18n('en'));

const selects = () => [...document.querySelectorAll<HTMLSelectElement>('.upcast-builder select')];
const amountBox = () => document.querySelector<HTMLInputElement>('.upcast-builder input');
const preview = () => document.querySelector('.ub-preview')?.textContent ?? '';
const addButton = () => document.querySelector<HTMLButtonElement>('.upcast-builder button');

const set = (el: HTMLInputElement | HTMLSelectElement | null, value: string) => {
	if (!el) throw new Error('the builder is missing a control');
	el.value = value;
	el.dispatchEvent(
		new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
	);
};
/** Svelte's effects settle on a microtask; nothing here is async but the DOM is. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('UpcastBuilder', () => {
	it('says the delta shape the way the grammar spells it', async () => {
		await render(UpcastBuilder, { value: '' });
		set(amountBox(), '1d6');
		await settle();
		expect(preview()).toBe('damage:per_slot(1d6)');
		expect(parseUpcast(preview()).every((t) => !('error' in t))).toBe(true);
	});

	it('says the absolute shape for a count', async () => {
		await render(UpcastBuilder, { value: '' });
		set(selects()[0] ?? null, 'count');
		set(selects()[1] ?? null, 'total');
		set(amountBox(), '1');
		await settle();
		expect(preview()).toBe('count:slot+1');
		expect(parseUpcast(preview()).every((t) => !('error' in t))).toBe(true);
	});

	it('offers nothing to add until there is an amount', async () => {
		await render(UpcastBuilder, { value: '' });
		await settle();
		expect(preview()).toBe('');
		expect(addButton()?.disabled).toBe(true);
	});
});
