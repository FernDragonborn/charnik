/*
 * Using a feature's spend-option, as an action: validate the pool, every further spend and the turn
 * slot ALL-OR-NOTHING, pay, then run the option's verbs (docs/internals/actions.md §2). Each verb
 * lands on an action that already exists — no verb opens a path of its own into play-state.
 *
 * Two verbs cannot finish here, and say so in `asks`: a strike is a roll the host makes through its
 * own dice path, and assuming a form needs to know WHICH stat block before anything is paid.
 */
import { rollFormula } from '$lib/rules/dice';
import { effectiveHpMax } from '$lib/rules/core';
import { MAX_SLOT_LEVEL, castableSlotLevels, slotToSpend } from '$lib/rules/spellcasting';
import { isResolvedFormula } from '$lib/effects/action-token';
import type { ActionSlot } from '$lib/combat/roll';
import { addableStateRows, isConditionRow, isHarmful } from '$lib/content/states';
import { localizedName } from '$lib/content/detail';
import type { Character } from '$lib/character/schema';
import type { ResourceOption } from '$lib/character/derive';
import { addEffect } from './effects';
import { assumeForm } from './form-shift';
import {
	PLAY_REQUEST,
	chain,
	quietly,
	type PlayContext,
	type PlayNotice,
	type PlayOutcome,
} from './outcome';
import {
	canAfford,
	gainSlot,
	regainResource,
	resourceLeft,
	resourceName,
	restoreResource,
	spendOnOption,
	spendResource,
	type OptionSpend,
} from './resources';
import { rest } from './rests';
import { settled } from './settle';
import { canSpendTurnSlot, spendTurnSlot } from './turn';

/** A resource-option's `action_type` → the turn slot it consumes (`free` = none). */
const ACTION_TYPE_SLOT: Record<ResourceOption['actionType'], ActionSlot | null> = {
	action: 'action',
	bonus_action: 'bonus',
	reaction: 'reaction',
	free: null,
};

const VERB = {
	note: 'note',
	assumeForm: 'assume_form',
	spendResource: 'spend_resource',
	spendSlot: 'spend_slot',
} as const;

/** The lowest level a slot has: any slot will pay for an option that asks for one. */
const ANY_SLOT_LEVEL = 1;

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
const verbsOf = (action: string): { verb: string; arg: string }[] =>
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
function idAndCount(arg: string): { id: string; count: number } {
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
}

/** `<n>` or `<n>*x`: a level stated outright, or so many levels for each use of an `x` cost. */
function slotLevelOf(arg: string, amount: number): number {
	const perUse = /^(\d+)\*x$/.exec(arg.replace(/\s+/g, ''));
	return perUse ? Number(perUse[1]) * amount : Number(arg);
}

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
	const play = character.play;
	const effects = play.effects.filter((effect) => effect.source !== row.effectiveId);
	return addEffect(
		{ ...character, play: { ...play, effects } },
		{
			label: localizedName(row, ctx.locale),
			tokens: row.data.effects,
			positive: !isHarmful(row),
			ref: row.effectiveId,
			durationRounds: row.data.duration_rounds ?? run.effectRounds,
		},
		ctx,
	);
};

/**
 * A `heal:` / `roll:` whose formula did not resolve does not run. The derive already raised the
 * issue where content is inspected; this says it where the player pressed, because a press that does
 * nothing reads as the app being broken, and a roll of whatever dice the parser could find in the
 * raw text reads as a result.
 */
const unresolved = (character: Character, run: ActionRun, formula: string): PlayOutcome => ({
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
	heal: (character, run, arg, ctx) => {
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
				{ kind: PLAY_REQUEST.attack, weapon: id.toLowerCase(), count: strikes, name: run.name },
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

/** An option being used: which one, how much of an `x` cost (asked for when it is not given), and — for one that assumes a form —
 *  the stat block chosen, with the name its effect is shown under; for one paid with a spell slot,
 *  the level of the slot given up. */
export interface OptionUse {
	option: ResourceOption;
	amount?: number;
	form?: { monster: string; label: string };
	slot?: number;
	effectRounds: number;
}

/**
 * Use a spend-option. Nothing is paid unless everything can be: the option's own window, its pool,
 * every pool its verbs spend from besides, and the turn slot.
 *
 * An option that assumes a form ASKS which one first, and one paid with a spell slot asks which
 * slot when more than one level has one left. Backing out of either question costs nothing: called
 * without the answer it returns the question and the character untouched, and pays when it is
 * called again with it.
 */
export function activateOption(
	character: Character,
	use: OptionUse,
	ctx: PlayContext,
): PlayOutcome {
	const { option } = use;
	const sheet = ctx.derive(character);
	const refuse = (notice: PlayNotice): PlayOutcome => ({
		...quietly(character),
		refused: true,
		notices: [notice],
	});
	// the `available` guard is a RULE, not a greyed row: every caller passes through here
	if (!option.available)
		return refuse({ text: { key: 'combat.notice.notAvailable', values: { name: option.name } } });
	// a cost of `x` is the player's to say, up to what the pool has left: asked before anything
	// else, since every later check is of the amount answered
	const left = resourceLeft(character, sheet, option.resourceId);
	if (option.cost === 'x' && use.amount === undefined && left >= 1)
		return { ...quietly(character), asks: [{ kind: PLAY_REQUEST.amount, max: left }] };
	const amount = use.amount ?? 1;
	const spend = optionSpend(option, amount);
	const verbs = verbsOf(option.action);
	const further = verbs
		.filter(({ verb, arg }) => verb === VERB.spendResource && !!arg)
		.map(({ arg }) => idAndCount(arg))
		.map(({ id, count }) => ({ resource: id, cost: count }));
	const short = [spend, ...further].find((cost) => !canAfford(character, sheet, cost));
	if (short)
		return refuse({
			text: {
				key: 'combat.notice.notEnoughResource',
				values: { resource: resourceName(sheet, short.resource), name: option.name },
			},
			description: { key: 'combat.notice.restToRecharge' },
		});
	const slot = ACTION_TYPE_SLOT[option.actionType];
	if (slot && !canSpendTurnSlot(character, sheet, slot))
		return refuse({
			text: {
				key: 'combat.notice.noSlotLeft',
				values: { slot: { catalog: 'combat.slot', id: slot } },
			},
			description: { key: 'combat.notice.nextTurnToRefresh' },
		});
	const form = verbs.find(({ verb, arg }) => verb === VERB.assumeForm && !!arg)?.arg.trim();
	const chosen = use.form;
	if (form && !chosen) return { ...quietly(character), asks: [{ kind: PLAY_REQUEST.form, form }] };
	let spellSlot: string | null = null;
	if (verbs.some(({ verb }) => verb === VERB.spendSlot)) {
		const { pools } = sheet.spellcasting;
		const spentSlots = character.play.spellSlotsSpent;
		const levels = castableSlotLevels(ANY_SLOT_LEVEL, pools, spentSlots);
		if (levels.length > 1 && use.slot === undefined)
			return { ...quietly(character), asks: [{ kind: PLAY_REQUEST.slot, levels }] };
		const reserved = slotToSpend(ANY_SLOT_LEVEL, pools, spentSlots, use.slot);
		if (!reserved || 'block' in reserved)
			return refuse({
				text: { key: 'combat.notice.noSpellSlot', values: { name: option.name } },
				description: { key: 'combat.notice.restToRecharge' },
			});
		spellSlot = reserved.key;
	}
	const paid = chain(
		chain(slot ? spendTurnSlot(character, { slot }, ctx) : quietly(character), (charged) =>
			spendOnOption(charged, spend, ctx),
		),
		(charged) => {
			if (spellSlot === null) return quietly(charged);
			const spent = charged.play.spellSlotsSpent;
			const spellSlotsSpent = { ...spent, [spellSlot]: (spent[spellSlot] ?? 0) + 1 };
			return quietly({ ...charged, play: { ...charged.play, spellSlotsSpent } });
		},
	);
	if (form && chosen) return chain(paid, (payer) => assumeForm(payer, { form, ...chosen }, ctx));
	return chain(paid, (payer) =>
		runAction(
			payer,
			{ name: option.name, action: option.action, effectRounds: use.effectRounds, amount },
			ctx,
		),
	);
}

/**
 * Use a spend-option named by the identity a row has — its own id on the pool it spends — which is
 * what a caller that is not the sheet has to go on. An option the sheet does not offer is refused.
 */
export function activateOptionById(
	character: Character,
	use: Omit<OptionUse, 'option'> & { option: string; resource: string },
	ctx: PlayContext,
): PlayOutcome {
	const option = ctx
		.derive(character)
		.resourceOptions.find((o) => o.id === use.option && o.resourceId === use.resource);
	return option
		? activateOption(character, { ...use, option }, ctx)
		: { ...quietly(character), refused: true };
}
