/*
 * The character model (`characters/<slug>/character.json`).
 *
 * Two hard separations, per docs/PLAN.md:
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

const abilityScores = z.object(
	Object.fromEntries(ABILITIES.map((a) => [a, z.number().int().min(1).max(30)])) as Record<
		(typeof ABILITIES)[number],
		z.ZodNumber
	>
);

// --- build / definition -------------------------------------------------------

const classEntry = z.object({
	class: ref,
	level: z.number().int().min(1).max(20),
	subclass: ref.optional()
});

const inventoryEntry = z.object({
	item: ref,
	qty: z.number().int().min(1).default(1),
	equipped: z.boolean().default(false),
	attuned: z.boolean().default(false)
});

const spellEntry = z.object({
	spell: ref,
	/** Prepared casters toggle this; always-prepared (domain/feat) can't be unset. */
	prepared: z.boolean().default(false),
	alwaysPrepared: z.boolean().default(false)
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
	/** Known languages, as `language:source:id` refs. */
	languages: z.array(ref).default([]),
	inventory: z.array(inventoryEntry).default([]),
	spells: z.array(spellEntry).default([]),
	/** Photo file name (sibling of character.json — NOT base64 in the JSON). */
	photo: z.string().optional(),
	notes: z.string().default(''),
	/** Optional XP (level-up can be milestone instead). */
	xp: z.number().int().min(0).optional()
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
	startedRound: z.number().int().min(0).optional()
});

const playSchema = z.object({
	hp: z.object({
		current: z.number().int(),
		/** Manual max override; absent → derived from build. */
		max: z.number().int().optional(),
		temp: z.number().int().min(0).default(0)
	}),
	/** Hit dice spent since the last long rest (keyed by die, e.g. "d10"). */
	hitDiceSpent: z.record(z.string(), z.number().int().min(0)).default({}),
	/** Spell slots spent, keyed by slot level "1".."9" (+ "pact" for warlock). */
	spellSlotsSpent: z.record(z.string(), z.number().int().min(0)).default({}),
	/** Class/feature resource uses spent, keyed by resource id (rage, ki…). */
	resourcesSpent: z.record(z.string(), z.number().int().min(0)).default({}),
	effects: z.array(effectInstance).default([]),
	/** Spell ref currently concentrated on, or null. */
	concentration: ref.nullable().default(null),
	inspiration: z.boolean().default(false),
	/** Shield raised (don/doff in one tap) → +2 AC live. The single source of truth for the
	 *  shield's AC contribution (not the inventory equipped flag). */
	shieldRaised: z.boolean().default(false),
	/** Effects-auto engine on. Off → derived stats drop their effect layers (flat bonuses,
	 *  advantage, conditions) and show base values only (docs/PLAN.md effects global toggle). */
	autoCalc: z.boolean().default(true),
	deathSaves: z
		.object({ successes: z.number().int().min(0).max(3), failures: z.number().int().min(0).max(3) })
		.default({ successes: 0, failures: 0 }),
	exhaustion: z.number().int().min(0).max(6).default(0),
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
			move: z.number().int().min(0).default(0)
		})
		.default({ action: 0, bonus: 0, reaction: 0, move: 0 })
});

// --- ui / per-character view preferences --------------------------------------

/** Per-character sheet preferences (not build, not play — resetting play keeps these). */
const uiSchema = z
	.object({
		/** Combat-sheet panel layout: one array of panel ids per column (left, right). */
		panelColumns: z.array(z.array(z.string())).optional(),
		/** Build/edit mode for THIS character: Strict enforces its system's rules, Free lifts them.
		 *  Stored per character (not a global setting), Strict by default. */
		strict: z.boolean().default(true),
		/** Spells the user hid from the combat sheet via the spellbook's eye toggle (effectiveIds,
		 *  `source:id`). Additive: absent → shown. The combat spell list filters these out. */
		spellsHidden: z.array(z.string()).default([]),
		/** Which skills show in the passive-senses row (Pin skills). Absent → the default trio
		 *  (Perception / Investigation / Insight). Stored per character, not a global. */
		passiveSkills: z.array(z.string()).optional()
	})
	.default({ strict: true, spellsHidden: [] });

// --- character ----------------------------------------------------------------

export const characterSchema = z.object({
	schemaVersion: z.number().int().default(CHARACTER_SCHEMA_VERSION),
	id: slug,
	system: z.enum(SYSTEMS),
	build: buildSchema,
	play: playSchema,
	ui: uiSchema
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterPlay = z.infer<typeof playSchema>;
export type CharacterUi = z.infer<typeof uiSchema>;
export type EffectInstance = z.infer<typeof effectInstance>;

/** A fresh, valid character bound to a system. Abilities default to 10 (unset). */
export function newCharacter(
	id: string,
	name: string,
	system: (typeof SYSTEMS)[number]
): Character {
	return characterSchema.parse({
		schemaVersion: CHARACTER_SCHEMA_VERSION,
		id,
		system,
		build: {
			name,
			abilities: Object.fromEntries(ABILITIES.map((a) => [a, 10]))
		},
		play: { hp: { current: 0, temp: 0 } }
	});
}

/** Validate a raw parsed character (post-migration). Returns zod's SafeParseReturn. */
export function parseCharacter(data: unknown) {
	return characterSchema.safeParse(data);
}
