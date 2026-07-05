/*
 * Behavioral tests for the Combat view-model, driving the real rune VM through stable boundaries
 * (set character + graph, call an action, read the derived). Guards the concentration + condition
 * fixes (CVM-bug1/2). Asserts behavior, not internal shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from '$lib/storage/memory';
import { loadContent, type ContentGraph } from '$lib/content/loader';
import { newCharacter, type Character } from '$lib/character/schema';
import { spellRow } from '$lib/combat/helpers';
import { combat } from './state.svelte';

const S = 'SRD 5.2.1';

async function graphOf(): Promise<ContentGraph> {
	const st = new MemoryStorage();
	await st.write(
		'c/spells_srd.csv',
		[
			'id,systems,source,name_en,level,school,casting_time,range,duration,components,concentration',
			`bless,5.5e,${S},Bless,1,enchantment,action,30 ft,1 minute,V S M,true`,
			`fire-bolt,5.5e,${S},Fire Bolt,0,evocation,action,120 ft,instant,V S,false`
		].join('\n')
	);
	await st.write(
		'c/conditions_srd.csv',
		[
			'id,systems,source,name_en',
			`prone,5.5e,${S},Prone`,
			`grappled,5e,${S},Grappled` // a DIFFERENT edition — must NOT appear for a 5.5e character
		].join('\n')
	);
	const g = await loadContent(st, ['c']);
	expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
	return g;
}

const noModifiers = { altKey: false, ctrlKey: false, metaKey: false } as unknown as Event;

describe('CombatVM · concentration (CVM-bug1)', () => {
	let graph: ContentGraph;
	let character: Character;
	beforeEach(async () => {
		graph = await graphOf();
		character = newCharacter('valen', 'Valen', '5.5e');
		combat.graph = graph;
		combat.character = character;
	});

	it('reads play.concentration and resolves it to the spell name (not a label containing "bless")', () => {
		expect(combat.conc).toBeNull();
		character.play.concentration = `spell:${S}:bless`;
		expect(combat.conc?.label).toBe('Bless');
	});

	it('casting a concentration spell sets it as the active concentration', () => {
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		expect(character.play.concentration).toBe(`spell:${S}:bless`);
		expect(combat.conc?.label).toBe('Bless');
	});

	it('casting a non-concentration spell leaves concentration untouched', () => {
		character.play.concentration = `spell:${S}:bless`;
		combat.cast(spellRow(graph, `spell:${S}:fire-bolt`, 'on')!, noModifiers);
		expect(character.play.concentration).toBe(`spell:${S}:bless`);
	});

	it('clearConcentration stops concentrating', () => {
		character.play.concentration = `spell:${S}:bless`;
		combat.clearConcentration();
		expect(character.play.concentration).toBeNull();
	});
});

describe('CombatVM · round counter is the persisted play.round (CVM-9)', () => {
	it('enters combat at round 1 and Next turn advances the persisted counter', async () => {
		const graph = await graphOf();
		const character = newCharacter('valen', 'Valen', '5.5e');
		combat.graph = graph;
		combat.character = character;
		character.play.inCombat = false;
		combat.toggleCombat(); // enter combat
		expect(character.play.round).toBe(1);
		expect(combat.round).toBe(1);
		combat.nextTurn();
		expect(character.play.round).toBe(2); // advanced on the persisted field, not a VM copy
		expect(combat.round).toBe(2);
	});
});

describe('CombatVM · conditionList uses the character system (CVM-bug2)', () => {
	it('lists conditions for the character system, not a hardcoded edition', async () => {
		const graph = await graphOf();
		combat.graph = graph;
		combat.character = newCharacter('valen', 'Valen', '5.5e');
		expect(combat.conditionList).toContain('Prone'); // 5.5e
		expect(combat.conditionList).not.toContain('Grappled'); // 5e-only
	});
});
