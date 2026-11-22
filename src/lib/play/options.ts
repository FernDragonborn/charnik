/*
 * The verbs a feature's spend-option runs once `option-activation.ts` has checked and paid for it
 * ALL-OR-NOTHING (docs/internals/actions.md §2). Each verb lands on an action that already exists —
 * no verb opens a path of its own into play-state.
 *
 * Two verbs cannot finish here, and say so in `asks`: a strike is a roll the host makes through its
 * own dice path, and assuming a form needs to know WHICH stat block before anything is paid.
 */
import { LOG_KIND } from '$lib/character/log-kind';
import { rollFormula } from '$lib/rules/dice';
import { effectiveHpMax } from '$lib/rules/core';
import { MAX_SLOT_LEVEL, PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { isResolvedFormula, ROLL_TO_CONFIRM_SPEND } from '$lib/effects/action-token';
import type { ActionSlot } from '$lib/combat/roll';
import { addableStateRows, isConditionRow, isHarmful } from '$lib/content/states';
import { localizedName } from '$lib/content/detail';
import type { Character } from '$lib/character/schema';
import type { ResourceOption } from '$lib/character/derive';
import { addEffect, endEffects } from './effects';
import { PLAY_REQUEST, chain, quietly, type PlayContext, type PlayOutcome } from './outcome';
import {
	gainSlot,
	regainResource,
	restoreResource,
	spendResource,
	type OptionSpend,
} from './resources';
import { rest } from './rests';
import { settled } from './settle';

/** A resource-option's `action_type` → the turn slot it consumes (`free` = none). */
export const ACTION_TYPE_SLOT: Record<ResourceOption['actionType'], ActionSlot | null> = {
	action: 'action',
	bonus_action: 'bonus',
	reaction: 'reaction',
	free: null,
};

export const OPTION_SPENDS_SLOT = 'spend_slot';

export const VERB = {
	note: 'note',
	assumeForm: 'assume_form',
	spendResource: 'spend_resource',
	spendSlot: OPTION_SPENDS_SLOT,
	recoverPact: 'recover_pact_slots',
	pickAttack: 'attack_pick',
} as const;

export const HALF_ROUNDED_UP = 'half_up';

export function pactRecovery(character: Character, sheet: ReturnType<PlayContext['derive']>) {
	const pact = sheet.spellcasting.pools.find((pool) => pool.forcedUpcast);
	const spent = Math.min(pact?.max ?? 0, character.play.spellSlotsSpent[PACT_SLOT_KEY] ?? 0);
	return {
		spent,
		count: Math.min(spent, Math.ceil((pact?.max ?? 0) / 2)),
		level: pact?.spellLevel,
	};
}

/** How many strikes one action may ask for. RAW's largest is a handful; the cap is against a content
 *  typo (`attack:dagger:200`) turning one press into two hundred log lines. */
const MAX_ATTACKS_PER_ACTION = 12;

/** What an option takes from its pool this time (`x` priced at the amount picked), and what it says
 *  it does — a `note:` action IS that, in the row's own words. */
export const optionSpend = (option: ResourceOption, amount = 1): OptionSpend => ({
	resource: option.resourceId,
	cost: option.cost === 'x' ? amount : option.cost,
	name: option.name,
	says: option.action.startsWith(`${VERB.note}:`)
		? option.action.slice(VERB.note.length + 1)
		: option.description,
});

/** The verbs of an action, in order: `a;b;c` is one activation running each. */
export const verbsOf = (action: string): { verb: string; arg: string }[] =>
	action
		.split(';')
		.map((token) => token.trim())
		.filter(Boolean)
		.map((token) => {
			const sep = token.indexOf(':');
			return sep === -1
				? { verb: token, arg: '' }
				: { verb: token.slice(0, sep), arg: token.slice(sep + 1) };
		});

/** `<id>[:<n>]` — an id and a count that defaults to one. */
export function idAndCount(arg: string): { id: string; count: number } {
	const sep = arg.lastIndexOf(':');
	const counted = sep > 0 && /^\d+$/.test(arg.slice(sep + 1));
	return {
		id: (counted ? arg.slice(0, sep) : arg).trim(),
		count: Math.max(1, counted ? Number(arg.slice(sep + 1)) : 1),
	};
}

/** What running an action is told besides its verbs. */
export interface ActionRun {
	/** What the action is called — the feature, in the log and the notices. */
	name: string;
	action: string;
	/** Rounds an effect lasts when neither the verb nor its row states a length. */
	effectRounds: number;
	/** How many uses an `x` cost was answered with — what a verb written per use multiplies by. */
	amount?: number;
	reaction?: boolean;
}

/** `<n>` or `<n>*x`: a level stated outright, or so many levels for each use of an `x` cost. */
function slotLevelOf(arg: string, amount: number): number {
	const perUse = /^(\d+)\*x$/.exec(arg.replace(/\s+/g, ''));
	return perUse ? Number(perUse[1]) * amount : Number(arg);
}

/** The one formula a `heal:` may leave to the press: `x`, the amount an `x` cost was answered with
 *  (Lay on Hands: "restore a number of hit points … up to the maximum amount remaining"). */
export const HEAL_ANSWERED = 'x';

type Verb = (character: Character, run: ActionRun, arg: string, ctx: PlayContext) => PlayOutcome;

/** `apply_effect:<id>` — a NAMED catalog state (Rage), read off its row: tokens live by ref, valence,
 *  and its own clock. A named state does not stack — re-entering refreshes it. A missing id is
 *  SAID, never a silent nothing. */
const applyCatalogEffect: Verb = (character, run, arg, ctx) => {
	const row = addableStateRows(ctx.graph, character.system).find(
		(state) => !isConditionRow(state) && state.effectiveId.split(':').pop() === arg,
	);
	if (!row)
		return {
			...quietly(character),
			notices: [
				{
					text: { key: 'combat.notice.effectMissing', values: { name: run.name } },
					description: { key: 'combat.notice.effectMissingBody', values: { id: arg } },
				},
			],
		};
	const ended = endEffects(character, (effect) => effect.source === row.effectiveId, ctx);
	return chain(ended, (next) =>
		next.play.death
			? quietly(next)
			: addEffect(
					next,
					{
						label: localizedName(row, ctx.locale),
						tokens: row.data.effects,
						positive: !isHarmful(row),
						ref: row.effectiveId,
						durationRounds: row.data.duration_rounds ?? run.effectRounds,
					},
					ctx,
				),
	);
};

/**
 * A `heal:` / `roll:` whose formula did not resolve does not run. The derive already raised the
 * issue where content is inspected; this says it where the player pressed, because a press that does
 * nothing reads as the app being broken, and a roll of whatever dice the parser could find in the
 * raw text reads as a result.
 */
export const unresolved = (character: Character, run: ActionRun, formula: string): PlayOutcome => ({
	...quietly(character),
	notices: [
		{
			text: { key: 'combat.notice.actionUnresolved', values: { name: run.name } },
			description: { key: 'combat.notice.actionUnresolvedBody', values: { formula } },
		},
	],
});

/**
 * The verb table — one entry per bounded token in actions.md §2. A verb whose argument is missing
 * or malformed does nothing.
 */
const VERBS: Record<string, Verb> = {
	heal: (character, run, given, ctx) => {
		const arg = given.trim() === HEAL_ANSWERED ? String(run.amount ?? 1) : given;
		if (!arg) return quietly(character);
		if (!isResolvedFormula(arg)) return unresolved(character, run, arg);
		const rolled = rollFormula(arg, ctx.rng);
		const hp = character.play.hp;
		const max = effectiveHpMax(hp.max ?? null, ctx.derive(character).maxHp);
		const current = Math.min(max, hp.current + Math.max(0, rolled.total));
		return settled(
			{
				character: { ...character, play: { ...character.play, hp: { ...hp, current } } },
				log: [
					{
						name: {
							text: `${run.name} — heal`,
							key: 'combat.log.heal',
							values: { name: run.name },
						},
						rolled,
					},
				],
				notices: [],
			},
			ctx,
		);
	},
	// Temporary Hit Points do not stack: the new amount replaces the old only when it is higher (SRD 5.1
	// and 5.2.1 alike), so a Heroism tick never lowers what a Fiendish Vigor gave
	temp_hp: (character, run, arg, ctx) => {
		if (!arg) return quietly(character);
		if (!isResolvedFormula(arg)) return unresolved(character, run, arg);
		const rolled = rollFormula(arg, ctx.rng);
		const hp = character.play.hp;
		if (rolled.total <= hp.temp) return quietly(character);
		return settled(
			{
				character: {
					...character,
					play: { ...character.play, hp: { ...hp, temp: rolled.total } },
				},
				log: [],
				notices: [],
			},
			ctx,
		);
	},
	roll: (character, run, arg, ctx) => {
		if (!arg) return quietly(character);
		if (!isResolvedFormula(arg)) return unresolved(character, run, arg);
		return {
			...quietly(character),
			log: [{ name: { text: run.name }, rolled: rollFormula(arg, ctx.rng) }],
		};
	},
	apply_condition: (character, run, arg, ctx) =>
		arg
			? addEffect(
					character,
					{
						label: run.name,
						tokens: [`apply_condition:${arg}`],
						positive: false,
						durationRounds: run.effectRounds,
					},
					ctx,
				)
			: quietly(character),
	apply_effect: (character, run, arg, ctx) =>
		arg ? applyCatalogEffect(character, run, arg, ctx) : quietly(character),
	// RAW: an ADDITIONAL action — one more pip this turn, never a refund of a spent one, so surging
	// before acting is worth a whole action
	gain_action: (character, _run, _arg, ctx) => {
		const turn = character.play.turn;
		const granted = { ...turn, grantedActions: turn.grantedActions + 1 };
		return settled(quietly({ ...character, play: { ...character.play, turn: granted } }), ctx);
	},
	// a strike is the host's roll: same to-hit, magic bonus and scoped effects as a tap on the weapon
	attack: (character, run, arg) => {
		if (!arg) return quietly(character);
		const { id, count } = idAndCount(arg);
		const strikes = Math.min(count, MAX_ATTACKS_PER_ACTION);
		return {
			...quietly(character),
			asks: [
				{
					kind: PLAY_REQUEST.attack,
					weapon: id.toLowerCase(),
					count: strikes,
					name: run.name,
					...(run.reaction ? { reaction: true } : {}),
				},
			],
		};
	},
	// `<id>` regains every use; `<id>:<n>` gives that many back and no more
	restore_resource: (character, _run, arg, ctx) => {
		if (!arg) return quietly(character);
		const counted = /^(.+):(\d+)$/.exec(arg);
		return counted
			? regainResource(character, { id: (counted[1] ?? '').trim(), count: Number(counted[2]) }, ctx)
			: restoreResource(character, { id: arg }, ctx);
	},
	// the slot was chosen and paid before any verb ran, with everything else the option costs
	[VERB.spendSlot]: (character) => quietly(character),
	[ROLL_TO_CONFIRM_SPEND]: (character) => quietly(character),
	[VERB.recoverPact]: (character, run, arg, ctx) => {
		if (arg !== HALF_ROUNDED_UP) return unresolved(character, run, arg);
		const { spent, count, level } = pactRecovery(character, ctx.derive(character));
		if (!count || level === undefined) return quietly(character);
		const spellSlotsSpent = { ...character.play.spellSlotsSpent, [PACT_SLOT_KEY]: spent - count };
		return settled(
			{
				...quietly({ ...character, play: { ...character.play, spellSlotsSpent } }),
				notices: [
					{
						text: { key: 'combat.notice.slotRestored', values: { count, level } },
						kind: LOG_KIND.slot,
					},
				],
			},
			ctx,
		);
	},
	// affordability was settled before the option paid for anything
	[VERB.spendResource]: (character, _run, arg, ctx) =>
		arg ? spendResource(character, idAndCount(arg), ctx) : quietly(character),
	gain_slot: (character, run, arg, ctx) => {
		const level = slotLevelOf(arg, run.amount ?? 1);
		return Number.isInteger(level) && level >= 1 && level <= MAX_SLOT_LEVEL
			? gainSlot(character, { level }, ctx)
			: quietly(character);
	},
	// the SAME rest the rest buttons take. A consumable that grants one has a recharge the rest does
	// not refill, or the rest it triggers would refund its own charge (actions.md §2)
	rest: (character, run, arg, ctx) =>
		arg === 'short' || arg === 'long'
			? chain(rest(character, { kind: arg }, ctx), (rested) => ({
					...quietly(rested),
					notices: [
						{
							text: {
								key: 'combat.notice.restTakenFor',
								values: { name: run.name, kind: { catalog: 'combat.restKind', id: arg } },
							},
							kind: LOG_KIND.rest,
						},
					],
				}))
			: quietly(character),
};

/** Run an action's RESOLVED verbs in order (a formula in one is already resolved at derive). */
export function runAction(character: Character, run: ActionRun, ctx: PlayContext): PlayOutcome {
	return verbsOf(run.action).reduce<PlayOutcome>(
		(outcome, { verb, arg }) =>
			chain(outcome, (next) => VERBS[verb]?.(next, run, arg, ctx) ?? quietly(next)),
		quietly(character),
	);
}
