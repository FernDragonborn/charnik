/*
 * The character model (`characters/<slug>/character.json`).
 *
 * Two hard separations, per docs/plan.md:
 *   - **build/definition** (what the character IS — chosen at build/level-up) vs
 *     **runtime/play-state** (what changes during play — HP, slots, conditions…).
 *     Resetting play never touches the build; a long rest only edits `play`.
 *   - **references, not copies**: content is stored as `type:source:id` refs (the loader's
 *     effectiveId). A default save is refs-only; a *bundle* export (later) embeds the rows.
 *     Missing referenced content is handled at render time (loader.resolveRefs) — the model
 *     just holds the ref.
 *
 * A character is **bound to its system** (`5e`/`5.5e`) at creation and always renders in it.
 * Carries `schemaVersion` so old saves migrate forward. The append-only roll log lives in a
 * sibling `log.jsonl`, NOT here, so it can't bloat the character file.
 */
import { z } from 'zod';
import { CHARACTER_SCHEMA_VERSION } from '../schema/version';

// single owners re-exported (half the app imports these here): systems from rules/pipeline (F7/D2),
// ability ids from rules/core (F3).
import { SYSTEMS } from '../rules/pipeline';
export { SYSTEMS };
export { ABILITY_IDS as ABILITIES } from '../rules/core';
import { ABILITY_IDS as ABILITIES } from '../rules/core';

/** A content reference: `type:source:id` (loader effectiveId). */
const ref = z.string().min(1);
// underscore REQUIRED: `slugify` emits snake_case (E3) — without `_` here every multi-word
// character name failed validation and refused to save; hyphens stay accepted for pre-E3 saves
const slug = z
	.string()
	.regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug: lowercase, digits, underscores/hyphens');

export const abilityScores = z.object(
	Object.fromEntries(ABILITIES.map((a) => [a, z.number().int().min(1).max(30)])) as Record<
		(typeof ABILITIES)[number],
		z.ZodNumber
	>,
);

// --- build / definition -------------------------------------------------------

const classEntry = z.object({
	class: ref,
	level: z.number().int().min(1).max(20),
	subclass: ref.optional(),
	/** The row's own identity, which `slotPicks` is keyed by. Absent on saves written while the keys
	 *  named a row INDEX — the builder gives those rows an id and moves their keys onto it. */
	rowId: z.string().optional(),
});

/** The tallest exhaustion ladder a character may carry. The DATA owns the real ceiling (a condition
 *  row's `max_level`), so this is only the sanity bound the save schema validates against — but the
 *  stepper has to know it, because a level the schema refuses is a character that can never be saved
 *  again and nothing would say so. */
export const EXHAUSTION_MAX = 20;

const inventoryEntry = z.object({
	item: ref,
	qty: z.number().int().min(1).default(1),
	equipped: z.boolean().default(false),
	attuned: z.boolean().default(false),
	/** The mundane item a TEMPLATE magic item is — a Flame Tongue is "any Simple or Martial weapon",
	 *  so which weapon it is belongs to the player who found it, not to the content row. Absent for
	 *  every item that states its own dice or names its own `base_item_id`. */
	base: ref.optional(),
});

const spellEntry = z.object({
	spell: ref,
	/** Prepared casters toggle this; always-prepared (domain/feat) can't be unset. */
	prepared: z.boolean().default(false),
	alwaysPrepared: z.boolean().default(false),
});

/** Per-slot ASI/feat picks, keyed by slot key (`"<classIndex>:<level>"`, plus `"origin"` for the
 *  background feat's skill grant). Mirrors the builder's draft maps so a level-up can RESTORE the
 *  slots it already filled (shown filled, applied once) instead of re-offering + double-applying them
 *  (UBUG-13). Absent on pre-UBUG-13 saves → slots open blank and boosts stay carried flat (old path). */
const slotPicksSchema = z.object({
	/** slot key → feat ref, or the `__asi__` sentinel for a plain ASI. */
	feats: z.record(z.string(), z.string()).default({}),
	/** slot key → ASI allocation (+2 one, or +1 two). */
	asi: z
		.record(
			z.string(),
			z.object({ shape: z.enum(['2', '1-1']), picks: z.array(z.enum(ABILITIES)) }),
		)
		.default({}),
	/** slot key → the half-feat +1 ability choice (Grappler STR/DEX, Epic Boon any). */
	featAbility: z.record(z.string(), z.enum(ABILITIES)).default({}),
	/** slot key → §C feat skill-grant picks (Skilled). */
	featSkills: z.record(z.string(), z.array(z.string())).default({}),
});

const buildSchema = z.object({
	name: z.string().min(1),
	species: ref.optional(),
	/** Chosen species sub-option (2014 subrace / 2024 lineage), a `species_option` ref. */
	speciesOption: ref.optional(),
	background: ref.optional(),
	/** ≥1 for a built character; empty is allowed mid-creation. */
	classes: z.array(classEntry).default([]),
	abilities: abilityScores,
	/** Proficient skill ids (e.g. "athletics"). */
	skills: z.array(z.string()).default([]),
	/** Skill proficiencies granted by a feat's §C choice-grant (Skilled), kept SEPARATE from `skills`
	 *  (class/background picks) so the builder's class-skill cap counter isn't inflated on edit. Merged
	 *  into skill proficiency at derive, exactly like a class-chosen skill. */
	featSkills: z.array(z.string()).default([]),
	/** Skill ids with **expertise** (double proficiency — Rogue/Bard). Subset of `skills`. */
	expertise: z.array(z.string()).default([]),
	/** Allocated ability boosts (5.5e background / ASIs), applied at the feature layer on top
	 *  of the base `abilities` scores. Kept separate from base so point-buy stays 8–15 and the
	 *  boost keeps its provenance. Species boosts flow through the effects engine, not here.
	 *  Keyed by ability id (partial — only boosted abilities appear). */
	abilityBoosts: z.record(z.string(), z.number().int()).default({}),
	/** Chosen saving-throw proficiencies (usually from class; stored explicitly). */
	saves: z.array(z.enum(ABILITIES)).default([]),
	feats: z.array(ref).default([]),
	/** Per-slot ASI/feat picks so level-up restores filled slots (UBUG-13); see `slotPicksSchema`. */
	slotPicks: slotPicksSchema.default({ feats: {}, asi: {}, featAbility: {}, featSkills: {} }),
	/** Known languages, as `language:source:id` refs. */
	languages: z.array(ref).default([]),
	/** Languages and tools the player simply TYPED — a table's own tongue, a trade the SRD never
	 *  listed. Free text and not refs, because neither interacts with any rule the app computes: a
	 *  language and a tool proficiency are flavour a sheet prints. A row in a pack would be machinery
	 *  for a string, and the day either gains a mechanic is the day it earns one. */
	customLanguages: z.array(z.string()).default([]),
	customTools: z.array(z.string()).default([]),
	inventory: z.array(inventoryEntry).default([]),
	spells: z.array(spellEntry).default([]),
	/** Photo file name (sibling of character.json — NOT base64 in the JSON). */
	photo: z.string().optional(),
	notes: z.string().default(''),
	/** Optional XP (level-up can be milestone instead). */
	xp: z.number().int().min(0).optional(),
});

// --- runtime / play-state -----------------------------------------------------

/** A runtime effect/condition instance: a catalog ref or a custom text effect, with an
 *  optional duration in rounds that a round counter auto-expires. */
const effectInstance = z.object({
	iid: z.string().min(1),
	label: z.string().min(1),
	/** Catalog effect ref, if it came from one. */
	source: ref.optional(),
	/** Free text for unknown/custom effects (inert display). */
	text: z.string().optional(),
	/** Bounded-vocab tokens the effects engine interprets (optional). */
	effects: z.array(z.string()).default([]),
	positive: z.boolean().default(false),
	/** Absent = indefinite; else expires after N rounds from `startedRound`. */
	durationRounds: z.number().int().min(0).optional(),
	startedRound: z.number().int().min(0).optional(),
});

/** What killed the character. An OPEN enum — a new lethal rule (drowning, a homebrew doom clock) is a
 *  member, never another boolean on play-state. AGENTS.md ▸ Taste (open enums, never booleans) */
const DEATH_CAUSES = ['massive_damage', 'death_saves', 'exhaustion'] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

const playSchema = z.object({
	hp: z.object({
		current: z.number().int(),
		/** Manual max override; absent → derived from build. */
		max: z.number().int().optional(),
		temp: z.number().int().min(0).default(0),
	}),
	/** Hit dice spent since the last long rest (keyed by die, e.g. "d10"). */
	hitDiceSpent: z.record(z.string(), z.number().int().min(0)).default({}),
	/** Spell slots spent, keyed by slot level "1".."9" (+ "pact" for warlock). */
	spellSlotsSpent: z.record(z.string(), z.number().int().min(0)).default({}),
	/** Class/feature resource uses spent, keyed by resource id (rage, ki…). */
	resourcesSpent: z.record(z.string(), z.number().int().min(0)).default({}),
	/** The purse, keyed by coin id (`cp`…`pp`). Play-state, not an inventory row: money is spent and
	 *  earned every session and answers a different question than a stack of arrows
	 *  (`rules/currency.ts`). Absent key = none of that coin. */
	currency: z.record(z.string(), z.number().int().min(0)).default({}),
	effects: z.array(effectInstance).default([]),
	/** Spell ref currently concentrated on, or null. */
	concentration: ref.nullable().default(null),
	/** Effects-auto engine on. Off → derived stats drop their effect layers (flat bonuses,
	 *  advantage, conditions) and show base values only (docs/plan.md effects global toggle). */
	autoCalc: z.boolean().default(true),
	deathSaves: z
		.object({ successes: z.number().int().min(0).max(3), failures: z.number().int().min(0).max(3) })
		.default({ successes: 0, failures: 0 }),
	/** The character is DEAD, and what killed them (null = alive). One object rather than a bare
	 *  `dead` boolean + a sibling cause, so the state can't disagree with itself; `cause` is an OPEN
	 *  enum — a new lethal rule is a member, not another flag. Cleared only by `revive()` (a revival
	 *  effect), never by healing: RAW, hit points don't un-kill you. */
	death: z
		.object({ cause: z.enum(DEATH_CAUSES) })
		.nullable()
		.default(null),
	/** Exhaustion level. The real ceiling is DATA (the exhaustion condition row's `max_level`, 6 in
	 *  both editions) and the stepper clamps to it; this is only a generous sanity bound so a homebrew
	 *  ladder taller than 6 still validates (D19). The stepper clamps to `EXHAUSTION_MAX` as well —
	 *  above it a character validates nowhere and every later save throws, silently. */
	exhaustion: z.number().int().min(0).max(EXHAUSTION_MAX).default(0),
	/** Whether the action-economy is being tracked. Off → no turnbar, no action/bonus/reaction
	 *  enforcement (rolls always go through); on → attacks/spells spend their slot and are blocked
	 *  when the slot is exhausted. */
	inCombat: z.boolean().default(false),
	/** Combat round counter (drives effect expiry). */
	round: z.number().int().min(0).default(0),
	/** Action-economy for the current turn: pips SPENT of each slot (base max 1 until a feature
	 *  grants extras), and feet of movement used. `Next turn` resets these + advances `round`. */
	turn: z
		.object({
			action: z.number().int().min(0).default(0),
			bonus: z.number().int().min(0).default(0),
			reaction: z.number().int().min(0).default(0),
			move: z.number().int().min(0).default(0),
			/** Additional actions granted for THIS turn only (Action Surge) — they raise the max, they
			 *  do not un-spend what was used. A one-turn fact rather than an effect, so it survives with
			 *  effects-auto off and dies with the turn. Absent on saves written before it existed → 0. */
			grantedActions: z.number().int().min(0).default(0),
			/** Strikes made inside the Attack action this turn. Extra Attack buys several strikes for one
			 *  Action, so the slot is charged on every `attacksPerAction`-th strike rather than on each
			 *  one. Absent on saves written before it existed → 0. */
			attacksMade: z.number().int().min(0).default(0),
			/** Feature rollables the player has marked as USED this turn (Sneak Attack's once-per-turn).
			 *  Marked by hand, never by rolling: most granted rolls have no per-turn limit, and a marker
			 *  that appeared on its own would invent one. Turn-scoped, so `Next turn` clears it. */
			usedRolls: z.array(z.string()).default([]),
		})
		.default({
			action: 0,
			bonus: 0,
			reaction: 0,
			move: 0,
			grantedActions: 0,
			attacksMade: 0,
			usedRolls: [],
		}),
});

// --- ui / per-character view preferences --------------------------------------

/** Short-rest healing model (per-character rules variant): `dice` = RAW Hit-Dice spend, `half` = the
 *  ½-max-HP video-game/house variant. An OPEN enum — a new model is a member, not a boolean. */
export const SHORT_REST_MODES = ['dice', 'half'] as const;
export type ShortRestMode = (typeof SHORT_REST_MODES)[number];

/** Per-character sheet preferences (not build, not play — resetting play keeps these). */
const uiSchema = z
	.object({
		/** Combat-sheet panel layout: one array of panel ids per column (left, right). */
		panelColumns: z.array(z.array(z.string())).optional(),
		/** A player's own order for the rows INSIDE a panel, keyed by panel id. Only the panels whose
		 *  rows are derived need it — the inventory's order is its own array. Reconciled against the
		 *  rows that exist on every read (`combat/row-order.ts`). */
		rowOrder: z.record(z.string(), z.array(z.string())).default({}),
		/** Build/edit mode for THIS character: Strict enforces its system's rules, Free lifts them.
		 *  Stored per character (not a global setting), Strict by default. */
		strict: z.boolean().default(true),
		/** Spells the user hid from the combat sheet via the spellbook's eye toggle (effectiveIds,
		 *  `source:id`). Additive: absent → shown. The combat spell list filters these out. */
		spellsHidden: z.array(z.string()).default([]),
		/** Spells pinned to the top of the combat spell list, by full ref (`spell:source:id`) — the same
		 *  identity `spellsHidden` uses, so the star and the eye agree about what a spell is (D3). A save
		 *  written with bare ids simply pins nothing until the star is tapped again. */
		spellsPinned: z.array(z.string()).default([]),
		/** Which skills show in the passive-senses row (Pin skills). Absent → the default trio
		 *  (Perception / Investigation / Insight). Stored per character, not a global. */
		passiveSkills: z.array(z.string()).optional(),
		/** Short-rest healing model (a per-character rules variant). `dice` = RAW (spend Hit Dice via
		 *  the short-rest popover); `half` = the popular non-book variant (heal ½ max HP, no dice — the
		 *  Baldur's Gate 3 model). Default `dice` (ship SRD-faithful); old saves without it migrate there. */
		shortRestMode: z.enum(SHORT_REST_MODES).default('dice'),
		/** Coin denominations this character does not use, hidden from the purse (electrum is why this
		 *  exists). A view preference, so hiding a coin never touches what is in it. */
		coinsHidden: z.array(z.string()).default([]),
		/** Does this character's carried weight count their coins (50 to the pound)? A per-character
		 *  rules variant like `shortRestMode`, OFF by default: most tables do not weigh money, and a
		 *  purse that silently encumbers you is a rule nobody asked for. */
		coinWeight: z.boolean().default(false),
	})
	.default({
		strict: true,
		spellsHidden: [],
		spellsPinned: [],
		shortRestMode: 'dice',
		coinsHidden: [],
		coinWeight: false,
		rowOrder: {},
	});

// --- character ----------------------------------------------------------------

export const characterSchema = z.object({
	schemaVersion: z.number().int().default(CHARACTER_SCHEMA_VERSION),
	id: slug,
	system: z.enum(SYSTEMS),
	build: buildSchema,
	play: playSchema,
	ui: uiSchema,
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterPlay = z.infer<typeof playSchema>;
export type CharacterUi = z.infer<typeof uiSchema>;
export type EffectInstance = z.infer<typeof effectInstance>;

/** A fresh, valid character bound to a system. Abilities default to 10 (unset). */
export function newCharacter(
	id: string,
	name: string,
	system: (typeof SYSTEMS)[number],
): Character {
	return characterSchema.parse({
		schemaVersion: CHARACTER_SCHEMA_VERSION,
		id,
		system,
		build: {
			name,
			abilities: Object.fromEntries(ABILITIES.map((a) => [a, 10])),
		},
		play: { hp: { current: 0, temp: 0 } },
	});
}

/** Validate a raw parsed character (post-migration). Returns zod's SafeParseReturn. */
export function parseCharacter(data: unknown) {
	return characterSchema.safeParse(data);
}
