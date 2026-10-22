import { describe, it, expect, beforeAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import RarityRange from './RarityRange.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';

beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

const band = () => document.querySelector('.band')?.textContent?.trim();
const handles = () => [...document.querySelectorAll<HTMLInputElement>('.track input')];

describe('RarityRange', () => {
	it('a handle pushed past its partner moves the band instead of sticking', async () => {
		await render(RarityRange, {});
		const [low, high] = handles();
		high?.focus();
		await userEvent.keyboard('{Home}'); // both handles on the first rung
		expect(band()).toBe('Mundane');
		low?.focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(band()).toBe('Mundane — Common');
	});

	it('two handles parked on the last rung can both leave it', async () => {
		await render(RarityRange, {});
		const [low, high] = handles();
		low?.focus();
		await userEvent.keyboard('{End}');
		expect(band()).toBe('Artifact');
		high?.focus();
		await userEvent.keyboard('{ArrowLeft}');
		expect(band()).toBe('Legendary — Artifact');
	});
});
