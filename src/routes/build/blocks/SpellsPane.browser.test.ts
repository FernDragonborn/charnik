import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { startI18n } from '$lib/i18n';
import { SYSTEMS } from '$lib/character/schema';
import type { ContentGraph } from '$lib/content/loader';
import { makeTempContentRoot } from '../../../test-support/fixtures';
import { build } from '../build-view-model.svelte';
import { newClassRow } from '../draft';
import SpellsPane from './SpellsPane.svelte';

const SOURCE = 'SRD 5.2.1';
const CLASS_IDS = ['cleric', 'wizard'];
let graph: ContentGraph;

beforeAll(async () => {
	await startI18n('en');
	graph = await makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability,slot_table,prepare_style,asi_levels',
			`cleric,"${SYSTEMS.join(',')}",${SOURCE},Cleric,d8,"wis,cha",full,wis,full,prepared,"4,8,12,16,19"`,
			`wizard,"${SYSTEMS.join(',')}",${SOURCE},Wizard,d6,"int,wis",full,int,full,prepared,"4,8,12,16,19"`,
		],
	});
});

describe.each(SYSTEMS)('one spell picker · %s', (system) => {
	beforeEach(() => {
		build.reset();
		build.graph = graph;
		build.draft.system = system;
		build.draft.classes = CLASS_IDS.map((id) => ({
			...newClassRow(),
			classId: `class:${SOURCE}:${id}`,
			level: 5,
		}));
	});

	it('renders one search, filter set and grid while both profile counters stay visible', async () => {
		await render(SpellsPane);
		expect(document.querySelectorAll('input')).toHaveLength(1);
		expect(document.querySelectorAll('[role="grid"]')).toHaveLength(1);
		expect(document.querySelectorAll('.facets')).toHaveLength(1);
		const profiles = document.querySelectorAll<HTMLButtonElement>('.profiles button');
		expect(profiles).toHaveLength(2);
		expect([...profiles].map((button) => button.textContent)).toEqual([
			expect.stringContaining('Cleric'),
			expect.stringContaining('Wizard'),
		]);
		profiles[1]?.click();
		await expect.poll(() => profiles[1]?.getAttribute('aria-pressed')).toBe('true');
		expect(build.spellPicks.active?.profile.classEffectiveId).toBe(`class:${SOURCE}:wizard`);
		expect(document.querySelectorAll('input')).toHaveLength(1);
		expect(document.querySelectorAll('[role="grid"]')).toHaveLength(1);
	});
});
