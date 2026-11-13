/*
 * What another app at the table may tell this one, as schemas with a ceiling on everything.
 *
 * Every peer is taken to be a modified build, so nothing a peer sent reaches a view-model as the
 * type it claims to be: it is parsed here first, and what does not parse is dropped whole. The
 * character schema will not do — it validates the user's own file, where a 20 MB note is theirs to
 * keep — so these are separate shapes, each string and list bounded, each number finite.
 *
 * `tableViewSchema` is ALSO the definition of what a player's app sends (`view.ts` builds one), so
 * the sheet a GM is shown and the sheet a player publishes are one shape with one owner.
 */
import { z } from 'zod';
import { ABILITY_IDS } from '$lib/rules/core';
import { ADVANTAGE_MODE } from '$lib/rules/dice';
import { LAYERS, OPS, SYSTEMS } from '$lib/rules/pipeline';
import { AUTO_OUTCOME } from '$lib/combat/roll';
import { EXHAUSTION_MAX } from '$lib/character/schema';
import {
	CLOSE_REASON,
	CONNECTION,
	REQUESTED_ROLL,
	TABLE_ANSWER,
	TABLE_EVENT,
	TABLE_REQUEST,
} from './types';

/** The ceilings a player's own free text is cut to before it leaves (`view.ts`), so a long name
 *  shortens on the GM's screen instead of costing the player their seat at it. */
export const NAME_MAX = 80;
export const LABEL_MAX = 200;
export const LIST_MAX = 64;
const NOTE_MAX = 400;
const ID_MAX = 64;
const TRACE_MAX = 64;
/** Far past any number the game has, and far short of one that breaks a layout or an addition. */
const NUMBER_MAX = 1_000_000;
const AMOUNT_MAX = 100_000;
const DC_MAX = 99;
const DEATH_SAVE_TRACK = 3;

const bounded = z.number().finite().min(-NUMBER_MAX).max(NUMBER_MAX);
const count = z.number().int().min(0).max(NUMBER_MAX);
const text = (max: number) => z.string().max(max);
/** A content id as the app writes one. */
const id = z
	.string()
	.max(ID_MAX)
	.regex(/^[a-z0-9][a-z0-9_-]*$/);
const ids = z.array(id).max(LIST_MAX);
/** A record keyed by ids, with as many entries as a list may have. */
const byId = <Value extends z.ZodType>(value: Value) =>
	z.record(id, value).refine((record) => Object.keys(record).length <= LIST_MAX);

const params = z.record(text(ID_MAX), z.union([text(LABEL_MAX), bounded]));

const contributionSchema = z.object({
	source: text(LABEL_MAX),
	layer: z.enum(LAYERS),
	op: z.enum(OPS),
	amount: bounded,
	note: text(LABEL_MAX).optional(),
	origin: text(ID_MAX).optional(),
	superseded: z.literal(true).optional(),
	key: text(LABEL_MAX).optional(),
	noteKey: text(LABEL_MAX).optional(),
	params: params.optional(),
});

const noteSchema = z.object({
	text: text(NOTE_MAX),
	key: text(LABEL_MAX).optional(),
	params: params.optional(),
});

/** A value with the trace that explains it — what lets a GM hover a player's number. */
const computedSchema = z.object({
	value: bounded,
	trace: z.array(contributionSchema).max(TRACE_MAX),
	notes: z.array(noteSchema).max(LIST_MAX).optional(),
});

const abilitySchema = z.object({
	score: bounded,
	check: computedSchema,
	save: computedSchema,
	saveProficient: z.boolean(),
});

/**
 * A character as the table sees it: what a GM reads off a sheet across the table, and nothing a
 * player would not say aloud. No notes, no inventory, no build.
 */
export const tableViewSchema = z.object({
	name: text(NAME_MAX),
	system: z.enum(SYSTEMS),
	level: count,
	proficiencyBonus: bounded,
	hp: z.object({ current: count, max: count, temp: count }),
	deathSaves: z.object({
		successes: z.number().int().min(0).max(DEATH_SAVE_TRACK),
		failures: z.number().int().min(0).max(DEATH_SAVE_TRACK),
	}),
	dead: z.boolean(),
	exhaustion: z.number().int().min(0).max(EXHAUSTION_MAX),
	/** The spell concentrated on, as the content ref it was cast from. */
	concentration: text(LABEL_MAX).nullable(),
	/** The conditions in force, as state-row ids — the reader's own catalog names them. */
	conditions: ids,
	/** What else is on the character, as the labels the player's sheet lists them under. */
	effects: z.array(text(LABEL_MAX)).max(LIST_MAX),
	ac: computedSchema,
	initiative: computedSchema,
	speed: computedSchema,
	abilities: z.record(z.enum(ABILITY_IDS), abilitySchema),
	skills: byId(computedSchema),
	passives: byId(computedSchema),
	damageSensitivities: z.object({ resist: ids, immune: ids, vulnerable: ids }),
	conditionImmunities: ids,
});
export type TableView = z.infer<typeof tableViewSchema>;

const amount = z.number().int().min(0).max(AMOUNT_MAX);

export const tableRequestSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal(TABLE_REQUEST.damage), amount, type: id.nullable() }),
	z.strictObject({ kind: z.literal(TABLE_REQUEST.heal), amount }),
	z.strictObject({ kind: z.literal(TABLE_REQUEST.effect), id }),
	z.strictObject({
		kind: z.literal(TABLE_REQUEST.roll),
		roll: z.enum(REQUESTED_ROLL),
		id,
		// Rust sends an absent DC as null
		dc: z
			.number()
			.int()
			.min(0)
			.max(DC_MAX)
			.nullish()
			.transform((dc) => dc ?? undefined),
	}),
]);

/** A roll as it travels back to the GM: what it came to and how, never the sentence around it. */
export const tableRollSchema = z.object({
	total: bounded,
	/** The d20 face that counted; absent when the outcome was forced and nothing was rolled. */
	natural: z.number().int().min(1).max(20).optional(),
	advantage: z.enum(ADVANTAGE_MODE),
	mod: bounded,
	/** A condition decided it — a paralysed character's Dexterity save. */
	outcome: z.enum(AUTO_OUTCOME).optional(),
});
export type TableRoll = z.infer<typeof tableRollSchema>;

const tableAnswerSchema = z.object({
	outcome: z.enum(TABLE_ANSWER),
	roll: tableRollSchema.nullish().transform((roll) => roll ?? undefined),
});

const table = text(ID_MAX).nullable();
const participantId = text(ID_MAX);
const requestId = z
	.string()
	.min(1)
	.max(ID_MAX)
	.regex(/^[A-Za-z0-9-]+$/);

/** Every event Rust pushes, as the page will believe it. */
export const tableEventSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal(TABLE_EVENT.participantJoined),
		table,
		participant: z.object({ id: participantId, name: text(NAME_MAX) }),
	}),
	z.object({ kind: z.literal(TABLE_EVENT.participantLeft), table, participant: participantId }),
	z.object({
		kind: z.literal(TABLE_EVENT.view),
		table,
		participant: participantId,
		view: tableViewSchema,
	}),
	z.object({
		kind: z.literal(TABLE_EVENT.request),
		table,
		requestId,
		request: tableRequestSchema,
	}),
	z.object({
		kind: z.literal(TABLE_EVENT.answer),
		table,
		participant: participantId,
		requestId,
		answer: tableAnswerSchema,
	}),
	z.object({
		kind: z.literal(TABLE_EVENT.connection),
		table,
		state: z.enum(CONNECTION),
		reason: z
			.enum(CLOSE_REASON)
			.nullish()
			.transform((reason) => reason ?? undefined),
	}),
]);
