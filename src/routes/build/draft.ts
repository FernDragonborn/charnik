/*
 * The Build draft MODEL — every user-editable creation choice as one typed object, plus its pure
 * factories (blank / from-an-existing-character) and the small pick helpers. Split out of the reactive
 * BuildVM so the draft shape + its construction are unit-testable with no Svelte runtime.
 */
import { z } from 'zod';
import type { SystemId } from '$lib/stores/app.svelte';
import type { Ability } from '$lib/rules/core';
import { DEFAULT_SYSTEM } from '$lib/rules/pipeline';
import {
	abilityScores,
	ABILITIES,
	SHORT_REST_MODES,
	SYSTEMS,
	type Character,
	type ShortRestMode,
} from '$lib/character/schema';
import type { ContentType } from '$lib/content/schemas';
import {
	baseAbilities,
	BOOST_SHAPES,
	MAX_CHARACTER_LEVEL,
	STAT_METHODS,
	type StatMethod,
	type BoostShape,
} from '$lib/build/rules';

/** ASI allocation shape: +2 to one ability ('2') or +1 to two ('1-1'). */
const ASI_SHAPES = ['2', '1-1'] as const;
export type AsiShape = (typeof ASI_SHAPES)[number];
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
export interface DraftClass {
	/**
	 * The ROW's identity, and the prefix of every slot key that belongs to it.
	 *
	 * A GUID rather than the row's position, because the position is not an identity: dropping a row
	 * out of the middle used to move every row behind it onto keys belonging to somebody else, and
	 * fifty lines existed to read the maps out and write them back under the indexes each row had
	 * just inherited. An id nobody has to renumber is what makes that go away — and it is what an
	 * `{#each}` needs to stop keying rows by their place in the list.
	 */
	rowId: string;
	classId: string | null;
	subclassId: string | null;
	level: number;
}

/** A fresh empty class row. */
export const newClassRow = (): DraftClass => ({
	rowId: crypto.randomUUID(),
	classId: null,
	subclassId: null,
	level: 1,
});

/**
 * The key the background's origin feat keeps its own choices under.
 *
 * Not a `<rowId>:<level>` slot, because the feat is GRANTED rather than chosen — but the choices it
 * then asks for (a half-feat's +1, a Skilled-shaped feat's skills) are the same shape as a slot's, so
 * they live in the same maps under one reserved key.
 */
export const ORIGIN_SLOT_KEY = 'origin';

/** The four per-slot maps as the draft holds them — keyed `<rowId>:<level>`. */
interface SlotMaps {
	slotFeats: Record<string, string>;
	slotAsi: Record<string, { shape: AsiShape; picks: Ability[] }>;
	slotFeatAbility: Record<string, Ability>;
	slotFeatSkills: Record<string, string[]>;
}

/**
 * Give every row an id, moving the slot keys of any row that has none.
 *
 * Drafts and characters saved before rows had ids key their slots by the row's INDEX, so a row
 * getting `rowId` now takes its `0:4`, `0:8` … with it. Runs on both read paths; a row that already
 * carries an id is left alone, so this costs one pass and never fires twice.
 */
function adoptRowIds(rows: DraftClass[], slots: SlotMaps): void {
	// one element type, so a write into any of them is a write of that map's own value type — the
	// four maps hold different values, and reading them as one union makes every write a cast
	const maps: Record<string, unknown>[] = [
		slots.slotFeats,
		slots.slotAsi,
		slots.slotFeatAbility,
		slots.slotFeatSkills,
	];
	rows.forEach((row, index) => {
		if (row.rowId) return;
		row.rowId = crypto.randomUUID();
		for (const map of maps)
			for (const key of Object.keys(map)) {
				const [prefix, level] = key.split(':');
				if (prefix !== String(index) || !level) continue;
				// the row's own key, under the number it used to be
				map[`${row.rowId}:${level}`] = map[key];
				delete map[key];
			}
	});
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
	/** What the player typed instead of picking — see `character/schema.ts`. */
	customLanguages: string[];
	customTools: string[];
	slotFeats: Record<string, string>;
	slotAsi: Record<string, { shape: AsiShape; picks: Ability[] }>;
	/** Half-feat ability choice per slot: the +1 a feat like Grappler (STR/DEX) or an Epic Boon
	 *  (any) grants, keyed by slot. Folds into `abilityBoosts` at assemble. */
	slotFeatAbility: Record<string, Ability>;
	/** §C skill choice-grant per slot: the chosen skill ids for a feat that grants N picks (Skilled),
	 *  keyed by slot (the origin feat's own picks live under {@link ORIGIN_SLOT_KEY}). Folds into
	 *  `build.featSkills`. */
	slotFeatSkills: Record<string, string[]>;
	selectedSpells: string[];
	/** Carried items, in the SAVE's own entry shape rather than a hand-listed copy of it: the copy had
	 *  already dropped `attuned` once and `base` (which weapon a template magic item IS) once, and each
	 *  loss was silent because the draft type agreed with the mapper. Borrowing the type makes a new
	 *  REQUIRED column fail here; the round-trip test in `build.test.ts` covers the optional ones. */
	inventory: Character['build']['inventory'];
	/** Free prose for the table — bonds, flaws, a debt. One bullet per line; affects nothing. */
	notes: string;
	/** The portrait file already SAVED beside this character (`photo.webp`), or null. A portrait
	 *  picked during a build is not here — it is bytes with nowhere to land until the character has a
	 *  folder, so it waits in the view-model and this becomes its name at the first save. */
	photo: string | null;
}

/** A blank new-character draft. The one source of default choices (reset + the initial state). */
export function blankDraft(): DraftState {
	return {
		name: '',
		photo: null,
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
		classes: [newClassRow()],
		method: 'point_buy',
		abilities: baseAbilities(),
		arrayPick: {},
		boostShape: '2-1',
		boostPicks: [],
		skills: [],
		expertise: [],
		selectedLanguages: [],
		customLanguages: [],
		customTools: [],
		slotFeats: {},
		slotAsi: {},
		slotFeatAbility: {},
		slotFeatSkills: {},
		selectedSpells: [],
		inventory: [],
		notes: ''
	};
}

/**
 * A draft as it comes back off disk.
 *
 * The file is the user's own unfinished work: hand-editable, and written by whatever version of
 * Charnik they had when they left it. So it is PARSED, never cast. Every field falls back to the
 * blank draft's value, which is what lets a draft saved before a field existed still open — the
 * alternative is the first `.reduce` or `.length` on `undefined` taking the page down at render,
 * with no way back to the work.
 *
 * Fallbacks are FUNCTIONS, not values: a shared `[]` or `{}` would be handed to every draft that
 * needed one, and the slot maps are edited in place.
 */
/** The four per-slot maps, shared with the class stash — which holds the same maps re-keyed by level,
 *  and is read back off the same file. */
export const slotMapSchemas = {
	feats: z.record(z.string(), z.string()),
	asi: z.record(
		z.string(),
		z.object({ shape: z.enum(ASI_SHAPES), picks: z.array(z.enum(ABILITIES)) }),
	),
	ability: z.record(z.string(), z.enum(ABILITIES)),
	skills: z.record(z.string(), z.array(z.string())),
} as const;

const draftStateSchema: z.ZodType<DraftState> = z.object({
	name: z.string().catch(''),
	photo: z.string().nullable().catch(null),
	system: z.enum(SYSTEMS).catch(DEFAULT_SYSTEM),
	strict: z.boolean().catch(true),
	shortRestMode: z.enum(SHORT_REST_MODES).catch('half'),
	speciesId: z.string().nullable().catch(null),
	speciesOptionId: z.string().nullable().catch(null),
	speciesBoostPicks: z.array(z.enum(ABILITIES)).catch(() => []),
	backgroundId: z.string().nullable().catch(null),
	classes: z
		.array(
			z.object({
				rowId: z.string().catch(''),
				classId: z.string().nullable().catch(null),
				subclassId: z.string().nullable().catch(null),
				level: z.number().int().min(1).max(MAX_CHARACTER_LEVEL).catch(1),
			}),
		)
		.catch(() => [newClassRow()]),
	method: z.enum(STAT_METHODS).catch('point_buy'),
	abilities: abilityScores.catch(() => baseAbilities()),
	arrayPick: z.partialRecord(z.enum(ABILITIES), z.number().int()).catch(() => ({})),
	boostShape: z.enum(BOOST_SHAPES).catch('2-1'),
	boostPicks: z.array(z.enum(ABILITIES)).catch(() => []),
	skills: z.array(z.string()).catch(() => []),
	expertise: z.array(z.string()).catch(() => []),
	selectedLanguages: z.array(z.string()).catch(() => []),
	customLanguages: z.array(z.string()).catch(() => []),
	customTools: z.array(z.string()).catch(() => []),
	slotFeats: slotMapSchemas.feats.catch(() => ({})),
	slotAsi: slotMapSchemas.asi.catch(() => ({})),
	slotFeatAbility: slotMapSchemas.ability.catch(() => ({})),
	slotFeatSkills: slotMapSchemas.skills.catch(() => ({})),
	selectedSpells: z.array(z.string()).catch(() => []),
	inventory: z
		.array(
			z.object({
				item: z.string(),
				qty: z.number().int().catch(1),
				equipped: z.boolean().catch(false),
				attuned: z.boolean().catch(false),
			}),
		)
		.catch(() => []),
	notes: z.string().catch(''),
});

/** Read a stored draft. Anything unrecognisable in place of the whole object is a blank draft — the
 *  record was already dropped by the repository if it would not even parse as JSON. */
export function parseDraftState(value: unknown): DraftState {
	const parsed = draftStateSchema.safeParse(value);
	if (!parsed.success) return blankDraft();
	adoptRowIds(parsed.data.classes, parsed.data); // a draft saved when slot keys named a row index
	return parsed.data;
}

/** Load an existing character into a fresh draft (edit / level-up). Straightforward fields map
 *  directly; abilities become manual with prior boosts/feats carried separately (see hydrate). New
 *  per-level picks (slotFeats/slotAsi/boost*) start blank so a prior session can't leak in. */
export function draftFromCharacter(char: Character): DraftState {
	const draft: DraftState = {
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
					// a save from before rows had ids leaves this blank, and `adoptRowIds` below both
					// mints one and moves that row's slot keys onto it
					rowId: c.rowId ?? '',
					classId: c.class,
					subclassId: c.subclass ?? null,
					level: c.level
				}))
			: [newClassRow()],
		method: 'manual',
		abilities: { ...char.build.abilities },
		skills: [...char.build.skills],
		expertise: [...char.build.expertise],
		selectedLanguages: [...char.build.languages],
		customLanguages: [...char.build.customLanguages],
		customTools: [...char.build.customTools],
		selectedSpells: char.build.spells.map((s) => s.spell),
		// restore the per-slot ASI/feat picks so a level-up shows already-filled slots and re-derives
		// their boosts from the slots (never re-offers + double-applies them — UBUG-13). Old saves have
		// empty maps → slots open blank and their boosts stay carried flat via `edit.boosts`.
		slotFeats: { ...char.build.slotPicks.feats },
		slotAsi: { ...char.build.slotPicks.asi },
		slotFeatAbility: { ...char.build.slotPicks.featAbility },
		slotFeatSkills: { ...char.build.slotPicks.featSkills },
		notes: char.build.notes,
		photo: char.build.photo ?? null,
		inventory: char.build.inventory.map((i) => ({
			item: i.item,
			qty: i.qty,
			equipped: i.equipped,
			attuned: i.attuned, // preserve attunement through the builder round-trip (D15)
			// …and WHICH weapon a template magic item is: without it a level-up strips the base, and the
			// Flame Tongue loses its dice, its damage type and the proficiency its category granted
			...(i.base ? { base: i.base } : {})
		}))
	};
	adoptRowIds(draft.classes, draft);
	return draft;
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
	return new Set((refsHeld(draft)[type] ?? []).filter((x): x is string => !!x));
}

/** Every ref the draft holds, by the type it was picked from. ONE table: a newly picked field is
 *  added here and both readers — the per-type picker filter and the edition switch — see it. */
function refsHeld(draft: DraftState): Partial<Record<ContentType, (string | null)[]>> {
	return {
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
}

/** Flat, for anything that has to look at the whole set of picks rather than one type of them. */
export function allSelectedRefs(draft: DraftState): { type: ContentType; ref: string }[] {
	return Object.entries(refsHeld(draft)).flatMap(([type, refs]) =>
		refs.flatMap((ref) => (ref ? [{ type: type as ContentType, ref }] : []))
	);
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
	/** …and the prepared flags each of those spells was SAVED with. The build cannot re-derive them:
	 *  whether a spell is prepared is the player's answer and `alwaysPrepared` is the class's grant,
	 *  and recomputing both from the spell's level undid every one of those decisions on a level-up. */
	spellFlags: Map<string, { prepared: boolean; alwaysPrepared: boolean }>;
	skills: Set<string>;
	/**
	 * The draft exactly as this character was loaded — every decision it had already made.
	 *
	 * Strict reads it as settled: a level-up ADDS to a character that has been played, so it cannot
	 * re-pick its species, lower a level it has already reached, or drop a class it took. Free lifts
	 * all of it. Kept as the whole draft rather than as a list of frozen fields, because that is what
	 * it is — and a list would need editing every time the draft grows one.
	 */
	loaded: DraftState;
}
