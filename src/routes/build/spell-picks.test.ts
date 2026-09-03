/*
 * The Strict spell cap, on the one shape that has two right answers: a multiclass caster picking a
 * spell that sits on both class lists. The cap that blocks and the tally that counts must be the
 * same rule, or a class with room refuses a pick nothing would have charged to the full one.
 */
import { makeTempContentRoot } from '../../test-support/fixtures';
import { describe, it, expect, beforeEach } from 'vitest';
import { type ContentGraph } from '$lib/content/loader';
import { build } from './build-view-model.svelte';
import { newClassRow } from './draft';

const S = 'SRD 5.2.1';
const ref = (type: string, id: string) => `${type}:${S}:${id}`;

/** Two full casters, one spell on both lists, and caps small enough to fill. */
async function graphOf(): Promise<ContentGraph> {
	return makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability,slot_table,prepare_style,asi_levels',
			`cleric,5.5e,${S},Cleric,d8,"wis,cha",full,wis,full,prepared,"4,8,12,16,19"`,
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int,full,prepared,"4,8,12,16,19"`,
		].join('\n'),
		'class_casting_srd.csv': [
			'id,systems,source,class_id,level,cantrips_known,prepared_known',
			`cleric_5,5.5e,${S},cleric,5,3,2`,
			`wizard_5,5.5e,${S},wizard,5,3,5`,
		].join('\n'),
		'spell_slots_srd.csv': [
			'id,systems,source,kind,level,slot_1,slot_2,slot_3',
			`full_5,5.5e,${S},full,5,4,3,2`,
		].join('\n'),
		'spells_srd.csv': [
			'id,systems,source,name_en,level,school,casting_time,range,duration,components,classes',
			`bless,5.5e,${S},Bless,1,enchantment,action,30 ft,1 min,V S M,cleric`,
			`bane,5.5e,${S},Bane,1,enchantment,action,30 ft,1 min,V S M,cleric`,
			`shield_of_faith,5.5e,${S},Shield of Faith,1,abjuration,bonus_action,60 ft,10 min,V S M,cleric`,
			// the one that matters: legal for BOTH, so exactly one of them must be charged for it
			`mending,5.5e,${S},Mending,1,transmutation,action,touch,instant,V S M,"cleric,wizard"`,
		].join('\n'),
	});
}

describe('SpellPicks · the Strict cap charges the class the tally would (B11)', () => {
	beforeEach(async () => {
		const graph = await graphOf();
		build.reset();
		build.graph = graph;
		build.draft.name = 'Duo';
		build.draft.classes = [
			{ ...newClassRow(), classId: ref('class', 'cleric'), subclassId: null, level: 5 },
			{ ...newClassRow(), classId: ref('class', 'wizard'), subclassId: null, level: 5 },
		];
		// the wizard casts off the higher score, so `casterForSpell` attributes a shared spell to it
		build.draft.abilities = { str: 8, dex: 12, con: 12, int: 18, wis: 10, cha: 8 };
	});

	it('fills the cleric, then still takes a dual-list spell as the wizard', () => {
		const cleric = build.spellPicks.picker.find((p) => p.profile.className === 'Cleric');
		expect(cleric?.profile.preparedCap).toBe(2);

		build.spellPicks.toggle(ref('spell', 'bless'));
		build.spellPicks.toggle(ref('spell', 'bane'));
		expect(build.draft.selectedSpells).toHaveLength(2);

		// the cleric is full: a cleric-only spell is refused, which is the cap doing its job
		build.spellPicks.toggle(ref('spell', 'shield_of_faith'));
		expect(build.draft.selectedSpells).toHaveLength(2);

		// …but a spell on both lists is charged to the wizard, which has four picks left
		build.spellPicks.toggle(ref('spell', 'mending'));
		expect(build.draft.selectedSpells).toContain(ref('spell', 'mending'));
	});
});
