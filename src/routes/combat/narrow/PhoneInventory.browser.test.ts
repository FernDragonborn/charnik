import '#lib/styles/app.css';
import { beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { inventoryRow, newCharacter, SYSTEMS } from '#lib/character/schema.ts';
import { startI18n } from '#lib/i18n/index.ts';
import { makeTempContentRoot } from '../../../test-support/fixtures';
import { combat } from '../combat-view-model.svelte';
import PhonePlay from './PhonePlay.svelte';

const POTION = 'item:Test:training_potion';
const DAGGER = 'item:Test:training_dagger';

beforeAll(async () => {
	await startI18n('en');
	const editions = SYSTEMS.join(',');
	combat.graph = await makeTempContentRoot({
		'items_srd.csv': [
			'id,systems,source,name_en,category,weight_lb,cost',
			`training_potion,"${editions}",Test,Training Potion,potion,1,5 gp`,
			`training_dagger,"${editions}",Test,Training Dagger,weapon,1,2 gp`,
		],
	});
});

describe.each(SYSTEMS)('phone inventory · %s', (system) => {
	it('folds categories, adjusts a stack, and returns focus when its last use removes it', async () => {
		const c = newCharacter('inventory', 'Inventory', system);
		c.build.inventory = [
			inventoryRow({ item: POTION, qty: 1 }),
			inventoryRow({ item: DAGGER, qty: 1 }),
		];
		combat.character = c;
		const s = combat.sheet;
		if (!s) throw new Error('The character must have a sheet');
		const screen = await render(PhonePlay, { c, s });
		await screen.getByRole('tab', { name: 'Items', exact: true }).click();
		const category = screen.getByText(/^Consumables\s*1$/);
		const row = screen.getByRole('button', { name: /^Training Potion/ });
		await category.click();
		expect(category.element().closest('details')).not.toHaveAttribute('open');
		await category.click();
		await row.click();
		const drawer = screen.getByRole('dialog', { name: 'Training Potion', exact: true });
		await expect.element(drawer.getByText(/5 gp/).first()).toBeVisible();
		await drawer.getByRole('button', { name: 'One more Training Potion' }).click();
		expect(combat.inventory.rows.find(({ entry }) => entry.item === POTION)?.entry.qty).toBe(2);
		await userEvent.keyboard('{Escape}');
		await expect.element(row).toHaveFocus();
		await row.click();
		const use = drawer.getByRole('button', { name: 'Use', exact: true });
		await use.click();
		expect(combat.inventory.rows.find(({ entry }) => entry.item === POTION)?.entry.qty).toBe(1);
		await expect.element(screen.getByText('Used Training Potion · 1 left')).toBeVisible();
		await use.click();
		await expect.element(drawer).not.toBeInTheDocument();
		await expect.element(row).not.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Add an item' })).toHaveFocus();
	});

	it('takes and returns one item at a time from the whole picker row', async () => {
		const c = newCharacter('picker', 'Picker', system);
		const savedVariant = inventoryRow({ item: DAGGER, qty: 1, choice: 'legacy' });
		c.build.inventory = [savedVariant];
		combat.character = c;
		const s = combat.sheet;
		if (!s) throw new Error('The character must have a sheet');
		const screen = await render(PhonePlay, { c, s });
		await screen.getByRole('tab', { name: 'Items', exact: true }).click();
		const opener = screen.getByRole('button', { name: 'Add an item' });
		await opener.click();
		const picker = screen.getByRole('dialog', { name: 'Add an item', exact: true });
		const search = picker.getByRole('searchbox');
		await expect.element(search).toHaveFocus();
		await search.fill('Training Potion');
		await userEvent.keyboard('{ArrowDown}{Enter}');
		const more = picker.getByRole('button', { name: 'One more Training Potion' });
		await expect.element(more).toHaveTextContent('×1');
		await more.click();
		await expect.element(more).toHaveTextContent('×2');
		const fewer = picker.getByRole('button', { name: 'One fewer Training Potion' });
		await fewer.click();
		await expect.element(more).toHaveTextContent('×1');
		await fewer.click();
		await expect.element(fewer).not.toBeInTheDocument();
		expect(combat.inventory.rows.map(({ entry }) => entry)).toEqual([savedVariant]);
		await search.fill('Training Dagger');
		await picker.getByRole('button', { name: /Training Dagger/ }).click();
		expect(combat.inventory.rows.map(({ entry }) => entry)).toEqual([savedVariant]);
		await userEvent.keyboard('{Escape}');
		await expect.element(opener).toHaveFocus();
	});
});
