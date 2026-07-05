/*
 * Behavioral net for the Build view-model. Drives the REAL rune VM (compiled via the svelte plugin
 * in vitest.config) through stable boundaries only — `hydrate(Character)` in, the assembled
 * `Character` out — so it survives refactors of the VM's internal shape (field regroup, method
 * merges). It asserts WHAT a build produces, never HOW the VM is structured.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { loadContent, type ContentGraph } from '$lib/content/loader';
import { characterSchema, newCharacter, type Character } from '$lib/character/schema';
import { build } from './state.svelte';

const S = 'SRD 5.2.1';

async function graphOf(): Promise<ContentGraph> {
	const st = new MemoryStorage();
	await st.write(
		'c/classes_srd.csv',
		[
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int`
		].join('\n')
	);
	await st.write(
		'c/species_srd.csv',
		[
			'id,systems,source,name_en,effects,size,speed,creature_type',
			`hardy,5.5e,${S},Hardy,flat-bonus:con+2,medium,30,humanoid`
		].join('\n')
	);
	await st.write(
		'c/spells_srd.csv',
		[
			'id,systems,source,name_en,level,school,casting_time,range,duration,components',
			`fireball,5.5e,${S},Fireball,3,evocation,action,150 ft,instant,V S M`
		].join('\n')
	);
	const g = await loadContent(st, ['c']);
	expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
	return g;
}

/** A fully-specified saved character to round-trip through the builder. */
function savedCharacter(): Character {
	const c = newCharacter('valen', 'Valen', '5.5e');
	c.build.species = `species:${S}:hardy`;
	c.build.classes = [{ class: `class:${S}:wizard`, level: 3 }];
	c.build.abilities = { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 12 };
	c.build.skills = ['arcana', 'history'];
	c.build.languages = [`language:${S}:common`];
	c.build.spells = [{ spell: `spell:${S}:fireball`, prepared: true, alwaysPrepared: false }];
	return characterSchema.parse(c);
}

describe('BuildVM · hydrate → assemble round-trip (behavioral)', () => {
	let graph: ContentGraph;
	beforeEach(async () => {
		graph = await graphOf();
		build.reset();
		build.graph = graph;
	});

	it('preserves identity, system, and the core build choices', () => {
		const saved = savedCharacter();
		build.hydrate(saved);
		const out = build.draft; // the assembled Character

		expect(out.id).toBe('valen');
		expect(out.system).toBe('5.5e');
		expect(out.build.name).toBe('Valen');
		expect(out.build.species).toBe(`species:${S}:hardy`);
		expect(out.build.classes).toEqual([{ class: `class:${S}:wizard`, level: 3 }]);
		expect(out.build.abilities).toEqual(saved.build.abilities);
	});

	it('keeps chosen languages, skills, and spell refs (skills may gain auto-grants)', () => {
		const saved = savedCharacter();
		build.hydrate(saved);
		const out = build.draft;

		expect(out.build.languages).toContain(`language:${S}:common`);
		for (const skill of saved.build.skills) expect(out.build.skills).toContain(skill);
		expect(out.build.spells.map((s) => s.spell)).toContain(`spell:${S}:fireball`);
	});

	it('a blank reset produces a minimal valid character (no crash on empty draft)', () => {
		build.reset();
		build.graph = graph;
		const out = build.draft;
		expect(out.build.name).toBeTruthy();
		expect(out.build.classes).toEqual([]);
	});
});
