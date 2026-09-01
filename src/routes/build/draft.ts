/*
 * The Build draft MODEL — every user-editable creation choice as one typed object, plus its pure
 * factories (blank / from-an-existing-character) and the small pick helpers. Split out of the reactive
 * BuildVM so the draft shape + its construction are unit-testable with no Svelte runtime.
 */
import type { SystemId } from '$lib/stores/app.svelte';
import type { Ability } from '$lib/rules/core';
import { DEFAULT_SYSTEM } from '$lib/rules/pipeline';
import type { Character, ShortRestMode } from '$lib/character/schema';
import type { ContentType } from '$lib/content/schemas';
import { baseAbilities, type StatMethod, type BoostShape } from '$lib/build/rules';

/** ASI allocation shape: +2 to one ability ('2') or +1 to two ('1-1'). */
export type AsiShape = '2' | '1-1';
/** How many abilities an ASI shape lets you pick ('2' → 1 target, '1-1' → 2 targets). */
export const asiPickCount = (shape: AsiShape): number => (shape === '2' ? 1 : 2);

/**
 * Toggle `item` in a capped multi-select list: drop it if already picked, else add it — and at the
 * cap, add it in place of the oldest pick rather than refusing.
 *
 * A full "+2 to one ability" picker that ignores the chip you click is a dead end you have to work
 * out for yourself: nothing on screen says the way forward is to un-pick something first. Making the
 * click land is both what a player means by it and the way back out of a wrong pick.
 *
 * The shared shape behind every "pick up to N" control in the builder (ability boosts, ASI targets,
 * a feat's granted skills) so they cannot drift apart.
 */
export function toggleCapped<T>(list: T[], item: T, cap: number): T[] {
	if (list.includes(item)) return list.filter((x) => x !== item);
	if (cap <= 0) return list;
	return [...list.slice(Math.max(0, list.length - cap + 1)), item];
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
	/** Short-rest healing model (rules variant): `dice` (RAW) or `half` (½ max HP). */
	shortRestMode: ShortRestMode;
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
	/** Half-feat ability choice per slot: the +1 a feat like Grappler (STR/DEX) or an Epic Boon
	 *  (any) grants, keyed by slot. Folds into `abilityBoosts` at assemble. */
	slotFeatAbility: Record<string, Ability>;
	/** §C skill choice-grant per slot: the chosen skill ids for a feat that grants N picks (Skilled),
	 *  keyed by slot (the origin-feat picker uses the `'origin'` key). Folds into `build.featSkills`. */
	slotFeatSkills: Record<string, string[]>;
	selectedSpells: string[];
	inventory: { item: string; qty: number; equipped: boolean; attuned: boolean }[];
	/** Free prose for the table — bonds, flaws, a debt. One bullet per line; affects nothing. */
	notes: string;
}

/** A blank new-character draft. The one source of default choices (reset + the initial state). */
export function blankDraft(): DraftState {
	return {
		name: '',
		// newest ruleset by default; the build page's edition switcher changes it before saving
		system: DEFAULT_SYSTEM,
		strict: true,
		// ½ max HP by default: most tables run the flat-heal variant, and spending Hit Dice is the
		// opt-in the header switches to.
		shortRestMode: 'half',
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
		slotFeatAbility: {},
		slotFeatSkills: {},
		selectedSpells: [],
		inventory: [],
		notes: ''
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
		shortRestMode: char.ui.shortRestMode,
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
		// restore the per-slot ASI/feat picks so a level-up shows already-filled slots and re-derives
		// their boosts from the slots (never re-offers + double-applies them — UBUG-13). Old saves have
		// empty maps → slots open blank and their boosts stay carried flat via `edit.boosts`.
		slotFeats: { ...char.build.slotPicks.feats },
		slotAsi: { ...char.build.slotPicks.asi },
		slotFeatAbility: { ...char.build.slotPicks.featAbility },
		slotFeatSkills: { ...char.build.slotPicks.featSkills },
		notes: char.build.notes,
		inventory: char.build.inventory.map((i) => ({
			item: i.item,
			qty: i.qty,
			equipped: i.equipped,
			attuned: i.attuned // preserve attunement through the builder round-trip (D15)
		}))
	};
}

/**
 * Is there anything here worth keeping if the user walks away?
 *
 * Opening /build must not litter the data folder with empty drafts, so a draft is only persisted
 * once it holds a decision. Ability scores and the rules toggles are excluded on purpose: they have
 * defaults, so they are never evidence that someone started building.
 */
export function isDraftWorthKeeping(draft: DraftState): boolean {
	return Boolean(
		draft.name.trim() ||
			draft.speciesId ||
			draft.backgroundId ||
			draft.classes.some((c) => c.classId)
	);
}

/** The one line the roster shows for an unfinished build. Refs are `type:source:id`, so the last
 *  segment is the readable part — the roster does the same for saved characters. */
export function draftSummary(draft: DraftState): {
	name: string;
	classes: string;
	level: number;
	system: SystemId;
} {
	const taken = draft.classes.filter((c) => c.classId);
	return {
		name: draft.name.trim(),
		classes: taken.map((c) => `${c.classId?.split(':').pop()} ${c.level}`).join(' / '),
		level: taken.reduce((n, c) => n + c.level, 0),
		system: draft.system
	};
}

/** RV3: the refs the draft currently holds for a content type. A picker keeps these even when their
 *  source is disabled, so a selection made BEFORE turning a source off never vanishes from its own
 *  picker (and stays re-pickable) — mirroring how the spellbook keeps the character's own spells
 *  regardless of the source filter. Refs are stored as `effectiveId` (the picker option values). */
export function selectedRefs(draft: DraftState, type: ContentType): Set<string> {
	const refsByType: Partial<Record<ContentType, (string | null)[]>> = {
		species: [draft.speciesId],
		species_option: [draft.speciesOptionId],
		background: [draft.backgroundId],
		class: draft.classes.map((c) => c.classId),
		subclass: draft.classes.map((c) => c.subclassId),
		feat: Object.values(draft.slotFeats),
		language: draft.selectedLanguages,
		item: draft.inventory.map((i) => i.item),
		spell: draft.selectedSpells
	};
	return new Set((refsByType[type] ?? []).filter((x): x is string => !!x));
}

/** What a level-up / edit carries over from the loaded character (null on the BuildVM = creating). */
export interface EditContext {
	id: string;
	play: Character['play'];
	ui: Character['ui'];
	/** Ability boosts carried verbatim, INCLUDING the share the restored slots re-derive for
	 *  themselves — `AbilityAllocation.abilityBoosts` nets that back out. New picks add on top. */
	boosts: Partial<Record<Ability, number>>;
	feats: string[];
	/** Feat-granted skill choices (§C) carried verbatim on edit — new slot picks add on top, mirroring
	 *  `boosts` (feat sub-choices aren't reverse-mapped to slots, so they can't be re-picked, only kept). */
	featSkills: string[];
	/** Spells / skills the character already had — can't be undone in Strict edit. */
	spells: Set<string>;
	skills: Set<string>;
}
