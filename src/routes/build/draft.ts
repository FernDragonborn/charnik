/*
 * The Build draft MODEL — every user-editable creation choice as one typed object, plus its pure
 * factories (blank / from-an-existing-character) and the small pick helpers. Split out of the reactive
 * BuildVM so the draft shape + its construction are unit-testable with no Svelte runtime.
 */
import type { SystemId } from '$lib/stores/app.svelte';
import type { Ability } from '$lib/rules/core';
import type { Character } from '$lib/character/schema';
import { baseAbilities, type StatMethod, type BoostShape } from '$lib/build/rules';

/** ASI allocation shape: +2 to one ability ('2') or +1 to two ('1-1'). */
export type AsiShape = '2' | '1-1';
/** How many abilities an ASI shape lets you pick ('2' → 1 target, '1-1' → 2 targets). */
export const asiPickCount = (shape: AsiShape): number => (shape === '2' ? 1 : 2);

/** Toggle `item` in a capped multi-select list: drop it if already picked, else add it only while
 *  under `cap`. The shared shape behind every "pick up to N" control in the builder (ability boosts,
 *  ASI targets, …) so they can't drift apart. */
export function toggleCapped<T>(list: T[], item: T, cap: number): T[] {
	if (list.includes(item)) return list.filter((x) => x !== item);
	return list.length < cap ? [...list, item] : list;
}

/** One class row in the draft (pre-resolution: nullable ids while the user is still choosing). */
interface DraftClass {
	classId: string | null;
	subclassId: string | null;
	level: number;
}

/** Every user-editable build choice, as ONE typed object (single source of the field set — adding a
 *  field means editing `DraftState` + the two factories below, never three scattered places). */
export interface DraftState {
	name: string;
	system: SystemId;
	/** Strict (rules-enforced) vs Free (lenient) authoring. */
	strict: boolean;
	speciesId: string | null;
	speciesOptionId: string | null;
	/** Abilities the user picked for a 5e species floating ASI. */
	speciesBoostPicks: Ability[];
	backgroundId: string | null;
	classes: DraftClass[];
	method: StatMethod;
	abilities: Record<Ability, number>;
	arrayPick: Partial<Record<Ability, number>>;
	boostShape: BoostShape;
	boostPicks: Ability[];
	skills: string[];
	expertise: string[];
	selectedLanguages: string[];
	slotFeats: Record<string, string>;
	slotAsi: Record<string, { shape: AsiShape; picks: Ability[] }>;
	selectedSpells: string[];
	inventory: { item: string; qty: number; equipped: boolean; attuned: boolean }[];
}

/** A blank new-character draft. The one source of default choices (reset + the initial state). */
export function blankDraft(): DraftState {
	return {
		name: '',
		// newest ruleset by default; the build page's 5e/5.5e switcher changes it before saving
		system: '5.5e',
		strict: true,
		speciesId: null,
		speciesOptionId: null,
		speciesBoostPicks: [],
		backgroundId: null,
		classes: [{ classId: null, subclassId: null, level: 1 }],
		method: 'point_buy',
		abilities: baseAbilities(),
		arrayPick: {},
		boostShape: '2-1',
		boostPicks: [],
		skills: [],
		expertise: [],
		selectedLanguages: [],
		slotFeats: {},
		slotAsi: {},
		selectedSpells: [],
		inventory: []
	};
}

/** Load an existing character into a fresh draft (edit / level-up). Straightforward fields map
 *  directly; abilities become manual with prior boosts/feats carried separately (see hydrate). New
 *  per-level picks (slotFeats/slotAsi/boost*) start blank so a prior session can't leak in. */
export function draftFromCharacter(char: Character): DraftState {
	return {
		...blankDraft(),
		name: char.build.name,
		system: char.system,
		strict: char.ui.strict,
		speciesId: char.build.species ?? null,
		speciesOptionId: char.build.speciesOption ?? null,
		backgroundId: char.build.background ?? null,
		classes: char.build.classes.length
			? char.build.classes.map((c) => ({
					classId: c.class,
					subclassId: c.subclass ?? null,
					level: c.level
				}))
			: [{ classId: null, subclassId: null, level: 1 }],
		method: 'manual',
		abilities: { ...char.build.abilities },
		skills: [...char.build.skills],
		expertise: [...char.build.expertise],
		selectedLanguages: [...char.build.languages],
		selectedSpells: char.build.spells.map((s) => s.spell),
		inventory: char.build.inventory.map((i) => ({
			item: i.item,
			qty: i.qty,
			equipped: i.equipped,
			attuned: i.attuned // preserve attunement through the builder round-trip (D15)
		}))
	};
}

/** What a level-up / edit carries over from the loaded character (null on the BuildVM = creating). */
export interface EditContext {
	id: string;
	play: Character['play'];
	ui: Character['ui'];
	/** Ability boosts carried verbatim (not reverse-engineered); new picks add on top. */
	boosts: Partial<Record<Ability, number>>;
	feats: string[];
	/** Spells / skills the character already had — can't be undone in Strict edit. */
	spells: Set<string>;
	skills: Set<string>;
}
