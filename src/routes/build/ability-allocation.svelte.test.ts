/*
 * The six numbers and the layers over them. What is worth pinning here is every place the allocation
 * asks the DRAFT a question — the generation method, Strict vs Free, which edition carries the origin
 * bonuses — because each of those is a branch a screenshot of one edition never walks.
 */
import { describe, it, expect } from 'vitest';
import { AbilityAllocation } from './ability-allocation.svelte';
import { FeatSlots } from './feat-slots.svelte';
import { SkillPicks } from './skill-picks.svelte';
import { blankDraft, type DraftState, type EditContext } from './draft';
import { ASI, rowOfType } from './rows';
import { makeRow } from '$lib/content/test-utils';
import type { Ability } from '$lib/rules/core';
import { assembleCharacter } from '$lib/character/assemble';
import { POINT_BUY_MIN, STANDARD_ARRAY } from '$lib/build/rules';
import type { LoadedRowByType } from '$lib/content/loader';

/** A level-up's carried context. Only the boosts and `loaded` matter here — the rest is what the
 *  save puts back untouched. `loaded` is the draft the save was made FROM, because that is what the
 *  carried boosts are measured against. */
const played = assembleCharacter(
	{ name: 'hero', abilities: blankDraft().abilities },
	{ id: 'hero', system: '5.5e', strict: true, shortRestMode: 'half', play: null, ui: null },
);
const editing = (
	boosts: Partial<Record<Ability, number>> = {},
	loaded: DraftState = blankDraft(),
): EditContext => ({
	id: played.id,
	play: played.play,
	ui: played.ui,
	boosts,
	feats: [],
	featSkills: [],
	spellFlags: new Map(),
	spells: new Set(),
	skills: new Set(),
	loaded,
});

/** The allocation, its draft, and the two neighbours it reads through. Every row lookup answers
 *  `undefined`, so the feat slots fall back to the default ASI levels — which is all `slotBoosts`
 *  needs from the graph. */
function setup(over: Partial<DraftState> = {}, edit: EditContext | null = null) {
	const draft = $state<DraftState>({ ...blankDraft(), ...over });
	const rows = $state<{
		background: LoadedRowByType<'background'> | undefined;
		species: LoadedRowByType<'species'> | undefined;
	}>({ background: undefined, species: undefined });
	const base = {
		draft,
		edit,
		graph: null,
		classRow: undefined,
		speciesOptionRow: undefined,
		row: () => undefined,
		featList: [],
		get backgroundRow() {
			return rows.background;
		},
		get speciesRow() {
			return rows.species;
		},
	};
	// annotated, and each host reads the OTHER lazily: the two know about each other, so an inferred
	// type here is a cycle
	const skillPicks: SkillPicks = new SkillPicks(() => ({ ...base, feats }));
	const feats: FeatSlots = new FeatSlots(() => ({ ...base, skillPicks }));
	return { draft, rows, abilities: new AbilityAllocation(() => ({ ...base, feats })) };
}

describe('AbilityAllocation — generation methods', () => {
	it('point buy counts what is spent and what is left', () => {
		const { draft, abilities } = setup();
		expect(abilities.pointsUsed).toBe(0);
		expect(abilities.pointsLeft).toBe(27);
		abilities.bumpAbility('str', 1);
		expect(draft.abilities.str).toBe(POINT_BUY_MIN + 1);
		expect(abilities.pointsLeft).toBe(26);
	});

	it('point buy refuses to go past its band in either direction', () => {
		const { draft, abilities } = setup();
		for (let i = 0; i < 10; i++) abilities.bumpAbility('str', 1);
		expect(draft.abilities.str).toBe(15); // POINT_BUY_MAX
		for (let i = 0; i < 10; i++) abilities.bumpAbility('str', -1);
		expect(draft.abilities.str).toBe(POINT_BUY_MIN);
	});

	it('a hand-typed score is bounded by the mode, not by the point-buy band', () => {
		const strict = setup({ method: 'manual', abilities: { ...blankDraft().abilities, str: 3 } });
		strict.abilities.bumpAbility('str', -1);
		expect(strict.draft.abilities.str).toBe(3); // Strict floor

		const free = setup({
			method: 'manual',
			strict: false,
			abilities: { ...blankDraft().abilities, str: 3 },
		});
		free.abilities.bumpAbility('str', -1);
		expect(free.draft.abilities.str).toBe(2); // Free goes down to 1
	});

	it('Strict locks the base scores of a character that has been played', () => {
		const { draft, abilities } = setup({ method: 'manual' }, editing());
		abilities.bumpAbility('str', 1);
		expect(draft.abilities.str).toBe(POINT_BUY_MIN); // untouched: increases come from ASI slots
	});

	it('switching to point buy resets the scores, and to the standard array clears the picks', () => {
		const { draft, abilities } = setup({ method: 'manual', arrayPick: { str: 15 } });
		abilities.setMethod('standard_array');
		expect(draft.arrayPick).toEqual({});
		abilities.bumpAbility('str', 1);
		abilities.setMethod('point_buy');
		expect(draft.abilities.str).toBe(POINT_BUY_MIN);
	});

	it('each standard-array value is assigned to one ability at a time', () => {
		const { draft, abilities } = setup({ method: 'standard_array' });
		abilities.assignArray('str', 15);
		abilities.assignArray('dex', 15); // the same value moves rather than duplicating
		expect(draft.arrayPick).toEqual({ dex: 15 });
		expect(draft.abilities.str).toBe(POINT_BUY_MIN); // and the ability it left goes back with it
		expect(abilities.arrayRemaining).toEqual(STANDARD_ARRAY.filter((v) => v !== 15));
		abilities.assignArray('dex', null);
		expect(draft.arrayPick).toEqual({});
		expect(abilities.arrayRemaining).toEqual([...STANDARD_ARRAY]);
	});
});

describe('AbilityAllocation — the layers over the base scores', () => {
	const background = (over: Record<string, unknown>) =>
		rowOfType(makeRow('background', over), 'background');

	it('the 5.5e background choice allocates 2-1 over the abilities it offers', () => {
		const { rows, abilities } = setup({ system: '5.5e', boostPicks: ['str', 'dex'] });
		rows.background = background({ id: 'sage', ability_choices: 'str,dex,int' });
		expect(abilities.backgroundBoosts).toEqual({ str: 2, dex: 1 });
		expect(abilities.abilityBoosts).toEqual({ str: 2, dex: 1 });
	});

	it('and none of it in 5e, where the species carries the origin bonuses', () => {
		const { rows, abilities } = setup({ system: '5e', boostPicks: ['str', 'dex'] });
		rows.background = background({ id: 'sage', ability_choices: 'str,dex,int' });
		expect(abilities.boostCarrier).toBe('species');
		expect(abilities.backgroundBoosts).toEqual({});
	});

	it('a pick the background does not offer is dropped, not honoured', () => {
		const { rows, abilities } = setup({ system: '5.5e', boostPicks: ['cha', 'str'] });
		rows.background = background({ id: 'sage', ability_choices: 'str,dex,int' });
		expect(abilities.backgroundBoosts).toEqual({ str: 2 });
	});

	it("the species' free choice offers every ability its fixed bonus did not take", () => {
		const { rows, draft, abilities } = setup({ system: '5e' });
		rows.species = rowOfType(
			makeRow('species', { id: 'half_elf', boost_choice: '1x2', effects: ['flat_bonus:cha+2'] }),
			'species',
		);
		expect(abilities.speciesBoostChoice).toEqual({ amount: 1, count: 2 });
		expect(abilities.speciesBoostAbilities).not.toContain('cha');

		abilities.toggleSpeciesBoostPick('str');
		abilities.toggleSpeciesBoostPick('dex');
		abilities.toggleSpeciesBoostPick('int'); // at the cap: replaces the oldest pick
		expect(draft.speciesBoostPicks).toEqual(['dex', 'int']);
		expect(abilities.abilityBoosts).toEqual({ dex: 1, int: 1 });
	});

	it('an ASI slot boosts through the slot, and a restored one is not counted twice', () => {
		const filled = {
			strict: false, // Free, so the edit does not lock the scores this test does not touch
			classes: [{ rowId: 'r1', classId: 'class:x:fighter', subclassId: null, level: 4 }],
			slotFeats: { 'r1:4': ASI },
			slotAsi: { 'r1:4': { shape: '2' as const, picks: ['str' as Ability] } },
		};
		const { draft, abilities } = setup(filled, editing({ str: 2 }, { ...blankDraft(), ...filled }));
		expect(abilities.slotBoosts).toEqual({ str: 2 });
		// the carried flat +2 IS this slot's: it re-derives, so only the residue is carried
		expect(abilities.abilityBoosts).toEqual({ str: 2 });

		// moving the pick moves the boost — the save's own +2 cancels wherever the live pick now points
		draft.slotAsi = { 'r1:4': { shape: '2', picks: ['dex'] } };
		expect(abilities.abilityBoosts).toEqual({ dex: 2 });
	});

	it('provenance splits a score into base, allocated boost and everything else', () => {
		const { rows, abilities } = setup({ system: '5.5e', boostPicks: ['str', 'dex'] });
		rows.background = background({ id: 'sage', ability_choices: 'str,dex,int' });
		expect(abilities.provenance('str', 13)).toEqual({
			base: 8,
			boost: 2,
			other: 3, // whatever the sheet derived that this module did not allocate
			carrier: 'background',
		});
	});
});
