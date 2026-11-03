import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import type { ContentGraph } from '$lib/content/loader';
import { SYSTEMS, characterSchema } from '$lib/character/schema';
import { build } from './build-view-model.svelte';
import { draftFromCharacter, newClassRow, parseDraftState } from './draft';
import type { InspectorTarget } from './inspector-specs';

const WIZARD = 'wizard';
const CLERIC = 'cleric';
const MAGIC_INITIATE = 'magic_initiate';
let graph: ContentGraph;

beforeAll(async () => {
	graph = await loadPacks('srd-2014', 'srd-2024');
});

const firstOption = () => {
	const option = build.inspector.pick?.options[0];
	if (!option) throw new Error('The inspector needs a content option');
	return option.effectiveId;
};

function classRef(id: string): string {
	const row = build.classList.find((entry) => entry.id === id);
	if (!row) throw new Error(`Missing class ${id}`);
	return row.effectiveId;
}

describe.each(SYSTEMS)('builder reversible picks · %s', (system) => {
	beforeEach(() => {
		build.reset();
		build.graph = graph;
		build.draft.system = system;
		build.draft.name = 'Builder hotfix';
	});

	const targets: InspectorTarget[] = [
		{ id: 'species' },
		{ id: 'background' },
		{ id: 'class', index: 0 },
	];
	it.each(targets)('taking a taken $id clears the creation choice', (target) => {
		build.inspector.open(target);
		const ref = firstOption();
		build.inspector.take(ref);
		expect(build.inspector.pick?.currentId).toBe(ref);
		build.inspector.take(ref);
		expect(build.inspector.pick?.currentId).toBeNull();
		build.inspector.take(ref);
		expect(build.inspector.pick?.currentId).toBe(ref);
	});

	it.each(targets)('Strict preserves a taken $id; Free makes it reversible', (target) => {
		build.inspector.open(target);
		const ref = firstOption();
		build.inspector.take(ref);
		const saved = characterSchema.parse(build.assembled);
		build.hydrate(saved);
		build.inspector.open(target);
		build.inspector.take(ref);
		expect(build.inspector.pick?.currentId).toBe(ref);
		expect(build.inspector.pick?.clearable).toBe(false);
		build.draft.strict = false;
		build.inspector.take(ref);
		expect(build.inspector.pick?.currentId).toBeNull();
	});

	it('keeps two caster counters while reusing one active pool', () => {
		build.draft.classes = [WIZARD, CLERIC].map((id) => ({
			...newClassRow(),
			classId: classRef(id),
			level: 3,
		}));
		expect(build.spellPicks.picker).toHaveLength(2);
		for (const profile of build.spellPicks.picker) {
			build.spellPicks.profileId = profile.profile.classEffectiveId;
			expect(build.spellPicks.active?.profile.classEffectiveId).toBe(
				profile.profile.classEffectiveId,
			);
			expect(build.spellPicks.active?.groups).toEqual(profile.groups);
		}
	});
});

describe('builder feat spell ownership', () => {
	beforeEach(() => {
		build.reset();
		build.graph = graph;
		build.draft.system = SYSTEMS[1];
		build.draft.name = 'Feat caster';
		build.draft.classes = [{ ...newClassRow(), classId: classRef(WIZARD), level: 4 }];
	});

	function prepareFeat() {
		const slot = build.feats.featSlots.find((entry) => entry.level === 4);
		const feat = build.feats.featOptionsFor(4).find((row) => row.id === MAGIC_INITIATE);
		if (!slot || !feat) throw new Error('Missing spell-teaching feat slot');
		build.feats.setSlotFeat(slot.key, feat.effectiveId);
		build.feats.setFeatSpellList(slot.key, WIZARD);
		build.feats.setFeatSpellAbility(slot.key, 'int');
		build.spellPicks.profileId = `${feat.effectiveId}.${slot.key}`;
		const spell = build.spellPicks.active?.groups.find((group) => group.level === 1)?.spells[0];
		if (!spell) throw new Error('Missing first-level feat spell');
		return { key: slot.key, ref: spell.effectiveId };
	}

	it('saves chosen refs under the feat instance and restores them without class ownership', () => {
		const { key, ref } = prepareFeat();
		build.spellPicks.toggleForActive(ref);
		expect(build.draft.selectedSpells).not.toContain(ref);
		expect(build.spellPicks.activeHeld).toContain(ref);
		expect(build.spellPicks.active?.leveledChosen).toBe(1);
		const saved = characterSchema.parse(build.assembled);
		expect(saved.build.featSpells.find((choice) => choice.key === key)?.spells).toEqual([ref]);
		expect(saved.build.slotPicks.featSpells[key]?.spells).toEqual([ref]);
		expect(parseDraftState(build.draft).slotFeatSpells[key]?.spells).toEqual([ref]);
		build.hydrate(saved);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([ref]);
		build.spellPicks.toggleForActive(ref);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([ref]);
		build.draft.strict = false;
		build.spellPicks.toggleForActive(ref);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([]);
	});

	it('restores top-level feat refs when a save has no slot answer, without sharing arrays', () => {
		const { key, ref } = prepareFeat();
		build.spellPicks.toggleForActive(ref);
		const saved = characterSchema.parse(build.assembled);
		delete saved.build.slotPicks.featSpells[key];
		const draft = draftFromCharacter(saved);
		expect(draft.slotFeatSpells[key]?.spells).toEqual([ref]);
		draft.slotFeatSpells[key]?.spells?.push(ref);
		expect(saved.build.featSpells.find((choice) => choice.key === key)?.spells).toEqual([ref]);
	});

	it('retains spells when changing ability and drops them when changing the list or feat', () => {
		const { key, ref } = prepareFeat();
		build.spellPicks.toggleForActive(ref);
		build.feats.setFeatSpellAbility(key, 'wis');
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([ref]);
		build.feats.setFeatSpellList(key, CLERIC);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([]);
		build.feats.setSlotFeat(key, '');
		expect(build.draft.slotFeatSpells[key]).toBeUndefined();
	});

	it('does not assign legacy flat spells to a feat until an explicit spell pick', () => {
		const { key, ref } = prepareFeat();
		const saved = characterSchema.parse(build.assembled);
		for (const choice of saved.build.featSpells) delete choice.spells;
		for (const choice of Object.values(saved.build.slotPicks.featSpells)) delete choice.spells;
		saved.build.spells = [{ spell: ref, prepared: false, alwaysPrepared: false }];
		build.hydrate(saved);
		expect(build.draft.slotFeatSpells[key]?.spells).toBeUndefined();
		expect(
			build.assembled.build.featSpells.find((choice) => choice.key === key)?.spells,
		).toBeUndefined();
		expect(build.assembled.build.spells).toEqual(saved.build.spells);
		build.feats.setFeatSpellAbility(key, 'wis');
		build.feats.setFeatSpellList(key, WIZARD);
		expect(build.feats.featSpellChoiceFor(key)?.spells).toBeUndefined();
		expect(build.spellPicks.activeHeld).not.toContain(ref);
		build.spellPicks.toggleForActive(ref);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([ref]);
		expect(build.draft.selectedSpells).toContain(ref);
		expect(build.assembled.build.spells).toEqual(saved.build.spells);
	});

	it('selects and untakes the same ref independently as a class and a feat', () => {
		const { key, ref } = prepareFeat();
		build.spellPicks.toggle(ref);
		build.spellPicks.toggleForActive(ref);
		expect(build.draft.selectedSpells).toContain(ref);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([ref]);
		build.spellPicks.toggleForActive(ref);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([]);
		expect(build.draft.selectedSpells).toContain(ref);
	});

	it('allows a class pick after the same ref is chosen by a feat', () => {
		const { key, ref } = prepareFeat();
		build.spellPicks.toggleForActive(ref);
		expect(build.spellPicks.granted.has(ref)).toBe(false);
		build.spellPicks.toggle(ref);
		expect(build.draft.selectedSpells).toContain(ref);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([ref]);
		build.spellPicks.remove(ref);
		expect(build.draft.selectedSpells).not.toContain(ref);
		expect(build.draft.slotFeatSpells[key]?.spells).toEqual([]);
	});
});
