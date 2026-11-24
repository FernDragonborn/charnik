import '#lib/styles/app.css';
import { beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { newCharacter, SYSTEMS } from '#lib/character/schema.ts';
import { startI18n } from '#lib/i18n/index.ts';
import { makeTempContentRoot } from '../../../test-support/fixtures';
import { combat } from '../combat-view-model.svelte';
import CombatMenus from '../CombatMenus.svelte';
import PhonePlay from './PhonePlay.svelte';

beforeAll(async () => {
	await startI18n('en');
	combat.graph = await makeTempContentRoot({});
});

describe.each(SYSTEMS)('phone standard actions · %s', (system) => {
	it('opens the chooser, dismisses each layer, and uses a standard action once', async () => {
		const c = newCharacter('phone', 'Phone', system);
		c.play.inCombat = true;
		combat.character = c;
		combat.overlay = null;
		const s = combat.sheet;
		if (!s) throw new Error('The character must have a sheet');
		const screen = await render(PhonePlay, { c, s });
		const menus = await render(CombatMenus);
		await screen.getByRole('tab', { name: 'Actions', exact: true }).click();
		const standard = screen.getByRole('button', { name: /^Standard actions/ });
		const chooser = screen.getByRole('dialog', { name: 'Standard actions' });
		const dash = chooser.getByRole('button', { name: /^Dash/ });
		const disengage = chooser.getByRole('button', { name: /^Disengage/ });
		await expect.element(dash).not.toBeInTheDocument();
		await standard.click();
		await userEvent.keyboard('{Tab}');
		await expect.element(dash).toHaveFocus();
		await userEvent.keyboard('{ArrowDown}');
		await expect.element(disengage).toHaveFocus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await expect.element(menus.getByRole('button', { name: 'Use action' })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(disengage).toHaveFocus();
		await userEvent.keyboard('{Escape}');
		await expect.element(standard).toHaveFocus();
		expect(combat.character?.play.turn.action).toBe(0);

		await userEvent.keyboard('{Enter}{Tab}{Enter}');
		await expect.element(chooser).not.toBeInTheDocument();
		await expect.element(standard).toHaveFocus();
		expect(combat.character?.play.turn.action).toBe(1);
	});
});
