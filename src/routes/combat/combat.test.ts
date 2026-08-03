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
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';
import { spellRow } from '$lib/combat/helpers';
import { combat } from './state.svelte';
import { ResourceTracker } from './resources.svelte';

const S = 'SRD 5.2.1';

async function graphOf(): Promise<ContentGraph> {
	const st = new MemoryStorage();
	await st.write(
		'c/spells_srd.csv',
		[
			'id,systems,source,name_en,level,school,casting_time,range,duration,components,concentration,effects',
			`bless,5.5e,${S},Bless,1,enchantment,action,30 ft,"Concentration, up to 1 minute",V S M,true,flat_bonus:saves+1d4`,
			`shield_of_faith,5.5e,${S},Shield of Faith,1,abjuration,bonus,60 ft,"Concentration, up to 10 minutes",V S M,true,flat_bonus:ac+2`,
			`fire_bolt,5.5e,${S},Fire Bolt,0,evocation,action,120 ft,instant,V S,false,`,
			// a token-less CONCENTRATION control spell (Model C: must still get a timed carrier)
			`hold_person,5.5e,${S},Hold Person,2,enchantment,action,60 ft,"Concentration, up to 1 minute",V S M,true,`
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
			'id,systems,source,name_en,category,item_type,damage,properties',
			`dagger,5.5e,${S},Dagger,weapon,melee weapon,1d4 piercing,finesse`
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
		combat.cast(spellRow(graph, `spell:${S}:fire_bolt`, 'on')!, noModifiers);
		expect(character.play.concentration).toBe(`spell:${S}:bless`);
	});

	it('clearConcentration stops concentrating', () => {
		character.play.concentration = `spell:${S}:bless`;
		combat.clearConcentration();
		expect(character.play.concentration).toBeNull();
	});
});

describe('CombatVM · casting applies the spell effect (EFX-2)', () => {
	let graph: ContentGraph;
	let character: Character;
	beforeEach(async () => {
		graph = await graphOf();
		character = newCharacter('valen', 'Valen', '5.5e');
		combat.graph = graph;
		combat.character = character;
	});
	const blessEffect = () => character.play.effects.find((e) => e.source === `spell:${S}:bless`);

	it("casting adds the spell's tokens as a runtime effect with the parsed duration", () => {
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		const eff = blessEffect();
		expect(eff?.label).toBe('Bless');
		expect(eff?.effects).toEqual(['flat_bonus:saves+1d4']);
		expect(eff?.durationRounds).toBe(10); // "up to 1 minute"
	});

	it('a NON-concentration spell with no tokens applies nothing', () => {
		combat.cast(spellRow(graph, `spell:${S}:fire_bolt`, 'on')!, noModifiers);
		expect(character.play.effects).toEqual([]);
	});

	it('a token-less CONCENTRATION spell still gets a timed carrier (Model C — CONCENTRATION-PLAN)', () => {
		combat.cast(spellRow(graph, `spell:${S}:hold_person`, 'on')!, noModifiers);
		const carrier = character.play.effects.find((e) => e.source === `spell:${S}:hold_person`);
		expect(carrier).toBeTruthy();
		expect(carrier?.effects).toEqual([]); // no tokens — just the concentration timer
		expect(carrier?.durationRounds).toBe(10); // "up to 1 minute" = 10 rounds
		expect(character.play.concentration).toBe(`spell:${S}:hold_person`);
	});

	it('the token-less carrier expiring ENDS concentration (the timer fix, Model C)', () => {
		character.play.round = 0;
		combat.cast(spellRow(graph, `spell:${S}:hold_person`, 'on')!, noModifiers);
		expect(character.play.concentration).toBe(`spell:${S}:hold_person`);
		combat.economy.advanceTime(10); // 1 minute → the carrier times out
		expect(character.play.effects).toEqual([]); // carrier gone
		expect(character.play.concentration).toBeNull(); // …and concentration ended with it
	});

	it('re-casting refreshes instead of stacking a duplicate', () => {
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		expect(character.play.effects.filter((e) => e.source === `spell:${S}:bless`).length).toBe(1);
	});

	it("replacing concentration removes the prior spell's effect; clearing removes the current one", () => {
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.cast(spellRow(graph, `spell:${S}:shield_of_faith`, 'on')!, noModifiers);
		expect(blessEffect()).toBeUndefined(); // Bless dropped with its concentration
		expect(character.play.concentration).toBe(`spell:${S}:shield_of_faith`);
		expect(character.play.effects.some((e) => e.label === 'Shield of Faith')).toBe(true);
		combat.clearConcentration();
		expect(character.play.effects).toEqual([]);
	});
});

describe('CombatVM · concentration ends on 0 HP / damage reminder (CONCENTRATION-PLAN §7/§6)', () => {
	let graph: ContentGraph;
	let character: Character;
	beforeEach(async () => {
		graph = await graphOf();
		character = newCharacter('valen', 'Valen', '5.5e');
		combat.graph = graph;
		combat.character = character;
	});

	it('dropping to 0 HP ends concentration (endConcentrationIfBroken, §7)', () => {
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		expect(character.play.concentration).toBe(`spell:${S}:bless`);
		character.play.hp.current = 0;
		combat.endConcentrationIfBroken();
		expect(character.play.concentration).toBeNull();
		expect(character.play.effects).toEqual([]); // the carrier goes down with it
	});

	it('surviving damage does NOT auto-drop concentration — it only reminds (§6)', () => {
		character.play.hp = { current: 20, max: 20, temp: 0 };
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.hpAmount = 6;
		combat.damage();
		expect(character.play.hp.current).toBe(14);
		combat.endConcentrationIfBroken(); // still up → nothing ends
		expect(character.play.concentration).toBe(`spell:${S}:bless`);
	});
});

/** A caster graph (wizard with a full slot table) + a level-1 damage spell that upcasts, so an
 *  end-to-end cast folds the structured `upcast` delta into the rolled dice (UPCAST slice 1). */
async function casterGraphOf(): Promise<ContentGraph> {
	const st = new MemoryStorage();
	await st.write(
		'c/classes_srd.csv',
		[
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int`
		].join('\n')
	);
	await st.write(
		'c/spell_slots_srd.csv',
		[
			'id,systems,source,kind,level,slot_1,slot_2,slot_3,slot_4,slot_5,slot_6,slot_7,slot_8,slot_9',
			`full_5,5.5e,${S},full,5,4,3,2,0,0,0,0,0,0`
		].join('\n')
	);
	await st.write(
		'c/spells_srd.csv',
		[
			'id,systems,source,name_en,level,school,casting_time,range,duration,components,concentration,resolution,save_ability,damage,upcast,effects',
			// level-1 save-damage spell: base 3d8, +1d8 per slot above 1st
			`chromatic_orb,5.5e,${S},Chromatic Orb,1,evocation,action,90 ft,Instantaneous,V S M,false,save,dex,3d8 fire,damage:per_slot(1d8)`,
			// level-1 healing spell: base 1d8 + spellcasting mod, +1d8 per slot above 1st
			`cure_wounds,5.5e,${S},Cure Wounds,1,evocation,action,Touch,Instantaneous,V S,false,auto,,1d8,heal:per_slot(1d8)`,
			// a spell whose upcast formula is broken → must degrade (base only), never wrong dice
			`bad_bolt,5.5e,${S},Bad Bolt,1,evocation,action,120 ft,Instantaneous,V S,false,save,dex,2d6 fire,damage:per_slot(`,
			// a token-less concentration spell whose DURATION upcasts (absolute rounds) — Hunter's Mark-style
			`entangle,5.5e,${S},Entangle,1,conjuration,action,90 ft,"Concentration, up to 1 minute",V S,true,save,str,,"duration:step(slot, 1->10, 3->30)"`,
			// a MULTI-TYPE attack spell (Ice Knife): 1d10 piercing base + 2d6 cold base; upcast scales ONLY
			// the cold sub-slot (item 2) — the delta must route to the cold part, not a typeless pool
			`ice_knife,5.5e,${S},Ice Knife,1,conjuration,action,60 ft,Instantaneous,S M,false,attack,,1d10 piercing; 2d6 cold,damage:cold:per_slot(1d6)`,
			// a FLAT heal (Heal-style): 70 hit points, +10 per slot, NO dice → no spellcasting mod (item 6)
			`flat_heal,5.5e,${S},Flat Heal,1,evocation,action,Touch,Instantaneous,V S,false,auto,,70,heal:per_slot(10),`,
			// a COUNT spell (Scorching Ray-style): its ray count scales as an absolute total (items 1/8)
			`scorch,5.5e,${S},Scorch,2,evocation,action,120 ft,Instantaneous,V S,false,attack,,2d6 fire,count:slot+1,`,
			// a COUNT cantrip (Eldritch Blast): scales BEAMS not die size → must not die-multiply (item 9)
			`blast,5.5e,${S},Blast,0,evocation,action,120 ft,Instantaneous,V S,false,attack,,1d10 force,"count:step(level, 1->1, 5->2, 11->3, 17->4)",`,
			// a DIE-scaling cantrip (Fire Bolt): its die DOES multiply at 5/11/17 (unchanged, item 9)
			`fbolt,5.5e,${S},FBolt,0,evocation,action,120 ft,Instantaneous,V S,false,attack,,1d10 fire,,`,
			// an hp_max spell (Aid): base +5 hp_max token, upcast adds +5 per slot as ANOTHER fold token (item 3)
			`aid,5.5e,${S},Aid,2,abjuration,action,30 ft,8 hours,V S M,false,none,,,hp_max:per_slot(5),flat_bonus:hp_max+5`,
			// a temp-HP spell (False Life): rolls its dice + upcast delta, NEVER adds the spellcasting mod (item 3)
			`false_life,5.5e,${S},False Life,1,necromancy,action,Self,1 hour,V S M,false,temp,,1d4 +4,temp_hp:per_slot(5),`
		].join('\n')
	);
	const g = await loadContent(st, ['c']);
	return g;
}

describe('CombatVM · structured upcast folds into the cast roll (UPCAST slice 1)', () => {
	let graph: ContentGraph;
	let character: Character;
	/** Number of `dN(` dice of a given size in the newest roll-log entry's expr. */
	const diceOf = (sides: number) =>
		(combat.tray.log[0]?.expr.match(new RegExp(`d${sides}\\(`, 'g')) ?? []).length;

	beforeEach(async () => {
		graph = await casterGraphOf();
		character = newCharacter('mage', 'Mage', '5.5e');
		character.build.abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 10 };
		character.build.classes = [{ class: `class:${S}:wizard`, level: 5 }];
		combat.graph = graph;
		combat.character = character;
	});

	it('at the base slot the delta is 0 (Chromatic Orb rolls its base 3d8)', () => {
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		expect(character.play.spellSlotsSpent['1']).toBe(1); // spent the level-1 slot
		expect(diceOf(8)).toBe(3);
	});

	it('auto-upcast (level-1 slots exhausted → cast from level 2) adds +1d8 → 4d8', () => {
		character.play.spellSlotsSpent = { '1': 4 }; // no level-1 slots left
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		expect(character.play.spellSlotsSpent['2']).toBe(1); // spilled up to a level-2 slot
		expect(diceOf(8)).toBe(4); // 3d8 base + 1d8 upcast
	});

	it('a healing upcast folds base + delta + spellcasting mod (int +3) at slot 2', () => {
		character.play.spellSlotsSpent = { '1': 4 };
		combat.cast(spellRow(graph, `spell:${S}:cure_wounds`, 'on')!, noModifiers);
		expect(diceOf(8)).toBe(2); // 1d8 base + 1d8 upcast
		expect(combat.tray.log[0]?.expr).toContain('+3'); // spellcasting mod still added
	});

	it('a broken upcast formula degrades to base dice, never silently-wrong dice (H11)', () => {
		character.play.spellSlotsSpent = { '1': 4 };
		combat.cast(spellRow(graph, `spell:${S}:bad_bolt`, 'on')!, noModifiers);
		expect(diceOf(6)).toBe(2); // base 2d6 only — the broken delta is dropped
	});

	it('a duration upcast sets the concentration carrier timer (absolute rounds) at the cast slot', () => {
		const cast = (spent: Record<string, number>) => {
			character.play.spellSlotsSpent = { ...spent };
			combat.cast(spellRow(graph, `spell:${S}:entangle`, 'on')!, noModifiers);
			return character.play.effects.find((e) => e.source === `spell:${S}:entangle`);
		};
		expect(cast({})?.durationRounds).toBe(10); // base slot 1 → step(1,…) = 10
		expect(cast({ '1': 4, '2': 3 })?.durationRounds).toBe(30); // spills to slot 3 → step(3,…) = 30
	});

	/** The typed damage part of a given type in the newest roll's damage lines, or undefined. */
	const dmgPartOf = (type: string) => combat.tray.log[0]?.damage?.find((p) => p.type === type);
	/** Count of `dN(` dice in a specific damage-part's expr (the multi-type breakdown). */
	const partDiceOf = (type: string, sides: number) =>
		(dmgPartOf(type)?.expr.match(new RegExp(`d${sides}\\(`, 'g')) ?? []).length;

	it('Ice Knife: the cold upcast delta routes to the COLD part, piercing untouched (item 2)', () => {
		// at slot 2 the cold sub-slot gains +1d6 → 3d6 cold; piercing stays 1d10 base
		character.play.spellSlotsSpent = { '1': 4 };
		combat.cast(spellRow(graph, `spell:${S}:ice_knife`, 'on')!, noModifiers);
		expect(partDiceOf('piercing', 10)).toBe(1); // piercing 1d10 base — its own damage part, unscaled
		expect(partDiceOf('cold', 6)).toBe(3); // 2d6 base + 1d6 upcast, ONLY on the cold part
	});

	it('Ice Knife at the base slot keeps both types unscaled (no phantom empty part)', () => {
		combat.cast(spellRow(graph, `spell:${S}:ice_knife`, 'on')!, noModifiers);
		expect(partDiceOf('cold', 6)).toBe(2); // base 2d6 cold, no delta
		expect((combat.tray.log[0]?.damage ?? []).map((p) => p.type).sort()).toEqual([
			'cold',
			'piercing'
		]);
	});

	it('a FLAT heal (Heal 70) applies its base + upcast delta with NO spellcasting mod (item 6)', () => {
		character.play.spellSlotsSpent = { '1': 4 }; // spill to a level-2 slot → +10
		combat.cast(spellRow(graph, `spell:${S}:flat_heal`, 'on')!, noModifiers);
		expect(combat.tray.log[0]?.total).toBe(80); // 70 base + 10 upcast, NOT + int mod
	});

	it('a flat heal at the base slot heals exactly its flat value (70)', () => {
		combat.cast(spellRow(graph, `spell:${S}:flat_heal`, 'on')!, noModifiers);
		expect(combat.tray.log[0]?.total).toBe(70);
	});

	it('Aid: the hp_max upcast adds ANOTHER fold token to the carrier per slot above base (item 3)', () => {
		const carrier = () => character.play.effects.find((ef) => ef.source === `spell:${S}:aid`);
		combat.cast(spellRow(graph, `spell:${S}:aid`, 'on')!, noModifiers); // base slot 2 → no delta
		expect(carrier()?.effects).toEqual(['flat_bonus:hp_max+5']);
		character.play.spellSlotsSpent = { '2': 3 }; // level-2 gone → spill to slot 3 → +5 delta
		combat.cast(spellRow(graph, `spell:${S}:aid`, 'on')!, noModifiers);
		expect(carrier()?.effects).toEqual(['flat_bonus:hp_max+5', 'flat_bonus:hp_max+5']);
	});

	it('False Life: temp HP rolls its dice + upcast delta, NO spellcasting mod (item 3)', () => {
		combat.cast(spellRow(graph, `spell:${S}:false_life`, 'on')!, noModifiers); // base slot 1
		expect(combat.tray.log[0]?.label).toContain('temp HP');
		expect(combat.tray.log[0]?.expr).toContain('+4'); // 1d4 + 4 base, int mod NOT added
		character.play.spellSlotsSpent = { '1': 4 }; // spill to slot 2 → +5 delta
		combat.cast(spellRow(graph, `spell:${S}:false_life`, 'on')!, noModifiers);
		expect(combat.tray.log[0]?.expr).toContain('+9'); // 4 base + 5 upcast
	});

	it('castPreview: a damage upcast shows the extra dice at a slot, nothing at base (items 1/8)', () => {
		const r = spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!;
		expect(combat.castPreview(r, 1)).toBe(''); // base slot → no upcast
		expect(combat.castPreview(r, 3)).toContain('+2d8'); // 2 slots up → +2d8
	});

	it('castPreview: a count spell shows its scaled total (Scorching Ray-style, item 8)', () => {
		const r = spellRow(graph, `spell:${S}:scorch`, 'on')!;
		expect(combat.castPreview(r, 2)).toContain('3'); // count:slot+1 at slot 2 = 3
		expect(combat.castPreview(r, 3)).toContain('4'); // …4 at slot 3
	});

	it('a count cantrip (EB) does NOT die-multiply; a damage cantrip (Fire Bolt) still does (item 9)', () => {
		combat.cast(spellRow(graph, `spell:${S}:fbolt`, 'on', 5)!, noModifiers); // char level 5
		expect(partDiceOf('fire', 10)).toBe(2); // die-scaling: 1d10 → 2d10 at level 5
		combat.cast(spellRow(graph, `spell:${S}:blast`, 'on', 5)!, noModifiers);
		expect(partDiceOf('force', 10)).toBe(1); // count-scaling: stays 1d10 (2nd beam = separate roll)
	});

	it('the upcast roll label names the slot AND what it added (B8 provenance, item 4)', () => {
		character.play.spellSlotsSpent = { '1': 4, '2': 3 }; // spill to slot 3
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		expect(combat.tray.log[0]?.label).toContain('slot 3');
		expect(combat.tray.log[0]?.label).toContain('+2d8'); // the delta is named, not just the slot
	});

	it('the picker casts at the chosen slot via castAtSlot (item 1)', () => {
		const r = spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!;
		combat.upcastSpell = r; // openUpcast arms this + anchors the menu (DOM); here we set it directly
		combat.castAtSlot(3, noModifiers); // pick a level-3 slot
		expect(character.play.spellSlotsSpent['3']).toBe(1);
		expect(diceOf(8)).toBe(5); // 3d8 base + 2d8 (slot 3 vs base 1)
	});

	it('an explicit slot choice (picker) upcasts from that level even with lower slots free', () => {
		const r = spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!;
		expect(combat.castableSlots(r)).toEqual([1, 2, 3]); // all open slot levels offered
		combat.cast(r, noModifiers, { slot: 3 }); // deliberately burn a level-3 slot
		expect(character.play.spellSlotsSpent['3']).toBe(1);
		expect(diceOf(8)).toBe(5); // 3d8 base + 2d8 (slot 3 vs base 1)
	});
});

describe('CombatVM · effect lifecycle (EFX-4)', () => {
	let graph: ContentGraph;
	let character: Character;
	beforeEach(async () => {
		graph = await graphOf();
		character = newCharacter('valen', 'Valen', '5.5e');
		combat.graph = graph;
		combat.character = character;
	});

	it('next turn expires a round-timed effect (and only then)', () => {
		character.play.round = 1;
		character.play.effects = [
			{ iid: 'a', label: 'Bless', effects: [], positive: true, durationRounds: 2, startedRound: 1 },
			{ iid: 'b', label: 'Curse', effects: [], positive: false } // indefinite — never expires
		];
		combat.economy.nextTurn(); // round 2 — Bless has 1 round left
		expect(character.play.effects.map((e) => e.iid)).toEqual(['a', 'b']);
		combat.economy.nextTurn(); // round 3 = started 1 + duration 2 → expired
		expect(character.play.effects.map((e) => e.iid)).toEqual(['b']);
	});

	it('B19: advanceTime skips rounds out of combat and expires what timed out', () => {
		character.play.round = 0;
		character.play.inCombat = false;
		character.play.effects = [
			// a 10-round (1 min) Bless cast outside combat + an indefinite effect
			{
				iid: 'bless',
				label: 'Bless',
				effects: [],
				positive: true,
				durationRounds: 10,
				startedRound: 0
			},
			{ iid: 'mark', label: 'Mark', effects: [], positive: false }
		];
		combat.economy.advanceTime(1); // +1 round → 8 s in, Bless still up
		expect(character.play.round).toBe(1);
		expect(character.play.effects.map((e) => e.iid)).toEqual(['bless', 'mark']);
		combat.economy.advanceTime(10); // +1 min → round 11 ≥ 0 + 10 → Bless expires
		expect(character.play.round).toBe(11);
		expect(character.play.effects.map((e) => e.iid)).toEqual(['mark']);
	});

	it('B19: hasTimedEffects is true only while a round-timed effect is active', () => {
		character.play.effects = [{ iid: 'x', label: 'X', effects: [], positive: false }];
		expect(combat.hasTimedEffects).toBe(false); // indefinite only
		character.play.effects = [
			{ iid: 'y', label: 'Y', effects: [], positive: true, durationRounds: 5, startedRound: 0 }
		];
		expect(combat.hasTimedEffects).toBe(true);
	});

	it('an expiring cast_linked effect also ends its concentration', () => {
		character.play.round = 1;
		character.play.concentration = `spell:${S}:bless`;
		character.play.effects = [
			{
				iid: 'a',
				label: 'Bless',
				source: `spell:${S}:bless`,
				effects: [],
				positive: true,
				durationRounds: 1,
				startedRound: 1
			}
		];
		combat.economy.nextTurn();
		expect(character.play.effects).toEqual([]);
		expect(character.play.concentration).toBeNull();
	});

	it('a short rest outlives effects up to 1 h (600 rds); a long rest outlives all timed ones', () => {
		const timed = (iid: string, rounds: number) => ({
			iid,
			label: iid,
			effects: [],
			positive: true,
			durationRounds: rounds,
			startedRound: 0
		});
		character.play.effects = [
			timed('short-lived', 10),
			timed('eight-hours', 4800),
			{ iid: 'forever', label: 'forever', effects: [], positive: false }
		];
		combat.resources.rest('short');
		expect(character.play.effects.map((e) => e.iid)).toEqual(['eight-hours', 'forever']);
		combat.resources.rest('long');
		expect(character.play.effects.map((e) => e.iid)).toEqual(['forever']);
	});

	it('a long rest ends concentration unconditionally, even with no linked effect (A13)', () => {
		character.play.concentration = `spell:${S}:bless`; // no matching entry in play.effects
		character.play.effects = [];
		combat.resources.rest('short');
		expect(character.play.concentration).toBe(`spell:${S}:bless`); // short rest doesn't force it
		combat.resources.rest('long');
		expect(character.play.concentration).toBeNull();
	});

	it('short rest expiry uses REMAINING rounds, not total duration (A12)', () => {
		character.play.round = 999;
		character.play.effects = [
			// 1000 total but only 1 round LEFT → a 1 h short rest outlasts it
			{
				iid: 'almost-done',
				label: 'x',
				effects: [],
				positive: true,
				durationRounds: 1000,
				startedRound: 0
			},
			// just started, 5000 rounds left → survives a short rest
			{
				iid: 'fresh-long',
				label: 'y',
				effects: [],
				positive: true,
				durationRounds: 5000,
				startedRound: 999
			}
		];
		combat.resources.rest('short');
		// pre-fix both survived (compared totals > 600); now only the still-running one does
		expect(character.play.effects.map((e) => e.iid)).toEqual(['fresh-long']);
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
			{ iid: '1', label: 'Rage', effects: ['grant_resource:rage:3:long'], positive: true }
		];
		combat.graph = graph;
		combat.character = character;

		expect(combat.sheet?.resources.find((r) => r.id === 'rage')?.name).toBe('Rage');
		expect(combat.resources.resourceSpent('rage')).toBe(0);
		combat.resources.resourceClick('rage', 3, 2); // click the rightmost available pip → spend 1
		expect(combat.resources.resourceSpent('rage')).toBe(1);
	});

	it('useResource spends one per use and blocks (no change) when the pool is exhausted (UBUG-8)', async () => {
		const graph = await graphOf();
		const character = newCharacter('valen', 'Valen', '5.5e');
		character.play.autoCalc = true;
		character.play.effects = [
			{ iid: '1', label: 'Rage', effects: ['grant_resource:rage:2:long'], positive: true }
		];
		combat.graph = graph;
		combat.character = character;

		expect(combat.resources.resourceSpent('rage')).toBe(0);
		combat.resources.useResource('rage', 2);
		expect(combat.resources.resourceSpent('rage')).toBe(1);
		combat.resources.useResource('rage', 2);
		expect(combat.resources.resourceSpent('rage')).toBe(2); // now exhausted
		combat.resources.useResource('rage', 2);
		expect(combat.resources.resourceSpent('rage')).toBe(2); // blocked — stays at max, no overspend
	});

	it('clamps stale spent state so a shrunk/removed resource never shows negative left', async () => {
		const graph = await graphOf();
		const character = newCharacter('valen', 'Valen', '5.5e');
		character.play.autoCalc = true;
		character.play.effects = [
			{ iid: '1', label: 'Rage', effects: ['grant_resource:rage:2:long'], positive: true }
		];
		// stored spent (3) exceeds the live max (2), and 'ki' no longer exists at all
		character.play.resourcesSpent = { rage: 3, ki: 5 };
		combat.graph = graph;
		combat.character = character;

		expect(combat.resources.resourceSpent('rage')).toBe(2); // clamped to max, not 3
		expect(combat.resources.resourceSpent('ki')).toBe(0); // orphan → 0, no phantom pips
	});
});

describe('CombatVM · conditionList uses the character system (CVM-bug2)', () => {
	it('lists conditions for the character system, not a hardcoded edition', async () => {
		const graph = await graphOf();
		combat.graph = graph;
		combat.character = newCharacter('valen', 'Valen', '5.5e');
		const labels = combat.conditionList.map((c) => c.label);
		expect(labels).toContain('Prone'); // 5.5e
		expect(labels).not.toContain('Grappled'); // 5e-only
		expect(combat.conditionList.find((c) => c.label === 'Prone')?.id).toBe('prone'); // carries the id
	});
});

describe('CombatVM · incapacitated zeroes the action economy (G3)', () => {
	it('blocks action/bonus/reaction while incapacitated, restores when it ends', async () => {
		const graph = await graphOf();
		combat.graph = graph;
		const character = newCharacter('valen', 'Valen', '5.5e');
		character.play.autoCalc = true;
		character.play.inCombat = true;
		combat.character = character;

		// baseline: one of each slot, spending allowed
		expect(combat.economy.slotMax).toEqual({ action: 1, bonus: 1, reaction: 1 });
		expect(combat.economy.trySpend('action')).toBe(true);

		// apply Incapacitated → the id lands in facts.conditions (the row's own effects are irrelevant here)
		combat.addEffect({
			label: 'Incapacitated',
			tokens: ['apply_condition:incapacitated'],
			positive: false
		});
		expect(combat.economy.incapacitated).toBe(true);
		expect(combat.economy.slotMax).toEqual({ action: 0, bonus: 0, reaction: 0 });
		expect(combat.economy.trySpend('bonus')).toBe(false); // hard block, not exhaustion
		expect(combat.economy.trySpend('reaction')).toBe(false);

		// remove it → economy restored
		const iid = character.play.effects.find((e) => e.label === 'Incapacitated')?.iid;
		if (iid) combat.removeEffect(iid);
		expect(combat.economy.incapacitated).toBe(false);
		expect(combat.economy.slotMax).toEqual({ action: 1, bonus: 1, reaction: 1 });
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
			{ spell: `spell:${S}:fire_bolt`, prepared: true, alwaysPrepared: false },
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
		combat.tray.rollDiceNow({ label: 'Stealth', dice: { 20: 1 }, mod: 5 });
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
		const fireBolt = spellRow(graph, `spell:${S}:fire_bolt`, 'on')!;
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

	it('passive-senses skills persist onto the character ui, defaulting to the trio (D19)', () => {
		expect(combat.passiveSkills).toEqual(['perception', 'investigation', 'insight']);
		combat.togglePassive('arcana');
		expect(combat.passiveSkills).toContain('arcana');
		expect(character.ui.passiveSkills).toContain('arcana'); // written onto the character, not VM-local
		combat.togglePassive('perception');
		expect(combat.passiveSkills).not.toContain('perception');
	});

	it('ui.spellsHidden filters a spell out of the combat list (Issue #3)', () => {
		const rowNames = () => combat.spellGroups.flatMap((g) => g.rows.map((r) => r.name));
		expect(rowNames()).toContain('Fire Bolt');
		character.ui.spellsHidden = [`spell:${S}:fire_bolt`]; // hidden via the spellbook eye
		expect(rowNames()).not.toContain('Fire Bolt');
		expect(rowNames()).toContain('Bless'); // others unaffected
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

	// the effects panel controls the user asked for: choose duration on add, edit/remove on the panel
	it('addEffect applies the chosen newEffectDuration; 0 = indefinite (no duration field)', () => {
		combat.newEffectDuration = 4;
		combat.addEffect({ label: 'Haste', tokens: ['flat_bonus:ac+2'], positive: true });
		const added = character.play.effects.at(-1)!;
		expect(added.label).toBe('Haste');
		expect(added.durationRounds).toBe(4);

		combat.newEffectDuration = 0; // indefinite
		combat.addEffect({ label: 'Curse', tokens: [], positive: false });
		expect(character.play.effects.at(-1)!.durationRounds).toBeUndefined();
	});

	it('removeEffect drops the effect by its instance id', () => {
		combat.addEffect({ label: 'Temp', tokens: ['flat_bonus:ac+1'] });
		const iid = character.play.effects.at(-1)!.iid;
		const before = character.play.effects.length;
		combat.removeEffect(iid);
		expect(character.play.effects.length).toBe(before - 1);
		expect(character.play.effects.some((e) => e.iid === iid)).toBe(false);
	});

	it('bumpEffectDuration nudges rounds, and dropping to 0 makes it indefinite', () => {
		combat.newEffectDuration = 2;
		combat.addEffect({ label: 'Bless2', tokens: ['flat_bonus:saves+1d4'] });
		const iid = character.play.effects.at(-1)!.iid;
		const dur = () => character.play.effects.find((e) => e.iid === iid)!.durationRounds;
		combat.bumpEffectDuration(iid, 1);
		expect(dur()).toBe(3);
		combat.bumpEffectDuration(iid, -3); // past 1 → indefinite
		expect(dur()).toBeUndefined();
	});

	it('setEffectDuration sets an exact typed round count; 0/blank → indefinite', () => {
		combat.addEffect({ label: 'Typed', tokens: ['flat_bonus:ac+1'] });
		const iid = character.play.effects.at(-1)!.iid;
		const dur = () => character.play.effects.find((e) => e.iid === iid)!.durationRounds;
		combat.setEffectDuration(iid, 7);
		expect(dur()).toBe(7);
		combat.setEffectDuration(iid, 0); // typed 0 → until removed
		expect(dur()).toBeUndefined();
	});
});

describe('ResourceTracker · piece 3 spend-options', () => {
	const opt = (over: Partial<ResourceOption> = {}): ResourceOption => ({
		id: 'flurry',
		resourceId: 'ki',
		name: 'Flurry of Blows',
		description: '',
		action: 'note:Make two Unarmed Strikes',
		actionType: 'bonus_action',
		cost: 1,
		...over
	});
	const make = (spent: number, max: number) => {
		const c = {
			play: { resourcesSpent: { ki: spent } as Record<string, number> }
		} as unknown as Character;
		const sheet = {
			resources: [{ id: 'ki', name: 'Ki', max, recharge: 'short', source: 'Monk' }]
		} as unknown as CharacterSheet;
		return {
			t: new ResourceTracker(
				() => c,
				() => sheet
			),
			c
		};
	};

	it('affords + spends when the pool can pay, deducting the cost', () => {
		const { t, c } = make(0, 3);
		expect(t.canAffordOption(opt())).toBe(true);
		expect(t.spendOption(opt())).toBe(true);
		expect(c.play.resourcesSpent.ki).toBe(1);
	});

	it('blocks + leaves the pool untouched when exhausted', () => {
		const { t, c } = make(3, 3);
		expect(t.canAffordOption(opt())).toBe(false);
		expect(t.spendOption(opt())).toBe(false);
		expect(c.play.resourcesSpent.ki).toBe(3);
	});

	it('`x` cost prices at the chosen amount (variable spend)', () => {
		const { t, c } = make(0, 5);
		expect(t.canAffordOption(opt({ cost: 'x' }), 3)).toBe(true);
		expect(t.spendOption(opt({ cost: 'x' }), 3)).toBe(true);
		expect(c.play.resourcesSpent.ki).toBe(3);
		expect(t.canAffordOption(opt({ cost: 'x' }), 3)).toBe(false); // only 2 left
	});
});

/*
 * N2 executor — activateResourceOption composes resource + turn-slot spend + the action token,
 * ALL-OR-NOTHING (ACTIONS.md). Drives the real VM (economy + HP + resources). RNG unseeded → the heal
 * asserts a range, never an exact total. A `second_wind`/`action_surge` pool is granted via a play
 * effect (the same path the shipped fighter feature uses), so canAfford reads a real sheet resource.
 */
describe('CombatVM · N2 executor (activateResourceOption)', () => {
	const grant = (token: string): Character => {
		const c = newCharacter('rook', 'Rook', '5.5e');
		c.play.autoCalc = true;
		c.play.inCombat = true;
		c.play.hp = { current: 5, max: 20, temp: 0 };
		c.play.effects = [{ iid: '1', label: 'grant', effects: [token], positive: true }];
		return c;
	};
	const secondWind = (over: Partial<ResourceOption> = {}): ResourceOption => ({
		id: 'fighter_second_wind',
		resourceId: 'second_wind',
		name: 'Second Wind',
		description: '',
		action: 'heal:1d10+5',
		actionType: 'bonus_action',
		cost: 1,
		...over
	});

	it('heals, spends the resource AND costs the bonus action (composition)', async () => {
		const graph = await graphOf();
		const character = grant('grant_resource:second_wind:2:short');
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption(secondWind());
		expect(character.play.hp.current).toBeGreaterThan(5); // healed (1d10+5), clamped to max
		expect(character.play.hp.current).toBeLessThanOrEqual(20);
		expect(combat.resources.resourceSpent('second_wind')).toBe(1); // one use spent
		expect(character.play.turn.bonus).toBe(1); // the bonus action was consumed
	});

	it('all-or-nothing: no bonus action left → nothing applied (HP, resource, slot untouched)', async () => {
		const graph = await graphOf();
		const character = grant('grant_resource:second_wind:2:short');
		character.play.turn.bonus = 1; // bonus already used this turn
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption(secondWind());
		expect(character.play.hp.current).toBe(5); // no heal
		expect(combat.resources.resourceSpent('second_wind')).toBe(0); // resource NOT spent
	});

	it('all-or-nothing: pool exhausted → the bonus action is NOT spent', async () => {
		const graph = await graphOf();
		const character = grant('grant_resource:second_wind:1:short');
		character.play.resourcesSpent = { second_wind: 1 }; // the only use is gone
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption(secondWind());
		expect(character.play.hp.current).toBe(5); // no heal
		expect(character.play.turn.bonus).toBe(0); // slot preserved (validated before any mutation)
	});

	it('gain_action refunds one action this turn (Action Surge), free action costs no slot', async () => {
		const graph = await graphOf();
		const character = grant('grant_resource:action_surge:1:short');
		character.play.turn.action = 1; // the regular action is already used
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption({
			id: 'fighter_action_surge',
			resourceId: 'action_surge',
			name: 'Action Surge',
			description: '',
			action: 'gain_action',
			actionType: 'free',
			cost: 1
		});
		expect(character.play.turn.action).toBe(0); // one additional action granted back
		expect(combat.resources.resourceSpent('action_surge')).toBe(1);
	});

	it('rest:long grants a long rest — restores HP, resets slots, recharges pools; the consumable charge is NOT refunded', async () => {
		const graph = await graphOf();
		const character = newCharacter('rook', 'Rook', '5.5e');
		character.play.autoCalc = true;
		character.play.hp = { current: 5, max: 20, temp: 0 };
		character.play.spellSlotsSpent = { '1': 2 };
		character.play.resourcesSpent = { sorcery: 4 }; // a long-recharge pool, fully spent
		character.play.effects = [
			{
				iid: '1',
				label: 'grant',
				effects: [
					'grant_resource:angelic_slumber:1:consumable', // the potion — one-use, never auto-recharges
					'grant_resource:sorcery:4:long'
				],
				positive: true
			}
		];
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption({
			id: 'potion_angelic_slumber',
			resourceId: 'angelic_slumber',
			name: 'Potion of Angelic Slumber',
			description: '',
			action: 'rest:long',
			actionType: 'free',
			cost: 1
		});

		expect(character.play.hp.current).toBe(20); // long rest restored HP to max
		expect(character.play.spellSlotsSpent).toEqual({}); // all slots back
		expect(combat.resources.resourceSpent('sorcery')).toBe(0); // long-recharge pool refilled
		expect(combat.resources.resourceSpent('angelic_slumber')).toBe(1); // the charge stays spent (consumable)
	});
});

/*
 * Hit Dice — spend on a short rest to heal (roll die + CON, min 1); regain on a long rest, EDITION-
 * divergent (2014 half / 2024 all). The class ref isn't in this fixture graph, so the die defaults to
 * d8 (fine — we assert the mechanics: HP up, pool decrement, block, and the regain amount).
 */
describe('CombatVM · Hit Dice', () => {
	const charAt = (system: '5e' | '5.5e', level: number): Character => {
		const c = newCharacter('rook', 'Rook', system);
		c.build.classes = [{ class: `class:SRD:${'fighter'}`, level }]; // no row → d8 pool of `level`
		c.play.hp = { current: 5, max: 30, temp: 0 };
		return c;
	};

	it('spendHitDie heals (min 1) and decrements the pool; blocks when empty', async () => {
		const graph = await graphOf();
		const character = charAt('5.5e', 3); // d8 × 3
		combat.graph = graph;
		combat.character = character;
		expect(combat.hitDice).toEqual([{ die: 'd8', max: 3, spent: 0, left: 3 }]);

		combat.spendHitDie('d8');
		expect(character.play.hp.current).toBeGreaterThan(5); // healed d8 + CON (min 1)
		expect(combat.resources.hitDiceSpent('d8')).toBe(1);

		character.play.hitDiceSpent = { d8: 3 }; // exhaust the pool
		const hpBefore = character.play.hp.current;
		combat.spendHitDie('d8');
		expect(character.play.hp.current).toBe(hpBefore); // blocked — no heal
		expect(combat.resources.hitDiceSpent('d8')).toBe(3); // no overspend
	});

	it('long rest regains ALL Hit Dice in 5.5e, HALF (min 1) in 5e', async () => {
		const graph = await graphOf();
		// 2024: all spent dice come back
		const c24 = charAt('5.5e', 8); // d8 × 8
		c24.play.hitDiceSpent = { d8: 6 };
		combat.graph = graph;
		combat.character = c24;
		combat.resources.rest('long');
		expect(combat.resources.hitDiceSpent('d8')).toBe(0); // all 6 back

		// 2014: half the total (floor(8/2) = 4) come back → 6 spent − 4 = 2
		const c14 = charAt('5e', 8);
		c14.play.hitDiceSpent = { d8: 6 };
		combat.character = c14;
		combat.resources.rest('long');
		expect(combat.resources.hitDiceSpent('d8')).toBe(2);
	});
});

/*
 * short_one recharge (2024 Second Wind: regain ONE use on a short rest, all on a long rest). An open
 * enum member — not a boolean partial-recharge column (docs/AI-CONVENTIONS §1.5). Drives the real
 * rest() so the sheet resource carries the recharge policy end-to-end.
 */
describe('ResourceTracker · short_one partial recharge', () => {
	it('regains one use per short rest, all on a long rest', async () => {
		const graph = await graphOf();
		const character = newCharacter('rook', 'Rook', '5.5e');
		character.play.autoCalc = true;
		character.play.effects = [
			{ iid: '1', label: 'SW', effects: ['grant_resource:second_wind:3:short_one'], positive: true }
		];
		character.play.resourcesSpent = { second_wind: 3 }; // all three uses expended
		combat.graph = graph;
		combat.character = character;
		expect(combat.sheet?.resources.find((r) => r.id === 'second_wind')?.recharge).toBe('short_one');

		combat.resources.rest('short');
		expect(combat.resources.resourceSpent('second_wind')).toBe(2); // regained ONE, not all
		combat.resources.rest('short');
		expect(combat.resources.resourceSpent('second_wind')).toBe(1); // and one more
		combat.resources.rest('long');
		expect(combat.resources.resourceSpent('second_wind')).toBe(0); // long rest = all back
	});
});
