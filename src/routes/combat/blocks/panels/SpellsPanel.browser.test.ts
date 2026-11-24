import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { startI18n } from '#lib/i18n/index.ts';
import { SYSTEMS, classRow, newCharacter } from '#lib/character/schema.ts';
import type { ContentGraph } from '#lib/content/loader.ts';
import { makeTempContentRoot } from '../../../../test-support/fixtures';
import { combat } from '../../combat-view-model.svelte';
import SpellsPanel from './SpellsPanel.svelte';
import CombatMenus from '../../CombatMenus.svelte';

const SOURCE = 'Test pack';
const FEAT = `feat:${SOURCE}:spell_feat`;
const SPELL = `spell:${SOURCE}:test_spell`;
const FIXTURE_SYSTEMS = SYSTEMS.join(',');
let graph: ContentGraph;

beforeAll(async () => {
	await startI18n('en');
	graph = await makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
			`first,"${FIXTURE_SYSTEMS}",${SOURCE},First,d8,"wis,cha",full,cha`,
			`second,"${FIXTURE_SYSTEMS}",${SOURCE},Second,d8,"int,wis",full,int`,
		],
		'spell_slots_srd.csv': [
			'id,systems,source,kind,level,slot_1,slot_2',
			`full_3,"${FIXTURE_SYSTEMS}",${SOURCE},full,3,4,2`,
		],
		'feats_srd.csv': [
			'id,systems,source,name_en,spell_choice,spell_choice_lists,spell_choice_ability',
			`spell_feat,"${FIXTURE_SYSTEMS}",${SOURCE},Spell feat,0:1,"first,second","int,wis"`,
		],
		'spells_srd.csv': [
			'id,systems,source,name_en,level,school,classes,casting_time,range,components,duration,resolution,save_ability',
			`test_spell,"${FIXTURE_SYSTEMS}",${SOURCE},Test spell,0,evocation,"first,second",action,self,V,instant,save,dex`,
		],
	});
});

describe.each(SYSTEMS)('spell panel with repeatable feat profiles · %s', (system) => {
	beforeEach(() => {
		const character = newCharacter('repeatable_feat', 'Repeatable feat', system);
		character.build.feats = [FEAT, FEAT];
		character.build.featSpells = [
			{ feat: FEAT, key: 'origin', list: 'first', ability: 'int', spells: [SPELL] },
			{ feat: FEAT, key: 'level_4', list: 'second', ability: 'wis', spells: [SPELL] },
		];
		combat.character = character;
		combat.graph = graph;
	});

	it('renders same-named profiles separately and shows their shared spell once', async () => {
		const sheet = combat.sheet;
		if (!sheet) throw new Error('The character must have a sheet');
		await render(SpellsPanel, { s: sheet });
		expect(document.querySelectorAll('.cast-class')).toHaveLength(2);
		expect(document.querySelectorAll('.name-cast')).toHaveLength(1);
	});

	it('keeps blocked spells readable and focusable with their casting reason', async () => {
		const character = combat.character;
		if (!character) throw new Error('The character must exist');
		character.play.effects = [
			{
				iid: 'casting_block',
				label: 'Casting block',
				positive: false,
				effects: ['blocks_spellcasting'],
			},
		];
		const sheet = combat.sheet;
		if (!sheet) throw new Error('The character must have a sheet');
		await render(SpellsPanel, { s: sheet });
		const castButton = document.querySelector<HTMLButtonElement>('.name-cast');
		expect(castButton?.getAttribute('aria-disabled')).toBe('true');
		expect(castButton?.disabled).toBe(false);
		expect(castButton?.textContent).toContain('Test spell');
		expect(document.querySelector('.armor-block')?.textContent).toContain('Casting block');
	});

	it('opens the spell and its casting profile in the row menu', async () => {
		const sheet = combat.sheet;
		if (!sheet) throw new Error('The character must have a sheet');
		await render(SpellsPanel, { s: sheet });
		const menus = await render(CombatMenus);
		const row = document.querySelector('.spell-row');
		expect(
			row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
		).toBe(false);
		await tick();
		expect(document.querySelector('.popup-heading')?.textContent).toContain('Test spell');
		expect(document.querySelector('.row-why')?.textContent).toContain('Save DC');
		expect(document.querySelector('.row-why')?.textContent).toContain('DEX save');
		await expect.element(menus.getByRole('link', { name: 'Open in the compendium' })).toBeVisible();
	});

	it('shows the compact casting profiles, opens the selected slot and restores a spent pip', async () => {
		const character = combat.character;
		if (!character) throw new Error('The character must exist');
		character.build.classes = [classRow({ class: `class:${SOURCE}:first`, level: 3 })];
		const s = combat.sheet;
		if (!s) throw new Error('The character must have a sheet');
		const panel = await render(SpellsPanel, { s, compact: true });
		expect(document.querySelectorAll('.spell-caster-tag')).toHaveLength(3);
		const slot = panel.getByRole('tab', { name: /2nd/ });
		await slot.click();
		await expect.element(slot).toHaveAttribute('aria-selected', 'true');
		const pip = panel.getByRole('button', { name: 'tap to spend / restore' }).last();
		await pip.click();
		expect(combat.character?.play.spellSlotsSpent['2']).toBe(1);
		await pip.click();
		expect(combat.character?.play.spellSlotsSpent['2']).toBe(0);
	});
});
