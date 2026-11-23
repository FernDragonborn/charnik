import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { startI18n } from '#lib/i18n/index.ts';
import { newCharacter } from '#lib/character/schema.ts';
import { makeTempContentRoot } from '../../test-support/fixtures';
import { combat } from './combat-view-model.svelte';
import CombatMenus from './CombatMenus.svelte';
import SkillsPanel from './blocks/panels/SkillsPanel.svelte';

/*
 * A row's menu (work/play-layout.md ▸ ROW-MENU): a right click on a skill — or Shift+F10 from the
 * keyboard — opens what its number is made of and the check with a swing, and the swing is rolled.
 */
beforeAll(async () => {
	await startI18n('en');
	combat.graph = await makeTempContentRoot({});
});

const stealth = () =>
	[...document.querySelectorAll<HTMLElement>('.skill-row')].find((row) =>
		row.textContent?.includes('Stealth'),
	);
const popup = () => document.querySelector<HTMLElement>('.popup');

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
