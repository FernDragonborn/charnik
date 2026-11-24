import { beforeAll, describe, expect, it } from 'vitest';
import '#lib/styles/app.css';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { startI18n } from '#lib/i18n/index.ts';
import { newCharacter, characterSchema } from '#lib/character/schema.ts';
import { makeTempContentRoot } from '../../../test-support/fixtures';
import { combat } from '../combat-view-model.svelte';
import { playLayout } from '../play-layout.svelte';
import ColumnPlay from './ColumnPlay.svelte';
import PhonePlay from './PhonePlay.svelte';

beforeAll(async () => {
	await startI18n('en');
	combat.graph = await makeTempContentRoot({});
});

describe('compact arranging', () => {
	for (const { layout, view } of [
		{ layout: 'columns', view: ColumnPlay },
		{ layout: 'phone', view: PhonePlay },
	] as const) {
		it(`reveals the grips and restores an initially hidden tab on ${layout}`, async () => {
			combat.layout.arranging = false;
			const c = newCharacter('arrange', 'Arrange', '5.5e');
			c.ui.playTabsHidden[layout] = ['actions'];
			combat.character = c;
			const s = combat.sheet;
			if (!s) throw new Error('The character must have a sheet');
			const screen = await render(view, { c, s });
			const actions = screen.getByRole('tab', { name: 'Actions', exact: true });
			await expect.element(actions).not.toBeInTheDocument();
			expect(document.querySelector('.row-grip')).toBeNull();
			await screen.getByRole('button', { name: 'Arrange', exact: true }).click();
			await actions.click();
			const show = screen.getByRole('button', { name: 'Show the Actions tab' });
			await expect.element(show).toHaveAttribute('aria-pressed', 'false');
			await show.click();
			expect(document.querySelector('.row-grip')).not.toBeNull();
			await screen.getByRole('button', { name: 'Done', exact: true }).click();
			await expect.element(actions).toBeVisible();
			expect(document.querySelector('.row-grip')).toBeNull();
			await expect
				.element(screen.getByRole('button', { name: 'Arrange', exact: true }))
				.toHaveFocus();
		});
	}
});

function press(code: string): void {
	document.activeElement?.dispatchEvent(
		new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }),
	);
}

describe('active column tab', () => {
	it('renders a saved tab and walks the column in its reading direction', async () => {
		const original = newCharacter('columns', 'Columns', '5.5e');
		const group = playLayout.groups[0];
		const tab = group?.at(-1);
		if (!group || !tab) throw new Error('The first column must have tabs');
		original.ui.columnTabs[group.join(',')] = tab;
		const c = characterSchema.parse(original);
		combat.character = c;
		const s = combat.sheet;
		if (!s) throw new Error('The character must have a sheet');
		await render(ColumnPlay, { c, s });
		const chosen = document.getElementById(`pane-tab-${tab}`);
		const first = document.getElementById('pane-tab-actions');
		expect(chosen?.getAttribute('aria-selected')).toBe('true');
		chosen?.focus();
		press('Home');
		await tick();
		expect(document.activeElement).toBe(first);
		expect(first?.getAttribute('aria-selected')).toBe('true');
		expect(combat.character?.ui.columnTabs[group.join(',')]).toBe('actions');
		const root = document.documentElement;
		const direction = root.dir;
		try {
			root.dir = 'rtl';
			press('ArrowRight');
			await tick();
			expect(document.activeElement).toBe(chosen);
			expect(chosen?.getAttribute('aria-selected')).toBe('true');
			expect(combat.character?.ui.columnTabs[group.join(',')]).toBe(tab);
		} finally {
			root.dir = direction;
		}
	});
});
