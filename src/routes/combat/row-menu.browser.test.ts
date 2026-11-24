import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { startI18n } from '#lib/i18n/index.ts';
import { TOUCH_HOLD_MS } from '#lib/actions/dragMotion.ts';
import { newCharacter, SYSTEMS } from '#lib/character/schema.ts';
import { makeTempContentRoot } from '../../test-support/fixtures';
import { combat } from './combat-view-model.svelte';
import CombatMenus from './CombatMenus.svelte';
import SkillsPanel from './blocks/panels/SkillsPanel.svelte';
import AttacksPanel from './blocks/panels/AttacksPanel.svelte';
import ActionsPanel from './blocks/panels/ActionsPanel.svelte';
import FeaturesPanel from './blocks/panels/FeaturesPanel.svelte';

/*
 * A row's menu (work/play-layout.md ▸ ROW-MENU): a right click on a skill — or Shift+F10 from the
 * keyboard — opens what its number is made of and the check with a swing, and the swing is rolled.
 */
beforeAll(async () => {
	await startI18n('en');
	combat.graph = await makeTempContentRoot({
		'feats_srd.csv': [
			'id,systems,source,name_en,text_en',
			`example,"${SYSTEMS.join(',')}",Test,Example feature,Example text`,
		],
	});
});

const stealth = () =>
	[...document.querySelectorAll<HTMLElement>('.skill-row')].find((row) =>
		row.textContent?.includes('Stealth'),
	);
const popup = () => document.querySelector<HTMLElement>('.popup');

function pressKey(target: Element | null, code: string, shiftKey = false): void {
	expect(
		target?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: code,
				code,
				shiftKey,
				bubbles: true,
				cancelable: true,
			}),
		),
	).toBe(false);
}

function sendTouch(target: Element, type: string, touches: Touch[]): boolean {
	return target.dispatchEvent(new TouchEvent(type, { touches, bubbles: true, cancelable: true }));
}

describe.each(SYSTEMS)('attack, action and feature menus · %s', (system) => {
	beforeEach(() => {
		const character = newCharacter('rows', 'Rows', system);
		character.build.feats = ['feat:Test:example'];
		combat.character = character;
		combat.overlay = null;
	});

	it('opens the attack menu and rolls the selected swing with damage', async () => {
		await render(AttacksPanel);
		const menus = await render(CombatMenus);
		const row = document.querySelector<HTMLButtonElement>('.row-line .combat-row');
		row?.focus();
		pressKey(row, 'ContextMenu');
		await tick();
		expect(popup()?.querySelector('.popup-heading')?.textContent).toContain('Unarmed Strike');
		await menus.getByRole('button', { name: 'Advantage', exact: true }).click();
		expect(combat.journal.log[0]?.advantage).toBe('advantage');
		expect(combat.journal.log[0]?.damage?.length).toBeGreaterThan(0);
		expect(document.activeElement).toBe(row);
	});

	it('uses a tap for the attack and consumes a hold without rolling', async () => {
		await render(AttacksPanel, { furniture: false });
		await render(CombatMenus);
		const row = document.querySelector<HTMLButtonElement>('.row-line .combat-row');
		if (!row) throw new Error('The attack must have a row');
		const finger = new Touch({ target: row, identifier: 1, clientX: 30, clientY: 30 });
		const journalEntry = combat.journal.log[0];
		vi.useFakeTimers();
		try {
			sendTouch(row, 'touchstart', [finger]);
			vi.advanceTimersByTime(TOUCH_HOLD_MS - 1);
			expect(combat.overlay).toBeNull();
			expect(sendTouch(row, 'touchend', [])).toBe(true);
			row.click();
			const tapEntry = combat.journal.log[0];
			expect(tapEntry).not.toBe(journalEntry);
			expect(tapEntry?.damage?.length).toBeGreaterThan(0);

			sendTouch(row, 'touchstart', [finger]);
			vi.advanceTimersByTime(TOUCH_HOLD_MS);
			await tick();
			expect(popup()?.querySelector('.popup-heading')?.textContent).toContain('Unarmed Strike');
			expect(sendTouch(row, 'touchend', [])).toBe(false);
			expect(combat.journal.log[0]).toBe(tapEntry);
			pressKey(document.activeElement, 'Escape');
			await tick();
			expect(document.activeElement).toBe(row);
		} finally {
			vi.useRealTimers();
		}
	});

	it('cancels the hold for movement or a second finger outside the row', async () => {
		await render(ActionsPanel, { furniture: false });
		const row = document.querySelector('.row-wrap');
		if (!row) throw new Error('The action must have a row');
		const finger = new Touch({ target: row, identifier: 1, clientX: 30, clientY: 30 });
		const moved = new Touch({ target: row, identifier: 1, clientX: 30, clientY: 45 });
		const second = new Touch({ target: document.body, identifier: 2 });
		vi.useFakeTimers();
		try {
			sendTouch(row, 'touchstart', [finger]);
			sendTouch(row, 'touchmove', [moved]);
			vi.advanceTimersByTime(TOUCH_HOLD_MS);
			expect(combat.overlay).toBeNull();

			sendTouch(row, 'touchstart', [finger]);
			sendTouch(document.body, 'touchstart', [finger, second]);
			vi.advanceTimersByTime(TOUCH_HOLD_MS);
			expect(combat.overlay).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('opens a standard action menu by right click and returns focus to the row', async () => {
		await render(ActionsPanel);
		const menus = await render(CombatMenus);
		const row = [...document.querySelectorAll<HTMLButtonElement>('.combat-row')].find(
			(button) => button.querySelector('.row-name')?.textContent === 'Dash',
		);
		expect(
			row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
		).toBe(false);
		await expect.element(menus.getByRole('button', { name: 'Use action' })).toBeVisible();
		pressKey(document.activeElement, 'Escape');
		await tick();
		expect(combat.overlay).toBeNull();
		expect(document.activeElement).toBe(row);
	});

	it('opens the feature editor in the row menu and dismisses one layer per Escape', async () => {
		await render(FeaturesPanel);
		const menus = await render(CombatMenus);
		const row = document.querySelector('summary');
		pressKey(row, 'F10', true);
		await menus.getByRole('button', { name: 'In your own words' }).click();
		const editor = menus.getByRole('textbox', { name: 'In your own words' });
		await expect.element(editor).toHaveValue('Example text');
		await expect.element(editor).toHaveFocus();
		pressKey(document.activeElement, 'Escape');
		await expect.element(menus.getByRole('button', { name: 'In your own words' })).toHaveFocus();
		pressKey(document.activeElement, 'Escape');
		await tick();
		expect(combat.overlay).toBeNull();
		expect(document.activeElement).toBe(row);
	});
});

describe('a skill row’s menu', () => {
	beforeEach(() => {
		combat.character = newCharacter('menu', 'Menu', '5.5e');
		combat.overlay = null;
	});

	it('opens on a right click with the skill’s name, its parts and the swing', async () => {
		const sheet = combat.sheet;
		if (!sheet) throw new Error('The character must have a sheet');
		await render(SkillsPanel, { s: sheet });
		await render(CombatMenus);
		stealth()?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();
		expect(popup()?.textContent).toContain('Stealth');
		expect(popup()?.textContent).toContain('Advantage');
		expect(popup()?.querySelector('.row-why')?.textContent?.trim().length).toBeGreaterThan(0);
	});

	it('rolls the check with the swing the player picked, and Shift+F10 opens it too', async () => {
		const sheet = combat.sheet;
		if (!sheet) throw new Error('The character must have a sheet');
		await render(SkillsPanel, { s: sheet });
		await render(CombatMenus);
		stealth()?.dispatchEvent(
			new KeyboardEvent('keydown', {
				code: 'F10',
				shiftKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		await tick();
		const advantage = [...(popup()?.querySelectorAll('button') ?? [])].find((b) =>
			b.textContent?.includes('Advantage'),
		);
		advantage?.click();
		await tick();
		expect(combat.overlay).toBeNull();
		expect(combat.journal.log[0]?.advantage).toBe('advantage');
	});
});
