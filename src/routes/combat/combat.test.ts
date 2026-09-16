/*
 * Behavioral tests for the Combat view-model, driving the real rune VM through stable boundaries
 * (set character + graph, call an action, read the derived). Guards the concentration + condition
 * fixes (CVM-bug1/2). Asserts behavior, not internal shape.
 */
import { makeTempContentRoot } from '../../test-support/fixtures';
import 'fake-indexeddb/auto'; // the VM's saveCharacterToStore hits IndexedDB (rest/level-up) — provide it
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

/** What was toasted, in order. A notice is the deliverable for a few of these behaviours (a window
 *  opening, a resource restored), so the test has to be able to read what the player was told. */
const toasts: string[] = [];
vi.mock('svelte-sonner', () => ({
	toast: Object.assign((message: string) => toasts.push(message), { custom: () => {} }),
}));
import { loadPacks } from '../../test-support/real-content';
import { type ContentGraph } from '$lib/content/loader';
import { newCharacter, type Character } from '$lib/character/schema';
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';
import { AMENDMENT_KIND, spellRow } from '$lib/combat/helpers';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { DIE_ROLE } from '$lib/rules/dice';
import { combat } from './combat-view-model.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import { ResourceTracker } from './resource-tracker.svelte';
import { PanelLayout, PANEL_MOVE } from './panel-layout.svelte';
import { UNARMED_STRIKE_ID, numberedAttackRollName, attackNotes } from '$lib/combat/attacks';

const S = 'SRD 5.2.1';

async function graphOf(): Promise<ContentGraph> {
	return makeTempContentRoot({
		'spells_srd.csv': [
			'id,systems,source,name_en,level,school,casting_time,range,duration,components,concentration,effects',
			`bless,5.5e,${S},Bless,1,enchantment,action,30 ft,"Concentration, up to 1 minute",V S M,true,flat_bonus:saves+1d4`,
			`shield_of_faith,5.5e,${S},Shield of Faith,1,abjuration,bonus,60 ft,"Concentration, up to 10 minutes",V S M,true,flat_bonus:ac+2`,
			`fire_bolt,5.5e,${S},Fire Bolt,0,evocation,action,120 ft,instant,V S,false,`,
			// a token-less CONCENTRATION control spell (Model C: must still get a timed carrier)
			`hold_person,5.5e,${S},Hold Person,2,enchantment,action,60 ft,"Concentration, up to 1 minute",V S M,true,`,
		].join('\n'),
		'conditions_srd.csv': [
			'id,systems,source,name_en,max_level',
			`prone,5.5e,${S},Prone,`,
			`grappled,5e,${S},Grappled,`, // a DIFFERENT edition — must NOT appear for a 5.5e character
			`exhaustion,5.5e,${S},Exhaustion,6`, // the leveled one — its max_level is the lethal rung
		].join('\n'),
		'items_srd.csv': [
			'id,systems,source,name_en,category,tags,damage',
			`dagger,5.5e,${S},Dagger,weapon,"simple, melee, finesse",1d4 piercing`,
		].join('\n'),
	});
}

const noModifiers = { shiftKey: false } as unknown as Event;
/** A Shift-click: what `wantsTray` reads to open the roll tray instead of rolling instantly. */
const wantsTray = { shiftKey: true } as unknown as Event;

// the cast layer composes its roll NAMES and its upcast preview through the catalog, so a node test
// with no locale would see keys instead of the composition it is asserting on
beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

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
		combat.pendingConcentrationSave = null; // reset the singleton's transient UI between tests
	});

	it('dropping to 0 HP ends concentration (endConcentrationIfBroken, §7)', () => {
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		expect(character.play.concentration).toBe(`spell:${S}:bless`);
		character.play.hp.current = 0;
		combat.endConcentrationIfBroken();
		expect(character.play.concentration).toBeNull();
		expect(character.play.effects).toEqual([]); // the carrier goes down with it
	});

	it('surviving damage opens the B4 save banner (DC max(10,½dmg)) and does NOT auto-drop (§6/B4)', () => {
		character.play.hp = { current: 20, max: 20, temp: 0 };
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.hpAmount = 6;
		combat.damage();
		expect(character.play.hp.current).toBe(14);
		// 6 dmg → DC max(10, 3) = 10, owed for THIS spell
		expect(combat.pendingConcentrationSave).toEqual({ dc: 10, spell: `spell:${S}:bless` });
		expect(character.play.concentration).toBe(`spell:${S}:bless`); // never auto-dropped
	});

	it('DC is ⌊dmg/2⌋ over 21, capped at 30 in 2024 (RAW)', () => {
		character.play.hp = { current: 100, max: 100, temp: 0 };
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.hpAmount = 70; // ⌊70/2⌋ = 35 → capped to 30
		combat.damage();
		expect(combat.pendingConcentrationSave?.dc).toBe(30);
	});

	it('no banner when not concentrating', () => {
		character.play.hp = { current: 20, max: 20, temp: 0 };
		combat.hpAmount = 6;
		combat.damage();
		expect(combat.pendingConcentrationSave).toBeNull();
	});

	it('rolling the save resolves the check and NEVER auto-drops (fail → offers Drop)', () => {
		character.play.hp = { current: 20, max: 20, temp: 0 };
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.hpAmount = 6;
		combat.damage();
		combat.rollConcentrationSave();
		// resolved: either held (cleared) or failed (banner offers Drop) — never a still-unrolled {dc}
		const pend = combat.pendingConcentrationSave;
		expect(pend === null || pend.failed === true).toBe(true);
		// the roll itself never ends the spell — only Drop does
		expect(character.play.concentration).toBe(`spell:${S}:bless`);
	});

	it('Drop from the banner ends concentration and dismisses the banner', () => {
		character.play.hp = { current: 20, max: 20, temp: 0 };
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.hpAmount = 6;
		combat.damage();
		combat.dropConcentrationFromSave();
		expect(character.play.concentration).toBeNull();
		expect(combat.pendingConcentrationSave).toBeNull();
	});

	it('an owed save does not outlive the concentration it was owed for', () => {
		character.play.hp = { current: 30, max: 30, temp: 0 };
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.hpAmount = 20;
		combat.damage();
		expect(combat.pendingConcentrationSave).not.toBeNull();
		// the next concentration spell REPLACES the first; the save owed for Bless is not owed for it
		combat.cast(spellRow(graph, `spell:${S}:hold_person`, 'on')!, noModifiers);
		expect(character.play.concentration).toBe(`spell:${S}:hold_person`);
		combat.syncPendingConcentration();
		expect(combat.pendingConcentrationSave).toBeNull();
		// …and the same for a long rest, which ends concentration without touching the banner
		character.play.hp.current = 30;
		combat.hpAmount = 10;
		combat.damage();
		expect(combat.pendingConcentrationSave).not.toBeNull();
		combat.resources.rest('long');
		combat.syncPendingConcentration();
		expect(combat.pendingConcentrationSave).toBeNull();
	});

	it('Dismiss (✕) clears the banner but KEEPS concentration, and a new hit re-arms it', () => {
		// regression: Drop ends the spell; the reminder must ALSO be dismissable WITHOUT losing
		// concentration, else waving it off once silently kills the spell and the banner never returns.
		character.play.hp = { current: 20, max: 20, temp: 0 };
		combat.cast(spellRow(graph, `spell:${S}:bless`, 'on')!, noModifiers);
		combat.hpAmount = 6;
		combat.damage();
		combat.dismissConcentrationSave();
		expect(combat.pendingConcentrationSave).toBeNull(); // banner gone
		expect(character.play.concentration).toBe(`spell:${S}:bless`); // STILL concentrating
		combat.damage(); // a new hit
		expect(combat.pendingConcentrationSave).not.toBeNull(); // banner re-arms
	});
});

/** A caster graph (wizard with a full slot table) + a level-1 damage spell that upcasts, so an
 *  end-to-end cast folds the structured `upcast` delta into the rolled dice (UPCAST slice 1). */
async function casterGraphOf(): Promise<ContentGraph> {
	return makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability',
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int`,
		].join('\n'),
		'spell_slots_srd.csv': [
			'id,systems,source,kind,level,slot_1,slot_2,slot_3,slot_4,slot_5,slot_6,slot_7,slot_8,slot_9',
			`full_5,5.5e,${S},full,5,4,3,2,0,0,0,0,0,0`,
		].join('\n'),
		'spells_srd.csv': [
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
			`false_life,5.5e,${S},False Life,1,necromancy,action,Self,1 hour,V S M,false,temp,,1d4 +4,temp_hp:per_slot(5),`,
			// a magic-weapon buff (Magic Weapon): an `enhancement` upcast is the WHOLE +n bonus by slot (item 7),
			// spawned as weapon-scoped attack+damage effect tokens (base +1 at slot 2, +2 at 4, +3 at 6)
			`magic_weapon,5.5e,${S},Magic Weapon,2,transmutation,bonus,Touch,"Concentration, up to 1 hour",V S,true,none,,,"enhancement:step(slot, 2->1, 4->2, 6->3)",`,
		].join('\n'),
	});
}

describe('CombatVM · structured upcast folds into the cast roll (UPCAST slice 1)', () => {
	let graph: ContentGraph;
	let character: Character;
	/** Number of `dN(` dice of a given size in the newest roll-log entry's expr. */
	const diceOf = (sides: number) =>
		(combat.journal.log[0]?.expr.match(new RegExp(`d${sides}\\(`, 'g')) ?? []).length;

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

	it('upcast still scales with auto-calc OFF — it is a spell mechanic, not an effect layer (N6 revised)', () => {
		character.play.autoCalc = false; // manual mode: effect modifiers off, but spell mechanics stay
		character.play.spellSlotsSpent = { '1': 4 }; // spill to a level-2 slot
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		expect(diceOf(8)).toBe(4); // 3d8 base + 1d8 upcast — dice still boosted in manual mode
	});

	it('a healing upcast folds base + delta + spellcasting mod (int +3) at slot 2', () => {
		character.play.spellSlotsSpent = { '1': 4 };
		combat.cast(spellRow(graph, `spell:${S}:cure_wounds`, 'on')!, noModifiers);
		expect(diceOf(8)).toBe(2); // 1d8 base + 1d8 upcast
		expect(combat.journal.log[0]?.expr).toContain('+3'); // spellcasting mod still added
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
	const dmgPartOf = (type: string) => combat.journal.log[0]?.damage?.find((p) => p.type === type);
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
		expect((combat.journal.log[0]?.damage ?? []).map((p) => p.type).sort()).toEqual([
			'cold',
			'piercing',
		]);
	});

	it('a FLAT heal (Heal 70) applies its base + upcast delta with NO spellcasting mod (item 6)', () => {
		character.play.spellSlotsSpent = { '1': 4 }; // spill to a level-2 slot → +10
		combat.cast(spellRow(graph, `spell:${S}:flat_heal`, 'on')!, noModifiers);
		expect(combat.journal.log[0]?.total).toBe(80); // 70 base + 10 upcast, NOT + int mod
	});

	it('a flat heal at the base slot heals exactly its flat value (70)', () => {
		combat.cast(spellRow(graph, `spell:${S}:flat_heal`, 'on')!, noModifiers);
		expect(combat.journal.log[0]?.total).toBe(70);
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
		expect(combat.journal.log[0]?.label).toContain('temp HP');
		expect(combat.journal.log[0]?.labelKey).toBe('combat.log.spell.tempHp');
		expect(combat.journal.log[0]?.expr).toContain('+4'); // 1d4 + 4 base, int mod NOT added
		character.play.spellSlotsSpent = { '1': 4 }; // spill to slot 2 → +5 delta
		combat.cast(spellRow(graph, `spell:${S}:false_life`, 'on')!, noModifiers);
		expect(combat.journal.log[0]?.expr).toContain('+9'); // 4 base + 5 upcast
	});

	it('Magic Weapon: casting at the base slot spawns +1 attack&damage effect tokens (item 7)', () => {
		combat.cast(spellRow(graph, `spell:${S}:magic_weapon`, 'on')!, noModifiers); // base slot 2 → +1
		const carrier = character.play.effects.find((ef) => ef.source === `spell:${S}:magic_weapon`);
		expect(carrier?.effects).toEqual(['flat_bonus:attack+1', 'flat_bonus:damage+1']);
	});

	it('Magic Weapon: the enhancement step scales +1/+2/+3 by slot (item 7)', () => {
		const r = spellRow(graph, `spell:${S}:magic_weapon`, 'on')!;
		// castPreview evaluates the enhancement at an explicit slot (no real slot needed) — the same value
		// the cast layer feeds enhancementTokens, so this covers the +2/+3 tiers the level-5 slot table can't reach
		expect(combat.castPreview(r, 2)).toContain('+1 attack & damage'); // absolute: base slot 2 → +1
		expect(combat.castPreview(r, 4)).toContain('+2 attack & damage'); // slot 4 → +2
		expect(combat.castPreview(r, 6)).toContain('+3 attack & damage'); // slot 6 → +3
	});

	it('an upcast damage roll records a base+delta provenance note; a base-slot cast records none (item 4)', () => {
		character.play.spellSlotsSpent = { '1': 4 }; // spill to slot 2 → +1d8 delta
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		// FACTS, not a sentence: the record keeps what was added and out of which slot (untyped delta
		// merges into the fire pool), and `rollToastModel` is the one place that turns it into words
		expect(combat.journal.log[0]?.noteParts?.[0]).toEqual({
			key: 'roller.note.upcast',
			values: { base: '3d8 fire', added: '1d8', slot: 2 },
		});
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers); // still a level-2 slot → +1d8
		expect(combat.journal.log[0]?.noteParts?.[0]?.values?.slot).toBe(2);
		character.play.spellSlotsSpent = {}; // a base-slot cast has no upcast → no provenance note
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		expect(combat.journal.log[0]?.noteParts).toBeUndefined();
	});

	it('SCOPED-BONUS: a bonus naming ONE spell reaches that spell and no other', () => {
		// what Agonizing Blast needs and L1 could not say: +N on this spell's damage, nothing else's
		character.play.effects = [
			{
				iid: 'agonizing',
				label: 'Agonizing Orb',
				effects: [`flat_bonus:damage.chromatic_orb+3`],
				positive: true,
			},
		];
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		expect(combat.journal.log[0]?.expr).toContain('+3');
		combat.cast(spellRow(graph, `spell:${S}:ice_knife`, 'on')!, noModifiers);
		expect(combat.journal.log[0]?.expr ?? '').not.toContain('+3');
		expect(dmgPartOf('cold')?.expr ?? '').not.toContain('+3');
	});

	it('castPreview: a damage upcast shows the extra dice at a slot, nothing at base (items 1/8)', () => {
		const r = spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!;
		expect(combat.castPreview(r, 1)).toBe(''); // base slot → no upcast
		expect(combat.castPreview(r, 3)).toContain('+2d8'); // 2 slots up → +2d8
	});

	it('upcastLadder: one line per slot that adds something, base slot omitted', () => {
		const r = spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!;
		// the caller's own lookup, said back as key + values so the assertion reads the FACTS
		const say = (key: string, o?: { values?: Record<string, string | number> }) =>
			`${key}|${o?.values?.slot}|${o?.values?.preview}`;
		const lines = combat.upcastLadder(r, say).split('\n');
		expect(lines[0]).toBe('roller.note.upcastPreview|2|+1d8'); // slot 1 adds nothing → not a rung
		expect(lines.at(-1)).toBe(
			`roller.note.upcastPreview|${combat.castableSlots(r).at(-1)}|+${(combat.castableSlots(r).at(-1) ?? 0) - 1}d8`,
		);
	});

	it('castPreview: a count spell shows its scaled total (Scorching Ray-style, item 8)', () => {
		const r = spellRow(graph, `spell:${S}:scorch`, 'on')!;
		expect(combat.castPreview(r, 2)).toContain('3'); // count:slot+1 at slot 2 = 3
		expect(combat.castPreview(r, 3)).toContain('4'); // …4 at slot 3
	});

	it('a count cantrip (EB) does NOT die-multiply; a damage cantrip (Fire Bolt) still does (item 9)', () => {
		combat.cast(spellRow(graph, `spell:${S}:fbolt`, 'on', { charLevel: 5 })!, noModifiers); // char level 5
		expect(partDiceOf('fire', 10)).toBe(2); // die-scaling: 1d10 → 2d10 at level 5
		combat.cast(spellRow(graph, `spell:${S}:blast`, 'on', { charLevel: 5 })!, noModifiers);
		expect(partDiceOf('force', 10)).toBe(1); // count-scaling: stays 1d10 (2nd beam = separate roll)
	});

	it('the upcast roll label names the slot AND what it added (B8 provenance, item 4)', () => {
		character.play.spellSlotsSpent = { '1': 4, '2': 3 }; // spill to slot 3
		combat.cast(spellRow(graph, `spell:${S}:chromatic_orb`, 'on')!, noModifiers);
		// the slot rides the NAME (it survives the strip layout, where the note is hidden); what the
		// slot ADDED rides the note beside it
		expect(combat.journal.log[0]?.labelKey).toBe('combat.log.spell.damageSlot');
		expect(combat.journal.log[0]?.labelValues?.slot).toBe(3);
		expect(combat.journal.log[0]?.noteParts?.[1]).toEqual({
			key: 'roller.note.upcastPreview',
			values: { preview: '+2d8' },
		});
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
			{ iid: 'b', label: 'Curse', effects: [], positive: false }, // indefinite — never expires
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
				startedRound: 0,
			},
			{ iid: 'mark', label: 'Mark', effects: [], positive: false },
		];
		combat.economy.advanceTime(1); // +1 round → 8 s in, Bless still up
		expect(character.play.round).toBe(1);
		expect(character.play.effects.map((e) => e.iid)).toEqual(['bless', 'mark']);
		combat.economy.advanceTime(10); // +1 min → round 11 ≥ 0 + 10 → Bless expires
		expect(character.play.round).toBe(11);
		expect(character.play.effects.map((e) => e.iid)).toEqual(['mark']);
	});

	it('B19: passing time is offered whether or not anything is ticking', () => {
		// the bar used to appear and vanish with the player's buffs, which is a control they could not
		// ask for. Passing time always moves the round counter, so it is never a no-op.
		character.play.effects = [{ iid: 'x', label: 'X', effects: [], positive: false }];
		character.play.round = 0;
		combat.economy.advanceTime(10);
		expect(character.play.round).toBe(10);
		expect(character.play.effects.map((e) => e.iid)).toEqual(['x']); // indefinite, so untouched
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
				startedRound: 1,
			},
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
			startedRound: 0,
		});
		character.play.effects = [
			timed('short-lived', 10),
			timed('eight-hours', 4800),
			{ iid: 'forever', label: 'forever', effects: [], positive: false },
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
				startedRound: 0,
			},
			// just started, 5000 rounds left → survives a short rest
			{
				iid: 'fresh-long',
				label: 'y',
				effects: [],
				positive: true,
				durationRounds: 5000,
				startedRound: 999,
			},
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
			{ iid: '1', label: 'Rage', effects: ['grant_resource:rage:3:long'], positive: true },
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
			{ iid: '1', label: 'Rage', effects: ['grant_resource:rage:2:long'], positive: true },
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
			{ iid: '1', label: 'Rage', effects: ['grant_resource:rage:2:long'], positive: true },
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
		const labels = combat.effects.conditionList.map((c) => c.label);
		expect(labels).toContain('Prone'); // 5.5e
		expect(labels).not.toContain('Grappled'); // 5e-only
		expect(combat.effects.conditionList.find((c) => c.label === 'Prone')?.id).toBe('prone'); // carries the id
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
		combat.effects.addEffect({
			label: 'Incapacitated',
			tokens: ['apply_condition:incapacitated'],
			positive: false,
		});
		expect(combat.economy.incapacitated).toBe(true);
		expect(combat.economy.slotMax).toEqual({ action: 0, bonus: 0, reaction: 0 });
		expect(combat.economy.trySpend('bonus')).toBe(false); // hard block, not exhaustion
		expect(combat.economy.trySpend('reaction')).toBe(false);

		// remove it → economy restored
		const iid = character.play.effects.find((e) => e.label === 'Incapacitated')?.iid;
		if (iid) combat.effects.removeEffect(iid);
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
			{ spell: `spell:${S}:bless`, prepared: true, alwaysPrepared: false },
		];
		character.build.inventory = [
			{ item: `item:${S}:dagger`, qty: 1, equipped: true, attuned: false },
		];
		combat.graph = graph;
		combat.character = character;
	});

	it('roll/log: rollDiceNow prepends a labelled entry with a numeric total', () => {
		const before = combat.journal.log.length;
		combat.journal.rollDiceNow({ label: 'Stealth', test: { dice: { 20: 1 }, mod: 5 } });
		expect(combat.journal.log.length).toBe(before + 1);
		expect(combat.journal.log[0]!.label).toBe('Stealth');
		expect(typeof combat.journal.log[0]!.total).toBe('number');
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

	it('a granted roll can be marked used for THIS turn, and the turn clears it', () => {
		character.play.turn.usedRolls = [];
		combat.economy.toggleRollUsed('sneak_attack');
		expect(combat.economy.isRollUsed('sneak_attack')).toBe(true);
		combat.economy.toggleRollUsed('sneak_attack'); // the player's mark, so it comes off the same way
		expect(combat.economy.isRollUsed('sneak_attack')).toBe(false);

		combat.economy.toggleRollUsed('sneak_attack');
		combat.economy.nextTurn();
		expect(combat.economy.isRollUsed('sneak_attack')).toBe(false); // a turn-scoped mark dies with the turn
	});

	it('ROLL-NAME-KEY: the app-named attack is logged as a KEY, in one strike and in a volley', () => {
		const unarmed = combat.attacks.find((a) => a.id === UNARMED_STRIKE_ID)!;
		combat.rolls.rollAttackNow(unarmed);
		// the one attack that is not a content row keeps its catalog key, so a log read in another
		// language reads in THAT language rather than the one it was rolled in
		expect(combat.journal.log[0]?.labelKey).toBe('combat.attacks.unarmedStrike');

		combat.rolls.rollAttackNow(
			unarmed,
			numberedAttackRollName(unarmed, (k) => k, 2, 3),
		);
		expect(combat.journal.log[0]?.labelKey).toBe('combat.log.attackNumbered');
		expect(combat.journal.log[0]?.labelValues).toEqual({
			// the NAME rides as a catalog word, not as text — that is what keeps a numbered strike honest
			name: { catalog: 'combat.attacks', id: 'unarmedStrike' },
			index: 2,
			count: 3,
		});

		// a weapon's name is DATA and passes through: no key, the row's own word
		const dagger = combat.attacks.find((a) => a.name === 'Dagger');
		if (dagger) {
			combat.rolls.rollAttackNow(dagger);
			expect(combat.journal.log[0]?.labelKey).toBeUndefined();
			expect(combat.journal.log[0]?.label).toBe('Dagger');
		}
	});

	it('damage at 0 HP is a death-save failure, and two when the hit was a critical', () => {
		character.play.hp = { current: 0, max: 20, temp: 0 };
		combat.hpAmount = 3;
		combat.damage();
		expect(character.play.deathSaves.failures).toBe(1);

		combat.hp.damageWasCrit = true; // the one thing the Damage button cannot read off an attack
		combat.damage();
		expect(character.play.deathSaves.failures).toBe(3);
		expect(character.play.death?.cause).toBe('death_saves'); // the third failure is the end
		expect(combat.hp.damageWasCrit).toBe(false); // crit-ness belonged to that hit only
	});

	it('damage while still standing leaves the death-save track alone', () => {
		character.play.hp = { current: 12, max: 20, temp: 0 };
		combat.hpAmount = 5;
		combat.damage();
		expect(character.play.deathSaves.failures).toBe(0);
		expect(character.play.hp.current).toBe(7);
	});

	it('action economy: in combat a spell spends its slot and the second cast is blocked', () => {
		character.play.inCombat = true;
		character.play.turn.action = 0;
		const fireBolt = spellRow(graph, `spell:${S}:fire_bolt`, 'on')!;
		combat.cast(fireBolt, noModifiers); // action ct → spends the action
		expect(character.play.turn.action).toBe(1);
		combat.cast(fireBolt, noModifiers); // none left → blocked, stays 1
		expect(character.play.turn.action).toBe(1);
		combat.economy.nextTurn(); // refreshes the economy
		expect(character.play.turn.action).toBe(0);
	});

	it('coins: the purse only weighs anything when this character weighs coins', () => {
		character.play.currency = { gp: 100 };
		const items = combat.inventory.carriedLb; // the dagger, and nothing of the purse
		expect(combat.inventory.coinsLb).toBe(0);

		character.ui.coinWeight = true;
		expect(combat.inventory.coinsLb).toBe(2); // 100 coins, 50 to the pound
		expect(combat.inventory.carriedLb).toBe(items + 2);
	});

	it('coins: hiding a denomination hides it and keeps what is in it', () => {
		character.play.currency = { ep: 7 };
		combat.inventory.toggleCoin('ep');
		expect(combat.inventory.shownCoins.map((c) => c.id)).toEqual(['cp', 'sp', 'gp', 'pp']);
		expect(combat.inventory.coinOf('ep')).toBe(7);
	});

	it('a dawn pool comes back at dawn and NOT because the character slept', () => {
		// a charged item, as content says it: a pool that regains a rolled amount daily at dawn
		character.play.effects = [
			{
				iid: 'wand',
				label: 'Wand of the War Mage',
				effects: ['grant_resource:wand_charges:7:dawn(1d6+1)'],
				positive: true,
			},
		];
		character.play.resourcesSpent = { wand_charges: 7 };
		expect(combat.sheet?.resources.find((r) => r.id === 'wand_charges')?.recharge).toEqual({
			trigger: 'dawn',
			amount: '1d6+1',
		});

		combat.resources.rest('long'); // sleeping is not dawn — RAW ties the wand to the hour
		expect(character.play.resourcesSpent.wand_charges).toBe(7);

		combat.resources.passBoundary('dawn'); // 1d6+1 → between 2 and 7 charges back
		const back = 7 - (character.play.resourcesSpent.wand_charges ?? 0);
		expect(back).toBeGreaterThanOrEqual(2);
		expect(back).toBeLessThanOrEqual(7);
	});

	it('rests: a long rest clears spent slots and restores HP to max', () => {
		character.play.spellSlotsSpent = { '1': 2 };
		character.play.hp = { current: 3, max: 20, temp: 4 };
		combat.resources.rest('long');
		expect(character.play.spellSlotsSpent).toEqual({});
		expect(character.play.hp.current).toBe(20);
		expect(character.play.hp.temp).toBe(0);
	});

	it('rests: a SHORT rest returns the pact pool and leaves the leveled slots spent', () => {
		// Pact Magic is the one slot pool that recharges on a short rest, which is what makes it its
		// own pip strip rather than a row in the leveled ladder
		character.play.spellSlotsSpent = { '1': 2, [PACT_SLOT_KEY]: 2 };
		combat.resources.rest('short');
		expect(character.play.spellSlotsSpent).toEqual({ '1': 2 });
	});

	it('a log MARKER carries its catalog key, so the log is not frozen in one language', () => {
		// `log.jsonl` keeps the line verbatim, so a marker written as a finished sentence would still
		// read in the language it happened in after the player switches the UI
		character.ui.shortRestMode = 'half';
		character.play.hp = { current: 1, max: 40, temp: 0 };
		combat.startShortRest(noModifiers);
		expect(combat.journal.log[0]).toMatchObject({
			labelKey: 'combat.log.shortRestHalf',
			labelValues: { hp: 20 },
		});
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

	it('level-up: the sheet says WHETHER you can, and the builder does the levelling', () => {
		// the control navigates to the builder in level-up mode (Hero.svelte); the sheet only decides
		// whether to offer it, because the new level asks questions only the builder can take answers to
		expect(combat.canLevelUp).toBe(true);
	});

	it('attacks: an equipped weapon + Unarmed Strike are offered; attackRoll logs a roll', () => {
		// by id: a weapon's name is its row's, in the reader's language, and the unarmed strike has no
		// row to take one from — what identifies an attack is what an action token can name
		const ids = combat.attacks.map((a) => a.id);
		expect(ids).toContain('dagger');
		expect(ids).toContain(UNARMED_STRIKE_ID);
		const before = combat.journal.log.length;
		combat.attackRoll(combat.attacks[0]!, noModifiers);
		expect(combat.journal.log.length).toBe(before + 1);
	});

	it('a standard action rolls its check with the skill effects the skills panel uses', () => {
		// the Hide action IS a Stealth check: one check must not roll two ways depending on which panel
		// the player tapped it in (2014 exhaustion L1 rides `ability_checks`)
		combat.effects.addEffect({
			label: 'Exhausted',
			tokens: ['disadvantage:ability_checks'],
			positive: false,
		});
		const hide = combat.actions.find((a) => a.id === 'hide')!;
		expect(hide.skill).toBe('stealth');
		combat.actionClick(hide, noModifiers);
		expect(combat.journal.log[0]!.advantage).toBe('disadvantage');
	});

	it('a bare ability check is folded and reachable: `d20_tests` lands on it, not only on the save', () => {
		const plain = combat.sheet!.abilities.str;
		expect(plain.check.value).toBe(plain.mod);
		combat.effects.addEffect({
			label: 'Exhausted (2024)',
			tokens: ['flat_bonus:d20_tests-2'],
			positive: false,
		});
		const a = combat.sheet!.abilities.str;
		// the raw modifier is untouched (damage and DCs are built from it); the CHECK carries the penalty
		expect(a.mod).toBe(plain.mod);
		expect(a.check.value).toBe(plain.mod - 2);
		expect(a.save.value).toBe(plain.save.value - 2);
	});

	it('the attack row prints the damage its own tap rolls (a scoped bonus lands on both)', () => {
		character.play.round = 11;
		// Rage's shape in the shipped packs: a damage bonus scoped to melee Strength attacks
		combat.effects.addEffect({
			label: 'Rage',
			tokens: ['flat_bonus:damage.melee,str+2'],
			positive: true,
		});
		const row = combat.attacks.find((a) => a.id === 'dagger')!;
		combat.attackRoll(row, noModifiers);
		const rolled = combat.journal.log[0]!.damage![0]!;
		// the number on the row IS the number the roll used — the row was two lower before
		expect(rolled.mod).toBe(row.damageParts[0]!.mod);
		expect(attackNotes(row)).toContain('damage (Rage)');
	});

	it('Extra Attack: the strikes of one Attack action cost one Action between them', () => {
		character.play.inCombat = true;
		character.play.round = 9; // its own round (see the Savage Attacker test below)
		combat.effects.addEffect({
			label: 'Extra Attack',
			tokens: ['set_override:attacks:2:floor'],
			positive: true,
		});
		expect(combat.sheet!.attacksPerAction.value).toBe(2);
		const before = combat.journal.log.length;
		combat.attackRoll(combat.attacks[0]!, noModifiers);
		combat.attackRoll(combat.attacks[0]!, noModifiers);
		// both rolled, on ONE Action — the second strike rides the first's Attack action
		expect(combat.journal.log.length).toBe(before + 2);
		expect(character.play.turn.action).toBe(1);
		// the third wants a second Action, and there is none
		combat.attackRoll(combat.attacks[0]!, noModifiers);
		expect(combat.journal.log.length).toBe(before + 2);
	});

	it('Savage Attacker rerolls the WEAPON dice and leaves an effect die alone', () => {
		character.play.inCombat = true;
		// its OWN round: `combat` is a singleton and `savageUsedRound` outlives the character the
		// beforeEach replaces, so two tests spending the use in round 1 would starve the second
		character.play.round = 7;
		character.play.turn.action = 0;
		combat.effects.addEffect({
			label: 'Savage Attacker',
			tokens: ['damage_reroll'],
			positive: true,
		});
		// a damage-riding effect die (Bless-shaped): RAW it is not the weapon's die, so the reroll
		// must not touch it — before this it was rerolled along with the weapon's
		combat.effects.addEffect({
			label: 'Hex',
			tokens: ['flat_bonus:damage+1d6'],
			positive: true,
		});

		combat.attackRoll(combat.attacks[0]!, noModifiers);
		const before = combat.savagePendingEntry!.damage![0]!;
		const effectBefore = before.dice.filter((d) => d.role === DIE_ROLE.bonus);
		expect(effectBefore.length).toBeGreaterThan(0);

		combat.savageReroll();
		const after = combat.journal.log[0]!.damage![0]!;
		const effectAfter = after.dice.filter((d) => d.role === DIE_ROLE.bonus);
		// the same effect dice, face for face, on the other side of the reroll
		expect(effectAfter.map((d) => d.value)).toEqual(effectBefore.map((d) => d.value));
		// and the part still adds up to what its dice and modifier say
		expect(after.total).toBe(after.dice.reduce((n, d) => n + d.sign * d.value, 0) + after.mod);
	});

	it('Savage Attacker: a data-driven `damage_reroll` fact offers a once-per-turn reroll that never lowers the kept damage', () => {
		character.play.inCombat = true;
		character.play.round = 1;
		character.play.turn.action = 0;
		// a runtime effect carrying the data-driven marker (in real content a feat's `effects` column
		// carries it); its LABEL becomes the offer label — nothing feat-specific is hardcoded in the VM.
		combat.effects.addEffect({
			label: 'Savage Attacker',
			tokens: ['damage_reroll'],
			positive: true,
		});

		combat.attackRoll(combat.attacks[0]!, noModifiers); // Dagger (1d4) — rolls damage dice
		expect(combat.savageLabel).toBe('Savage Attacker');
		const entry = combat.savagePendingEntry!;
		expect(entry).toBe(combat.journal.log[0]);

		// re-reading the d20 REPLACES the log element; the offer names its roll by `at`, so it must
		// still be on that row rather than silently withdrawing itself
		combat.journal.amendAdvantage(entry);
		expect(combat.savagePendingEntry).toBe(combat.journal.log[0]);
		expect(combat.savagePendingEntry).not.toBe(entry);
		expect(combat.savageLabel).toBe('Savage Attacker');
		const keptBefore = combat.savagePendingEntry!.damage![0]!.total;

		combat.savageReroll();
		expect(combat.journal.log[0]!.damage![0]!.total).toBeGreaterThanOrEqual(keptBefore); // keep-higher never lowers
		// the reroll is an AMENDMENT, so it cannot overwrite provenance the roll already had — and it
		// lands BESIDE the advantage amendment above rather than replacing it
		expect(combat.journal.log[0]!.amendments).toMatchObject([
			{ kind: AMENDMENT_KIND.advantage },
			{ kind: AMENDMENT_KIND.damageReroll, source: 'Savage Attacker' },
		]);
		expect(combat.savageLabel).toBeNull(); // once-per-turn use spent

		// a second attack the SAME turn does NOT re-offer (use already spent this round)
		character.play.turn.action = 0; // free the action for a 2nd attack
		combat.attackRoll(combat.attacks[0]!, noModifiers);
		expect(combat.savageLabel).toBeNull();

		// Next turn frees the use again
		combat.economy.nextTurn();
		character.play.turn.action = 0;
		combat.attackRoll(combat.attacks[0]!, noModifiers);
		expect(combat.savageLabel).toBe('Savage Attacker');
	});

	it('SAVAGE-TAIL: a Shift-click attack arms the same reroll, and a spell in the same tray does not', () => {
		character.play.inCombat = true;
		// its OWN round, as above: `savageUsedRound` outlives the character the beforeEach replaces
		character.play.round = 12;
		character.play.turn.action = 0;
		combat.effects.addEffect({
			label: 'Savage Attacker',
			tokens: ['damage_reroll'],
			positive: true,
		});

		// Shift-click rolls nothing yet — the tray does, later, and the offer has to arm from THERE
		combat.attackRoll(combat.attacks[0]!, wantsTray);
		combat.recordTrayRolls(combat.journal.diceTray.roll());
		expect(combat.savageLabel).toBe('Savage Attacker');
		expect(combat.savagePendingEntry).toBe(combat.journal.log[0]);
		const keptBefore = combat.savagePendingEntry!.damage![0]!.total;
		combat.savageReroll();
		expect(combat.journal.log[0]!.damage![0]!.total).toBeGreaterThanOrEqual(keptBefore);

		// the use is free again, and the SAME tray now holds a spell: Savage Attacker rerolls a
		// weapon's dice, so a Fire Bolt sent through the tray must not inherit the offer
		combat.economy.nextTurn();
		combat.journal.prefill({
			label: 'Fire Bolt',
			damage: [{ dice: { 10: 1 }, mod: 0, type: 'fire' }],
		});
		combat.recordTrayRolls(combat.journal.diceTray.roll());
		expect(combat.savageLabel).toBeNull();
	});

	// the effects panel controls the user asked for: choose duration on add, edit/remove on the panel
	it('addEffect applies the chosen newEffectDuration; 0 = indefinite (no duration field)', () => {
		combat.effects.newEffectDuration = 4;
		combat.effects.addEffect({ label: 'Haste', tokens: ['flat_bonus:ac+2'], positive: true });
		const added = character.play.effects.at(-1)!;
		expect(added.label).toBe('Haste');
		expect(added.durationRounds).toBe(4);

		combat.effects.newEffectDuration = 0; // indefinite
		combat.effects.addEffect({ label: 'Curse', tokens: [], positive: false });
		expect(character.play.effects.at(-1)!.durationRounds).toBeUndefined();
	});

	it('removeEffect drops the effect by its instance id', () => {
		combat.effects.addEffect({ label: 'Temp', tokens: ['flat_bonus:ac+1'] });
		const iid = character.play.effects.at(-1)!.iid;
		const before = character.play.effects.length;
		combat.effects.removeEffect(iid);
		expect(character.play.effects.length).toBe(before - 1);
		expect(character.play.effects.some((e) => e.iid === iid)).toBe(false);
	});

	it('removing the carrier effect ends the concentration it was carrying', () => {
		combat.effects.addEffect({ label: 'Hex', tokens: [], ref: `spell:${S}:hex` });
		character.play.concentration = `spell:${S}:hex`;
		combat.effects.removeEffect(character.play.effects.at(-1)!.iid);
		// the ✕ used to leave the indicator at the top of the sheet naming a spell that was gone
		expect(character.play.concentration).toBeNull();
	});

	it('bumpEffectDuration nudges rounds, and dropping to 0 makes it indefinite', () => {
		combat.effects.newEffectDuration = 2;
		combat.effects.addEffect({ label: 'Bless2', tokens: ['flat_bonus:saves+1d4'] });
		const iid = character.play.effects.at(-1)!.iid;
		const dur = () => character.play.effects.find((e) => e.iid === iid)!.durationRounds;
		combat.effects.bumpEffectDuration(iid, 1);
		expect(dur()).toBe(3);
		combat.effects.bumpEffectDuration(iid, -3); // past 1 → indefinite
		expect(dur()).toBeUndefined();
	});

	it('setEffectDuration sets an exact typed round count; 0/blank → indefinite', () => {
		combat.effects.addEffect({ label: 'Typed', tokens: ['flat_bonus:ac+1'] });
		const iid = character.play.effects.at(-1)!.iid;
		const dur = () => character.play.effects.find((e) => e.iid === iid)!.durationRounds;
		combat.effects.setEffectDuration(iid, 7);
		expect(dur()).toBe(7);
		combat.effects.setEffectDuration(iid, 0); // typed 0 → until removed
		expect(dur()).toBeUndefined();
	});
});

describe('ResourceTracker · piece 3 spend-options', () => {
	const opt = (over: Partial<ResourceOption> = {}): ResourceOption => ({
		id: 'flurry',
		resourceId: 'ki',
		resourceName: 'Ki',
		name: 'Flurry of Blows',
		description: '',
		action: 'note:Make two Unarmed Strikes',
		actionType: 'bonus_action',
		cost: 1,
		available: true,
		...over,
	});
	const make = (spent: number, max: number) => {
		const c = {
			play: { resourcesSpent: { ki: spent } as Record<string, number> },
		} as unknown as Character;
		const sheet = {
			resources: [
				{
					id: 'ki',
					name: 'Ki',
					max,
					recharge: { trigger: 'short', amount: 'all' },
					source: 'Monk',
				},
			],
		} as unknown as CharacterSheet;
		return {
			t: new ResourceTracker(
				() => c,
				() => sheet,
			),
			c,
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
 * ALL-OR-NOTHING (actions.md). Drives the real VM (economy + HP + resources). RNG unseeded → the heal
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
		resourceName: 'Second Wind',
		name: 'Second Wind',
		description: '',
		action: 'heal:1d10+5',
		actionType: 'bonus_action',
		cost: 1,
		available: true,
		...over,
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

	const actionSurge = () => ({
		id: 'fighter_action_surge',
		resourceId: 'action_surge',
		resourceName: 'Action Surge',
		name: 'Action Surge',
		description: '',
		action: 'gain_action',
		actionType: 'free' as const,
		cost: 1,
		available: true,
	});

	it('gain_action grants an ADDITIONAL action this turn (Action Surge), free action costs no slot', async () => {
		const graph = await graphOf();
		const character = grant('grant_resource:action_surge:1:short');
		character.play.turn.action = 1; // the regular action is already used
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption(actionSurge());
		expect(character.play.turn.action).toBe(1); // what was spent stays spent
		expect(combat.economy.slotMax.action).toBe(2); // …and there is one more pip to spend
		expect(combat.economy.canSpend('action')).toBe(true);
		expect(combat.resources.resourceSpent('action_surge')).toBe(1);
	});

	// RAW it grants an action; it does not un-spend one. Surging FIRST used to decrement a
	// zero spent-counter, so the use was burnt for nothing (PLAN · UBUG-11 tail).
	it('gain_action is worth a full extra action even when nothing has been spent yet', async () => {
		const graph = await graphOf();
		const character = grant('grant_resource:action_surge:1:short');
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption(actionSurge());
		expect(character.play.turn.action).toBe(0);
		expect(combat.economy.slotMax.action).toBe(2); // two actions available, not one
	});

	it('a granted action dies with the turn', async () => {
		const graph = await graphOf();
		const character = grant('grant_resource:action_surge:1:short');
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption(actionSurge());
		combat.economy.nextTurn();
		expect(character.play.turn.grantedActions).toBe(0);
		expect(combat.economy.slotMax.action).toBe(1);
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
					'grant_resource:sorcery:4:long',
				],
				positive: true,
			},
		];
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption({
			id: 'potion_angelic_slumber',
			resourceId: 'angelic_slumber',
			resourceName: 'Angelic Slumber',
			name: 'Potion of Angelic Slumber',
			description: '',
			action: 'rest:long',
			actionType: 'free',
			cost: 1,
			available: true,
		});

		expect(character.play.hp.current).toBe(20); // long rest restored HP to max
		expect(character.play.spellSlotsSpent).toEqual({}); // all slots back
		expect(combat.resources.resourceSpent('sorcery')).toBe(0); // long-recharge pool refilled
		expect(combat.resources.resourceSpent('angelic_slumber')).toBe(1); // the charge stays spent (consumable)
	});

	it('restore_resource regains ALL uses of a pool and spends its once/long-rest gate (Persistent Rage)', async () => {
		const graph = await graphOf();
		const character = newCharacter('rook', 'Rook', '5.5e');
		character.play.autoCalc = true;
		character.play.effects = [
			{
				iid: '1',
				label: 'grant',
				effects: [
					'grant_resource:rage:3:short_one', // the pool being restored
					'grant_resource:persistent_rage:1:long', // the "once per long rest" gate
				],
				positive: true,
			},
		];
		character.play.resourcesSpent = { rage: 3 }; // all rage spent
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption({
			id: 'barbarian_persistent_rage',
			resourceId: 'persistent_rage',
			resourceName: 'Persistent Rage',
			name: 'Persistent Rage',
			description: '',
			action: 'restore_resource:rage',
			actionType: 'free',
			cost: 1,
			available: true,
		});
		expect(combat.resources.resourceSpent('rage')).toBe(0); // all rage back
		expect(combat.resources.resourceSpent('persistent_rage')).toBe(1); // the gate is now used

		// gate exhausted → activating again is a no-op (can't afford), rage stays as-is
		character.play.resourcesSpent = { rage: 2, persistent_rage: 1 };
		combat.activateResourceOption({
			id: 'barbarian_persistent_rage',
			resourceId: 'persistent_rage',
			resourceName: 'Persistent Rage',
			name: 'Persistent Rage',
			description: '',
			action: 'restore_resource:rage',
			actionType: 'free',
			cost: 1,
			available: true,
		});
		expect(combat.resources.resourceSpent('rage')).toBe(2); // NOT restored (gate was empty)
	});

	it('a MULTI-action option runs every `;`-token on one activation — Uncanny Metabolism regains ALL focus AND heals', async () => {
		const graph = await graphOf();
		const character = newCharacter('kai', 'Kai', '5.5e');
		character.play.autoCalc = true;
		character.play.hp = { current: 5, max: 40, temp: 0 };
		character.play.effects = [
			{
				iid: '1',
				label: 'grant',
				effects: [
					'grant_resource:focus:6:short', // the pool the multi-action restores
					'grant_resource:uncanny_metabolism:1:long', // the once/long-rest gate its cost spends
				],
				positive: true,
			},
		];
		character.play.resourcesSpent = { focus: 6 }; // all focus spent
		combat.graph = graph;
		combat.character = character;

		combat.activateResourceOption({
			id: 'monk_uncanny_metabolism_regain',
			resourceId: 'uncanny_metabolism',
			resourceName: 'Uncanny Metabolism',
			name: 'Uncanny Metabolism',
			description: '',
			action: 'restore_resource:focus;heal:1d6+2', // TWO tokens, run in order
			actionType: 'free',
			cost: 1,
			available: true,
		});
		expect(combat.resources.resourceSpent('focus')).toBe(0); // token 1: all focus back
		expect(combat.resources.resourceSpent('uncanny_metabolism')).toBe(1); // gate spent
		expect(character.play.hp.current).toBeGreaterThan(5); // token 2: healed 1d6+2 (min +3)
	});

	it('entering combat AUTO-restores a regain_on_initiative pool up to N (Perfect Focus), never beyond, gated on auto-calc', async () => {
		const graph = await graphOf();
		const character = newCharacter('kai', 'Kai', '5.5e');
		character.play.autoCalc = true;
		character.play.effects = [
			{
				iid: '1',
				label: 'grant',
				effects: ['grant_resource:focus:6:short', 'regain_on_initiative:focus:4'],
				positive: true,
			},
		];
		character.play.resourcesSpent = { focus: 5 }; // only 1 available (below 4)
		combat.graph = graph;
		combat.character = character;

		combat.toggleCombat(); // enter combat = "roll Initiative" → auto-fires the regen
		expect(character.play.inCombat).toBe(true);
		expect(combat.resources.resourceSpent('focus')).toBe(2); // restored to 4 available (6 − 4)

		// already above 4 → re-entering combat does NOT reduce/regain further
		character.play.resourcesSpent = { focus: 1 }; // 5 available (> 4)
		combat.economy.toggleCombat(); // leave
		combat.toggleCombat(); // re-enter
		expect(combat.resources.resourceSpent('focus')).toBe(1); // untouched (already ≥ 4)

		// auto-calc OFF → the app doesn't touch pools (player manages them). Assert the RAW stored spend
		// (the clamped accessor reads 0 here anyway — with auto-calc off the pool itself isn't derived).
		character.play.autoCalc = false;
		character.play.resourcesSpent = { focus: 6 };
		combat.economy.toggleCombat(); // leave
		combat.toggleCombat(); // re-enter
		expect(character.play.resourcesSpent.focus).toBe(6); // untouched — regen didn't fire
	});
});

describe('CombatVM · on_event hooks (Champion Heroic Rally)', () => {
	const wounded = (): Character => {
		const c = newCharacter('brand', 'Brand', '5.5e');
		c.play.autoCalc = true;
		c.play.hp = { current: 5, max: 40, temp: 0 };
		c.play.effects = [
			{
				iid: '1',
				label: 'Survivor',
				effects: ['on_event:turn_start:heal:5'],
				positive: true,
			},
		];
		return c;
	};

	it('runs the hooked action at a turn start — the Next-turn button, not the economy underneath it', async () => {
		const graph = await graphOf();
		const character = wounded();
		combat.graph = graph;
		combat.character = character;

		combat.nextTurn();
		expect(character.play.hp.current).toBe(10);
		combat.nextTurn();
		expect(character.play.hp.current).toBe(15); // every turn, not once
	});

	it('fires on ENTERING combat too — round 1 is the first turn, and it must not be skipped', async () => {
		const graph = await graphOf();
		const character = wounded();
		combat.graph = graph;
		combat.character = character;

		combat.toggleCombat();
		expect(character.play.hp.current).toBe(10);
	});

	it('does not fire with auto-calc off — the player is managing the sheet by hand', async () => {
		const graph = await graphOf();
		const character = wounded();
		character.play.autoCalc = false;
		combat.graph = graph;
		combat.character = character;

		combat.nextTurn();
		expect(character.play.hp.current).toBe(5);
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

	it('half mode: a short rest heals ½ max HP + recharges, no Hit Dice spent', async () => {
		const graph = await graphOf();
		const character = charAt('5.5e', 3); // max 30, current 5, d8×3
		character.ui.shortRestMode = 'half';
		combat.graph = graph;
		combat.character = character;
		combat.startShortRest(noModifiers);
		expect(character.play.hp.current).toBe(20); // 5 + floor(30/2) = 15
		expect(combat.resources.hitDiceSpent('d8')).toBe(0); // no dice consumed in half mode
	});

	it('dice mode: committing the picker spends the chosen Hit Dice + heals', async () => {
		const graph = await graphOf();
		const character = charAt('5.5e', 3);
		character.ui.shortRestMode = 'dice';
		combat.graph = graph;
		combat.character = character;
		combat.hdPick = { d8: 2 };
		combat.commitShortRest();
		expect(combat.resources.hitDiceSpent('d8')).toBe(2); // both chosen dice spent
		expect(character.play.hp.current).toBeGreaterThan(5); // healed from the rolls
		expect(combat.hdPick).toEqual({}); // selection reset after the rest
	});

	it('hdPickInc clamps the selection to the pool remaining', async () => {
		const graph = await graphOf();
		const character = charAt('5.5e', 3); // 3 dice
		combat.graph = graph;
		combat.character = character;
		combat.hdPick = {};
		combat.hdPickInc('d8', 5); // try to over-pick
		expect(combat.hdPick.d8).toBe(3); // capped at left = 3
		combat.hdPickInc('d8', -10);
		expect(combat.hdPick.d8).toBe(0); // floored at 0
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
 * enum member — not a boolean partial-recharge column (AGENTS.md ▸ Taste). Drives the real
 * rest() so the sheet resource carries the recharge policy end-to-end.
 */
describe('ResourceTracker · short_one partial recharge', () => {
	it('regains one use per short rest, all on a long rest', async () => {
		const graph = await graphOf();
		const character = newCharacter('rook', 'Rook', '5.5e');
		character.play.autoCalc = true;
		character.play.effects = [
			{
				iid: '1',
				label: 'SW',
				effects: ['grant_resource:second_wind:3:short_one'],
				positive: true,
			},
		];
		character.play.resourcesSpent = { second_wind: 3 }; // all three uses expended
		combat.graph = graph;
		combat.character = character;
		expect(combat.sheet?.resources.find((r) => r.id === 'second_wind')?.recharge).toEqual({
			trigger: 'short',
			amount: '1',
		});

		combat.resources.rest('short');
		expect(combat.resources.resourceSpent('second_wind')).toBe(2); // regained ONE, not all
		combat.resources.rest('short');
		expect(combat.resources.resourceSpent('second_wind')).toBe(1); // and one more
		combat.resources.rest('long');
		expect(combat.resources.resourceSpent('second_wind')).toBe(0); // long rest = all back
	});
});

describe('CombatVM · death (UBUG-15: instant death, three failures, the exhaustion ladder)', () => {
	let character: Character;
	beforeEach(async () => {
		combat.graph = await graphOf();
		character = newCharacter('mort', 'Mort', '5.5e');
		combat.character = character;
		character.play.hp = { current: 6, max: 12, temp: 0 };
	});

	it('kills instantly when the LEFTOVER damage meets the hit-point maximum (SRD example)', () => {
		combat.hpAmount = 18; // max 12, at 6 → 0 with 12 leftover = max → dead
		combat.damage();
		expect(character.play.hp.current).toBe(0);
		expect(character.play.death).toEqual({ cause: 'massive_damage' });
	});

	it('does NOT kill when the leftover is short of the maximum — you just drop to 0', () => {
		combat.hpAmount = 17; // 11 leftover < 12 max
		combat.damage();
		expect(character.play.hp.current).toBe(0);
		expect(character.play.death).toBeNull();
	});

	it('temp HP soaks first, so it can keep the leftover under the lethal threshold', () => {
		character.play.hp.temp = 3;
		combat.hpAmount = 18; // 3 soaked → 15 hits: 6 to zero, 9 leftover < 12
		combat.damage();
		expect(character.play.death).toBeNull();
	});

	it('three death-save failures kill — including a natural 1 that lands the third', () => {
		character.play.hp.current = 0;
		character.play.deathSaves = { successes: 0, failures: 2 };
		combat.toggleDeathSave('failures', 2); // manual pip → third failure
		expect(character.play.death).toEqual({ cause: 'death_saves' });
	});

	it('the top of the exhaustion ladder is lethal, and lower rungs are not', () => {
		combat.effects.setExhaustion(5);
		expect(character.play.death).toBeNull();
		combat.effects.setExhaustion(6); // the data cap (exhaustion row max_level) = death
		expect(character.play.death).toEqual({ cause: 'exhaustion' });
	});

	it('“I was revived” lifts you off 0 HP, clears the track and drops one exhaustion level', () => {
		combat.effects.setExhaustion(6);
		character.play.hp.current = 0;
		character.play.deathSaves = { successes: 1, failures: 3 };
		combat.revive();
		expect(character.play.death).toBeNull();
		expect(character.play.hp.current).toBe(1);
		expect(character.play.deathSaves).toEqual({ successes: 0, failures: 0 });
		expect(character.play.exhaustion).toBe(5); // else you'd revive straight back onto a lethal 6
	});

	it('reviving is a FLOOR of 1 HP — it never takes hit points away', () => {
		character.play.hp.current = 9; // died of exhaustion at 9 HP
		combat.effects.setExhaustion(6);
		combat.revive();
		expect(character.play.hp.current).toBe(9);
	});
});

describe.each(['5e', '5.5e'] as const)(
	'ResourceTracker · exhaustion on rest (UBUG-14, %s)',
	(sys) => {
		it('a long rest removes ONE exhaustion level; a short rest removes none', async () => {
			const graph = await graphOf();
			const character = newCharacter('worn', 'Worn', sys);
			character.play.exhaustion = 3;
			combat.graph = graph;
			combat.character = character;

			combat.resources.rest('short');
			expect(character.play.exhaustion).toBe(3); // RAW: only a LONG rest removes a level
			combat.resources.rest('long');
			expect(character.play.exhaustion).toBe(2);
			combat.resources.rest('long');
			combat.resources.rest('long');
			expect(character.play.exhaustion).toBe(0);
			combat.resources.rest('long'); // never goes negative
			expect(character.play.exhaustion).toBe(0);
		});
	},
);

/** Load a whole real edition into a graph (like the content tests) — the Rage buff spans the real
 *  effects.csv / conditions.csv / resource_options.csv rows, so a hand-stub wouldn't exercise them. */
const realGraph = (pack: string): Promise<ContentGraph> => loadPacks(pack);

describe('CombatVM · using the Rage resource ENTERS Rage (chip → buff, not a bare counter)', () => {
	let character: Character;
	beforeEach(async () => {
		combat.graph = await realGraph('srd-2024');
		character = newCharacter('grog', 'Grog', '5.5e');
		character.build.classes = [{ class: `class:${S}:barbarian`, level: 3 }];
		combat.character = character;
	});

	it('clicking the Rage chip applies the Rage buff AND spends one use', () => {
		expect(combat.sheet?.resources.find((r) => r.id === 'rage')?.max).toBe(3);
		expect(character.play.effects).toHaveLength(0);
		combat.useResourceOrEnter('rage', 3);
		expect(character.play.effects.some((e) => e.label === 'Rage')).toBe(true);
		expect(combat.resources.resourceSpent('rage')).toBe(1);
	});

	it('re-entering Rage refreshes, never STACKS a second Rage effect (state, not a pool)', () => {
		combat.useResourceOrEnter('rage', 3);
		combat.useResourceOrEnter('rage', 3);
		expect(character.play.effects.filter((e) => e.label === 'Rage')).toHaveLength(1);
	});

	it('the Rage buff carries the STR-check advantage as a LIVE fact (Athletics), not just a note', () => {
		combat.useResourceOrEnter('rage', 3);
		const sheet = combat.sheet;
		expect(sheet?.facts.advantage.some((a) => a.target === 'skill.athletics')).toBe(true);
		expect(sheet?.facts.advantage.some((a) => a.target === 'save.str')).toBe(true);
	});

	it('UBUG-16: the Rage chip costs its Bonus Action in combat', () => {
		combat.economy.toggleCombat();
		combat.useResourceOrEnter('rage', 3);
		expect(character.play.turn.bonus).toBe(1);
	});

	it('entering Rage marks is_raging and ENDS concentration (RAW: cannot maintain while raging)', () => {
		character.play.concentration = `spell:${S}:hold_person`; // pretend a prior concentration spell
		combat.useResourceOrEnter('rage', 3);
		expect(combat.cantConcentrate).toBe(true); // the Rage condition's blocks_concentration marker (data-driven)
		combat.endConcentrationIfBroken(); // the reactive call the combat page fires on state change
		expect(character.play.concentration).toBeNull();
	});
});

describe('CombatVM · UBUG-16 — a resource chip RUNS its action, it is not a bare counter', () => {
	let character: Character;
	beforeEach(async () => {
		combat.graph = await realGraph('srd-2024');
		character = newCharacter('valen', 'Valen', '5.5e');
		character.build.classes = [{ class: `class:${S}:fighter`, level: 5 }];
		character.play.hp = { current: 4, max: 40, temp: 0 };
		combat.character = character;
	});

	it('the Second Wind chip HEALS and spends the Bonus Action, not just a use', () => {
		combat.economy.toggleCombat();
		expect(combat.sheet?.resources.some((r) => r.id === 'second_wind')).toBe(true);
		combat.useResourceOrEnter('second_wind', 2);
		expect(character.play.hp.current).toBeGreaterThan(4); // 1d10 + fighter level actually rolled
		expect(character.play.turn.bonus).toBe(1); // the RAW Bonus Action was charged
		expect(combat.resources.resourceSpent('second_wind')).toBe(1);
	});

	it('all-or-nothing: with the Bonus Action gone, the chip heals nothing and spends nothing', () => {
		combat.economy.toggleCombat();
		combat.economy.usePip('bonus', 0); // bonus action already used this turn
		combat.useResourceOrEnter('second_wind', 2);
		expect(character.play.hp.current).toBe(4);
		expect(combat.resources.resourceSpent('second_wind')).toBe(0);
	});

	it('the `available` guard is enforced by the EXECUTOR, not just greyed in the panel', () => {
		character.build.classes = [{ class: `class:${S}:barbarian`, level: 15 }];
		const gate = (combat.sheet?.resourceOptions ?? []).find(
			(o) => o.resourceId === 'persistent_rage',
		);
		expect(gate?.available).toBe(false); // out of combat, its window is shut
		combat.resources.useResource('rage', 3); // spend one so a restore would be visible
		combat.useResourceOrEnter('persistent_rage', 1);
		expect(combat.resources.resourceSpent('rage')).toBe(1); // nothing was restored
		expect(combat.resources.resourceSpent('persistent_rage')).toBe(0); // and nothing was charged
	});

	it('says so when a conditional ability window OPENS, and not on the first look', () => {
		character.build.classes = [{ class: `class:${S}:barbarian`, level: 15 }];
		const opened = () =>
			(combat.sheet?.resourceOptions ?? []).find((o) => o.resourceId === 'persistent_rage')
				?.available === true;

		toasts.length = 0;
		combat.resources.noticeOpenedWindows(); // first pass RECORDS — opening the sheet announces nothing
		expect(opened()).toBe(false);
		expect(toasts.length).toBe(0);

		combat.economy.toggleCombat(); // combat start is the window
		expect(opened()).toBe(true);
		combat.resources.noticeOpenedWindows();
		expect(toasts.some((m) => m.includes('Persistent Rage'))).toBe(true);

		const said = toasts.length;
		combat.resources.noticeOpenedWindows(); // still open, still the same fact — said once
		expect(toasts.length).toBe(said);
	});

	it('a pool with SEVERAL actions stays a manual counter — the player picks in Actions', () => {
		character.build.classes = [{ class: `class:${S}:monk`, level: 5 }];
		combat.economy.toggleCombat();
		const opts = (combat.sheet?.resourceOptions ?? []).filter((o) => o.resourceId === 'focus');
		expect(opts.length).toBeGreaterThan(1); // Flurry / Patient Defense / Step of the Wind
		combat.useResourceOrEnter('focus', 5);
		expect(combat.resources.resourceSpent('focus')).toBe(1); // decremented…
		expect(character.play.turn.bonus).toBe(0); // …but no action was picked, so none was charged
	});
});

describe('PanelLayout · a saved layout is reconciled with the panels that exist (N1)', () => {
	it('appends a panel added after the layout was saved, and drops one since removed', () => {
		const layout = new PanelLayout();
		const shipped = layout.columns.flat().map((p) => p.id);
		// what an older app version wrote: no `inventory`, plus a panel that has since been deleted
		layout.restore([['skills'], ['attacks', 'a-panel-we-removed']]);
		const restored = layout.columns.flat().map((p) => p.id);
		expect(restored).not.toContain('a-panel-we-removed');
		expect(restored).toContain('inventory');
		// every shipped panel is reachable — there is no UI to add a missing one back
		expect([...restored].sort()).toEqual([...shipped].sort());
	});

	it('moves a panel by keyboard, within a column and across to the other, and persists it', () => {
		// the drag was the only way to arrange the screen; a keyboard user could not get back out of a
		// layout they did not choose
		const saved: string[][] = [];
		const layout = new PanelLayout((cols) => saved.push(cols.flat()));
		const ids = () => layout.columns.map((col) => col.map((p) => p.id));
		const [first = [], second = []] = ids();
		const [top = '', below = ''] = first;

		layout.movePanel(top, PANEL_MOVE.down);
		expect(ids()[0]?.slice(0, 2)).toEqual([below, top]);

		layout.movePanel(top, PANEL_MOVE.right);
		expect(ids()[0]).not.toContain(top);
		expect(ids()[1]).toContain(top);
		expect(ids()[1]?.length).toBe(second.length + 1);

		// at an edge it is a no-op, not a wrap or a drop
		const before = ids();
		layout.movePanel(below, PANEL_MOVE.up);
		layout.movePanel(below, PANEL_MOVE.left);
		expect(ids()).toEqual(before);

		expect(saved).toHaveLength(2); // each real move round-trips onto the character
	});

	it('leaves an up-to-date layout exactly as saved, order included', () => {
		const layout = new PanelLayout();
		// built from the SHIPPED set, reversed, so "up to date" stays true when a panel is added —
		// a hardcoded list here would fail the next time one is, and say nothing about reconciliation
		const shipped = layout.columns.flat().map((p) => p.id);
		const saved = [shipped.slice(0, 2).reverse(), shipped.slice(2).reverse()];
		layout.restore(saved);
		expect(layout.columns.map((col) => col.map((p) => p.id))).toEqual(saved);
	});
});

/*
 * UBUG-11 — a class action that says "make two Unarmed Strikes" MAKES them. The verb fires the real
 * attack path, so each strike carries the same to-hit and damage a tap on the Attacks panel would;
 * the whole flurry costs the option's ONE bonus action, never one per strike.
 */
describe('CombatVM · an action that attacks (UBUG-11)', () => {
	const flurry = (over: Partial<ResourceOption> = {}): ResourceOption => ({
		id: 'monk_flurry',
		resourceId: 'focus',
		resourceName: 'Focus',
		name: 'Flurry of Blows',
		description: '',
		action: `attack:${UNARMED_STRIKE_ID}:2`,
		actionType: 'bonus_action',
		cost: 1,
		available: true,
		...over,
	});
	const monk = (): Character => {
		const c = newCharacter('kel', 'Kel', '5.5e');
		c.play.autoCalc = true;
		c.play.inCombat = true;
		c.play.effects = [
			{ iid: '1', label: 'grant', effects: ['grant_resource:focus:3:short'], positive: true },
		];
		return c;
	};

	it('rolls one entry per strike, and spends ONE bonus action for the pair', async () => {
		const graph = await graphOf();
		const character = monk();
		combat.graph = graph;
		combat.character = character;
		const before = combat.journal.log.length;

		combat.activateResourceOption(flurry());

		expect(combat.journal.log.length - before).toBe(2); // two strikes, two log entries
		expect(character.play.turn.bonus).toBe(1); // ONE bonus action, not one per strike
		expect(combat.resources.resourceSpent('focus')).toBe(1);
		// numbered, so the log says WHICH strike each line was — in throw order, like a volley's beams,
		// because the two were recorded as ONE action
		expect(combat.journal.log[0]?.label).toMatch(/1\/2$/);
		expect(combat.journal.log[1]?.label).toMatch(/2\/2$/);
		// one action, so one group — and each strike keeps an identity of its own, which is what an
		// amendment matches on: sharing a millisecond made re-reading one rewrite both
		const [a, b] = combat.journal.log;
		expect(a?.group).toBeTruthy();
		expect(b?.group).toBe(a?.group);
		expect(a?.at).not.toBe(b?.at);
	});

	it('a weapon the character has not got is surfaced, not silently skipped', async () => {
		const graph = await graphOf();
		const character = monk();
		combat.graph = graph;
		combat.character = character;
		const before = combat.journal.log.length;

		combat.activateResourceOption(flurry({ action: 'attack:greatsword_we_do_not_carry:2' }));

		expect(combat.journal.log.length).toBe(before); // nothing rolled…
		expect(character.play.turn.bonus).toBe(1); // …though the action was still spent (all-or-nothing
		expect(combat.resources.resourceSpent('focus')).toBe(1); // validates the COST, not the content)
	});

	it('a missing count means one strike, and a silly one is capped rather than obeyed', async () => {
		const graph = await graphOf();
		const character = monk();
		combat.graph = graph;
		combat.character = character;

		const before = combat.journal.log.length; // the tray is a singleton, so count the DELTA

		combat.activateResourceOption(flurry({ action: `attack:${UNARMED_STRIKE_ID}` }));
		expect(combat.journal.log.length - before).toBe(1);
		// unnumbered when there is only one — the numbering is the fact under test, so it is asserted
		// as the ABSENCE of an "i/N" rather than on the strike's word
		expect(combat.journal.log[0]?.label).not.toMatch(/\d+\/\d+/);

		character.play.turn.bonus = 0; // fresh turn for the second activation
		combat.activateResourceOption(flurry({ action: `attack:${UNARMED_STRIKE_ID}:500` }));
		expect(combat.journal.log.length - before).toBe(1 + 12); // capped, not five hundred log lines
	});
});

/** UBUG-11 against the REAL content: the shipped Flurry row must actually carry the attack verb, in
 *  BOTH editions. A synthetic option proves the executor; only this proves the feature. */
describe.each([
	['srd-2024', '5.5e' as const, 'SRD 5.2.1'],
	['srd-2014', '5e' as const, 'SRD 5.1'],
])('CombatVM · Flurry of Blows really strikes (%s)', (pack, system, source) => {
	let character: Character;
	beforeEach(async () => {
		combat.graph = await realGraph(pack);
		character = newCharacter('kel', 'Kel', system);
		character.build.classes = [{ class: `class:${source}:monk`, level: 5 }];
		character.play.inCombat = true;
		combat.character = character;
	});

	it('the shipped option fires two Unarmed Strikes instead of toasting a note', () => {
		const flurry = combat.sheet?.resourceOptions.find((o) => o.id.endsWith('flurry_of_blows'));
		expect(flurry?.action).toBe(`attack:${UNARMED_STRIKE_ID}:2`);
		if (!flurry) return;
		const before = combat.journal.log.length;
		combat.activateResourceOption(flurry);
		expect(combat.journal.log.length - before).toBe(2);
		expect(character.play.turn.bonus).toBe(1); // one Bonus Action for the pair
	});
});

describe('CombatVM · the death-save track belongs to being at 0 HP', () => {
	let character: Character;
	beforeEach(async () => {
		combat.graph = await graphOf();
		character = newCharacter('valen', 'Valen', '5.5e');
		combat.character = character;
		combat.hp.damageWasCrit = false;
	});

	it('healing out of 0 HP clears it — RAW "reset to zero when you regain any hit points"', () => {
		character.play.hp = { current: 0, max: 20, temp: 0 };
		character.play.deathSaves = { successes: 1, failures: 2 };
		combat.hpAmount = 5;
		combat.heal();
		combat.syncDyingState();
		expect(character.play.hp.current).toBe(5);
		expect(character.play.deathSaves).toEqual({ successes: 0, failures: 0 });
	});

	it('a "was it a critical?" nobody spent on a hit does not wait for the next one', () => {
		character.play.hp = { current: 0, max: 20, temp: 0 };
		combat.hp.damageWasCrit = true; // ticked at 0 HP…
		combat.hpAmount = 5;
		combat.heal(); // …and then healed rather than hit, which hides the checkbox
		combat.syncDyingState();
		expect(combat.hp.damageWasCrit).toBe(false);
		// down again: the next ordinary hit costs ONE failure, not the stale crit's two
		character.play.hp.current = 0;
		combat.hpAmount = 3;
		combat.damage();
		expect(character.play.deathSaves.failures).toBe(1);
	});

	it('a long rest fills to the EFFECTIVE max, manual max and hp_max effect together (A14)', () => {
		character.play.hp = { current: 5, max: 30, temp: 4 }; // a MANUAL max of 30
		combat.effects.addEffect({
			label: 'Aid',
			tokens: ['flat_bonus:hp_max+5'],
			positive: true,
		});
		expect(combat.hpMax).toBe(35); // what heal and the bar already use
		combat.resources.rest('long');
		expect(character.play.hp.current).toBe(35);
		expect(character.play.hp.temp).toBe(0);
	});

	it('filling the third success pip by hand stabilises, like the rolled track does', () => {
		character.play.hp = { current: 0, max: 20, temp: 0 };
		character.play.deathSaves = { successes: 2, failures: 1 };
		combat.toggleDeathSave('successes', 2); // the third pip
		expect(character.play.deathSaves).toEqual({ successes: 0, failures: 0 });
		// and a stable character's next hit starts the track over rather than continuing it
		combat.hpAmount = 3;
		combat.damage();
		expect(character.play.deathSaves.failures).toBe(1);
	});

	it('a dead character keeps their track — one can die at full hit points', () => {
		character.play.hp = { current: 20, max: 20, temp: 0 };
		character.play.deathSaves = { successes: 0, failures: 3 };
		character.play.death = { cause: 'death_saves' };
		combat.syncDyingState();
		expect(character.play.deathSaves.failures).toBe(3);
	});
});
