/*
 * Behavioral tests for the Combat view-model, driving the real rune VM through stable boundaries
 * (set character + graph, call an action, read the derived). Guards the concentration + condition
 * fixes (CVM-bug1/2). Asserts behavior, not internal shape.
 */
import 'fake-indexeddb/auto'; // the VM's saveCharacterToStore hits IndexedDB (rest/level-up) — provide it
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
	await st.write(
		'c/items_srd.csv',
		[
			'id,systems,source,name_en,category,item_type,damage,damage_type,properties',
			`dagger,5.5e,${S},Dagger,weapon,melee weapon,1d4,piercing,finesse`
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
		combat.economy.toggleCombat(); // enter combat
		expect(character.play.round).toBe(1);
		expect(combat.round).toBe(1);
		combat.economy.nextTurn();
		expect(character.play.round).toBe(2); // advanced on the persisted field, not a VM copy
		expect(combat.round).toBe(2);
	});
});

describe('CombatVM · spending a resource (UBUG-5)', () => {
	it('spends the resource pip (and has a name to toast) when clicked', async () => {
		const graph = await graphOf();
		const character = newCharacter('valen', 'Valen', '5.5e');
		character.play.autoCalc = true;
		character.play.effects = [
			{ iid: '1', label: 'Rage', effects: ['grant-resource:rage:3:long'], positive: true }
		];
		combat.graph = graph;
		combat.character = character;

		expect(combat.sheet?.resources.find((r) => r.id === 'rage')?.name).toBe('Rage');
		expect(combat.resources.resourceSpent('rage')).toBe(0);
		combat.resources.resourceClick('rage', 3, 2); // click the rightmost available pip → spend 1
		expect(combat.resources.resourceSpent('rage')).toBe(1);
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

/*
 * S2 SPLIT NET — pins the behavior of every area CombatVM is about to be split into (roll/log, HP,
 * action economy, rests, spell grouping, level-up, attacks). Asserts behavior (state in → state out),
 * not internal shape, so the split can regroup methods freely as long as these survive. RNG is not
 * seeded here → assert structure/labels/ranges, never exact rolled totals.
 */
describe('CombatVM · S2 split net', () => {
	let graph: ContentGraph;
	let character: Character;
	beforeEach(async () => {
		graph = await graphOf();
		character = newCharacter('valen', 'Valen', '5.5e');
		character.play.hp = { current: 20, max: 20, temp: 0 };
		character.build.classes = [{ class: `class:${S}:wizard`, level: 3 }];
		character.build.spells = [
			{ spell: `spell:${S}:fire-bolt`, prepared: true, alwaysPrepared: false },
			{ spell: `spell:${S}:bless`, prepared: true, alwaysPrepared: false }
		];
		character.build.inventory = [
			{ item: `item:${S}:dagger`, qty: 1, equipped: true, attuned: false }
		];
		combat.graph = graph;
		combat.character = character;
	});

	it('roll/log: rollDiceNow prepends a labelled entry with a numeric total', () => {
		const before = combat.tray.log.length;
		combat.tray.rollDiceNow('Stealth', { 20: 1 }, 5);
		expect(combat.tray.log.length).toBe(before + 1);
		expect(combat.tray.log[0]!.label).toBe('Stealth');
		expect(typeof combat.tray.log[0]!.total).toBe('number');
	});

	it('HP: damage soaks temp HP first, then current; heal clamps to max', () => {
		character.play.hp = { current: 20, max: 20, temp: 5 };
		combat.hpAmount = 8;
		combat.damage(); // 5 soaked by temp, 3 off current
		expect(character.play.hp.temp).toBe(0);
		expect(character.play.hp.current).toBe(17);
		combat.hpAmount = 100;
		combat.heal(); // clamps to max
		expect(character.play.hp.current).toBe(20);
	});

	it('action economy: in combat a spell spends its slot and the second cast is blocked', () => {
		character.play.inCombat = true;
		character.play.turn = { action: 0, bonus: 0, reaction: 0, move: 0 };
		const fireBolt = spellRow(graph, `spell:${S}:fire-bolt`, 'on')!;
		combat.cast(fireBolt, noModifiers); // action ct → spends the action
		expect(character.play.turn.action).toBe(1);
		combat.cast(fireBolt, noModifiers); // none left → blocked, stays 1
		expect(character.play.turn.action).toBe(1);
		combat.economy.nextTurn(); // refreshes the economy
		expect(character.play.turn.action).toBe(0);
	});

	it('rests: a long rest clears spent slots and restores HP to max', () => {
		character.play.spellSlotsSpent = { '1': 2 };
		character.play.hp = { current: 3, max: 20, temp: 4 };
		combat.resources.rest('long');
		expect(character.play.spellSlotsSpent).toEqual({});
		expect(character.play.hp.current).toBe(20);
		expect(character.play.hp.temp).toBe(0);
	});

	it('spell grouping: level mode yields a Cantrips group and a 1st-level group', () => {
		const keys = combat.spellGroups.map((g) => g.key);
		expect(keys).toContain('0'); // Fire Bolt (cantrip)
		expect(keys).toContain('1'); // Bless (1st level)
	});

	it('level-up: advances the chosen class by one and stays under the cap', () => {
		expect(combat.canLevelUp).toBe(true);
		combat.levelUp(0);
		expect(character.build.classes[0]!.level).toBe(4);
	});

	it('attacks: an equipped weapon + Unarmed Strike are offered; attackRoll logs a roll', () => {
		const names = combat.attacks.map((a) => a.name);
		expect(names).toContain('Dagger');
		expect(names).toContain('Unarmed Strike');
		const before = combat.tray.log.length;
		combat.attackRoll(combat.attacks[0]!, noModifiers);
		expect(combat.tray.log.length).toBe(before + 1);
	});
});
