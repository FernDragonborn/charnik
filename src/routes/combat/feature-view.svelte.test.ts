import { describe, it, expect, beforeEach } from 'vitest';

/*
 * The preset predicate, which is pure logic and cheaper to hold here than in a browser drive. The
 * one thing every case is really asking: a preset WRITES the hidden list, so what a player toggles
 * by hand and what a preset decides are the same state read twice.
 */
import { FeatureView } from './feature-view.svelte';
import { FEATURE_PRESET, FEATURE_SECTION, type CharacterFeature } from '$lib/character/features';
import { newCharacter } from '$lib/character/schema';
import { makeRow } from '$lib/content/test-utils';

const classFeature = (id: string, at: number, className: string): CharacterFeature => ({
	section: FEATURE_SECTION.classFeatures,
	row: makeRow('class_feature', { id }),
	at,
	className,
});
/** A trait, a background grant or a feat: no class granted it, so no class may filter it away. */
const originFeature = (id: string): CharacterFeature => ({
	section: FEATURE_SECTION.speciesTraits,
	row: makeRow('species', { id }),
});

const idOf = (f: CharacterFeature) => f.row.effectiveId;

const features = [
	classFeature('rage', 1, 'Barbarian'),
	classFeature('reckless_attack', 2, 'Barbarian'),
	classFeature('second_wind', 1, 'Fighter'),
	originFeature('darkvision'),
];
const [rage, reckless, secondWind, darkvision] = features.map(idOf) as [
	string,
	string,
	string,
	string,
];

let character = $state(newCharacter('c1', 'Tester', '5.5e'));
let view: FeatureView;

beforeEach(() => {
	character = newCharacter('c1', 'Tester', '5.5e');
	view = new FeatureView(
		() => character,
		() => features,
	);
});

describe('hiding by hand', () => {
	it('toggles both ways, and `visible` is what is left', () => {
		view.toggleHidden(rage);
		expect(view.isHidden(rage)).toBe(true);
		expect(view.visible.map(idOf)).toEqual([reckless, secondWind, darkvision]);

		view.toggleHidden(rage);
		expect(view.isHidden(rage)).toBe(false);
		expect(view.visible).toHaveLength(features.length);
	});

	it('pins independently of hiding — a pinned row is still a row that can be hidden', () => {
		view.togglePinned(rage);
		expect(view.isPinned(rage)).toBe(true);
		expect(view.isHidden(rage)).toBe(false);

		view.toggleHidden(rage);
		expect(view.isPinned(rage)).toBe(true);
		expect(view.visible.map(idOf)).not.toContain(rage);
	});
});

describe('presets write the hidden list', () => {
	it('`newest` keeps only what the highest class level granted', () => {
		view.applyPreset(FEATURE_PRESET.newest);
		// level 2 is the top here, so the two level-1 features and the class-less trait all go
		expect(view.visible.map(idOf)).toEqual([reckless]);
	});

	it('`class` narrows the CLASS features and leaves the rest alone', () => {
		view.applyPreset(FEATURE_PRESET.class, 'Barbarian');
		expect(view.visible.map(idOf)).toEqual([rage, reckless, darkvision]);
		expect(view.isHidden(secondWind)).toBe(true);
	});

	it('`all` clears what a previous preset wrote', () => {
		view.applyPreset(FEATURE_PRESET.newest);
		view.applyPreset(FEATURE_PRESET.all);
		expect(view.visible).toHaveLength(features.length);
		expect(character.ui.featuresHidden).toEqual([]);
	});

	it('is the same state a hand toggle writes, so one undoes the other', () => {
		view.applyPreset(FEATURE_PRESET.class, 'Fighter');
		expect(view.isHidden(rage)).toBe(true);
		view.toggleHidden(rage);
		expect(view.visible.map(idOf)).toContain(rage);
	});
});

describe('a pin survives every preset', () => {
	it.each([
		[FEATURE_PRESET.newest, undefined],
		[FEATURE_PRESET.class, 'Fighter'],
	])('%s', (preset, className) => {
		view.togglePinned(rage);
		view.applyPreset(preset, className);
		expect(view.isHidden(rage)).toBe(false);
		expect(view.visible.map(idOf)).toContain(rage);
	});
});

describe('the classes a preset may narrow to', () => {
	it('lists each class once and drops the features no class granted', () => {
		expect(view.classes).toEqual(['Barbarian', 'Fighter']);
	});
});
