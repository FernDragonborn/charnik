import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { startI18n } from '#lib/i18n/index.ts';
import { newCharacter, characterSchema } from '#lib/character/schema.ts';
import { makeTempContentRoot } from '../../../test-support/fixtures';
import { combat } from '../combat-view-model.svelte';
import { playLayout } from '../play-layout.svelte';
import ColumnPlay from './ColumnPlay.svelte';

beforeAll(async () => {
	await startI18n('en');
	combat.graph = await makeTempContentRoot({});
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
