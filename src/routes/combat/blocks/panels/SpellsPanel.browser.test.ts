import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { startI18n } from '$lib/i18n';
import { SYSTEMS, newCharacter } from '$lib/character/schema';
import type { ContentGraph } from '$lib/content/loader';
import { makeTempContentRoot } from '../../../../test-support/fixtures';
import { combat } from '../../combat-view-model.svelte';
import SpellsPanel from './SpellsPanel.svelte';

const SOURCE = 'Test pack';
const FEAT = `feat:${SOURCE}:spell_feat`;
const SPELL = `spell:${SOURCE}:test_spell`;
let graph: ContentGraph;

beforeAll(async () => {
	await startI18n('en');
	graph = await makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves',
			`first,"${SYSTEMS.join(',')}",${SOURCE},First,d8,"wis,cha"`,
			`second,"${SYSTEMS.join(',')}",${SOURCE},Second,d8,"int,wis"`,
		],
		'feats_srd.csv': [
			'id,systems,source,name_en,spell_choice,spell_choice_lists,spell_choice_ability',
			`spell_feat,"${SYSTEMS.join(',')}",${SOURCE},Spell feat,0:1,"first,second","int,wis"`,
		],
		'spells_srd.csv': [
			'id,systems,source,name_en,level,school,classes,casting_time,range,components,duration',
			`test_spell,"${SYSTEMS.join(',')}",${SOURCE},Test spell,0,evocation,"first,second",action,self,V,instant`,
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
});
