import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { startI18n } from '#lib/i18n/index.ts';
import { newCharacter } from '#lib/character/schema.ts';
import { makeTempContentRoot } from '../../test-support/fixtures';
import { combat } from './combat-view-model.svelte';
import CombatMenus from './CombatMenus.svelte';

/*
 * A combat menu is a popup that takes the focus and lets it go (work/ui.md ▸ KEYBOARD-NAV, the
 * maintainer's call): it opens with the focus inside, closes once Tab lands the focus outside it,
 * and Escape closes it and hands the focus back to the button that opened it.
 */
beforeAll(async () => {
	await startI18n('en');
	combat.graph = await makeTempContentRoot({});
});

function trigger(): HTMLButtonElement {
	const button = document.createElement('button');
	button.textContent = 'log';
	button.addEventListener('click', (e) => combat.openMenu('log', e));
	document.body.prepend(button);
	return button;
}
const outside = (): HTMLButtonElement => {
	const button = document.createElement('button');
	button.textContent = 'after';
	document.body.append(button);
	return button;
};
const popup = () => document.querySelector<HTMLElement>('.popup');

describe('a combat menu and the focus', () => {
	beforeEach(() => {
		combat.character = newCharacter('menus', 'Menus', '5.5e');
		combat.overlay = null;
	});

	it('opens with the focus inside it', async () => {
		await render(CombatMenus);
		const opener = trigger();
		opener.focus();
		opener.click();
		await tick();
		await tick();
		expect(popup()?.contains(document.activeElement)).toBe(true);
	});

	it('closes when the focus lands outside it, and Escape hands it back to the trigger', async () => {
		await render(CombatMenus);
		const opener = trigger();
		const after = outside();
		opener.click();
		await tick();
		await tick();
		after.focus();
		await tick();
		expect(combat.overlay).toBeNull();

		opener.click();
		await tick();
		await tick();
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
		);
		await tick();
		expect(combat.overlay).toBeNull();
		expect(document.activeElement).toBe(opener);
	});
});
