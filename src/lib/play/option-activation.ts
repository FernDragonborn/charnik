/*
 * Using a spend-option: everything it costs is checked before anything is paid, every question it
 * has (how much, which form, which slot, whether the roll counts, which attack) is asked before
 * anything is paid, and then it pays and runs its verbs (`options.ts`). Backing out of a question
 * costs nothing: called without the answer it returns the question and the character untouched.
 */
import {
	PACT_SLOT_KEY,
	castablePactLevel,
	castableSlotLevels,
	slotToSpend,
} from '#lib/rules/spellcasting.ts';
import { rollFormula } from '#lib/rules/dice.ts';
import {
	isResolvedFormula,
	resolveActionFormula,
	ROLL_TO_CONFIRM_SPEND,
	ROLL_WITH_SLOT,
} from '#lib/effects/action-token.ts';
import { withCastSlot } from '#lib/effects/context.ts';
import { sheetAttacks } from '#lib/combat/form-attacks.ts';
import { UNARMED_STRIKE_ID } from '#lib/combat/attacks.ts';
import { OPTION_CADENCE } from '#lib/content/schemas.ts';
import type { Character } from '#lib/character/schema.ts';
import type { CharacterSheet, ResourceOption } from '#lib/character/derive.ts';
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
	resourceLeft,
	resourceName,
	spendOnOption,
	type OptionSpend,
} from './resources';
import { canSpendTurnSlot, markRollUsed, spendTurnSlot } from './turn';
import {
	ACTION_TYPE_SLOT,
	HALF_ROUNDED_UP,
	VERB,
	idAndCount,
	optionSpend,
	pactRecovery,
	runAction,
	unresolved,
	verbsOf,
} from './options';

/** One verb of an option's action, as `verbsOf` splits it. */
type VerbCall = ReturnType<typeof verbsOf>[number];

/** An option being used: which one, how much of an `x` cost (asked for when it is not given), and — for one that assumes a form —
 *  the stat block chosen, with the name its effect is shown under; for one paid with a spell slot,
 *  the level of the slot given up. */
export interface OptionUse {
	option: ResourceOption;
	amount?: number;
	form?: { monster: string; label: string };
	slot?: number;
	confirmed?: boolean;
	attack?: string;
	effectRounds: number;
}

/** The lowest level a slot has: any slot will pay for an option that asks for one. */
const ANY_SLOT_LEVEL = 1;

/** What one use is checked and asked against. */
interface Activation {
	character: Character;
	sheet: CharacterSheet;
	use: OptionUse;
	verbs: VerbCall[];
	ctx: PlayContext;
}

/** A stop before anything is paid: a refusal, a question, or a roll shown for the player to judge. */
type Halt = { halt: PlayOutcome };

const halted = (value: object): value is Halt => 'halt' in value;

const refusal = (character: Character, notice: PlayNotice): PlayOutcome => ({
	...quietly(character),
	refused: true,
	notices: [notice],
});

const asking = (character: Character, ask: NonNullable<PlayOutcome['asks']>[number]): Halt => ({
	halt: { ...quietly(character), asks: [ask] },
});

/** The `available` guard is a RULE, not a greyed row: every caller passes through here. */
function isOpen({ option }: OptionUse, character: Character): boolean {
	const usedThisTurn =
		option.cadence === OPTION_CADENCE.turn &&
		character.play.inCombat &&
		character.play.turn.usedRolls.includes(option.id);
	return option.available && !usedThisTurn;
}

/** What stops the use before any question: a verb this app cannot run, a pool short of what the
 *  option and its verbs spend, a turn slot already used. */
function whatBlocks(a: Activation, spend: OptionSpend): PlayNotice | null {
	const { character, sheet, use, verbs } = a;
	const { option } = use;
	const recoverPact = verbs.find(({ verb }) => verb === VERB.recoverPact);
	if (recoverPact && recoverPact.arg !== HALF_ROUNDED_UP)
		return { text: { key: 'combat.notice.actionUnresolved', values: { name: option.name } } };
	if (recoverPact && !pactRecovery(character, sheet).count)
		return { text: { key: 'combat.notice.pactRecoveryUnavailable' } };
	const further = verbs
		.filter(({ verb, arg }) => verb === VERB.spendResource && !!arg)
		.map(({ arg }) => idAndCount(arg))
		.map(({ id, count }) => ({ resource: id, cost: count }));
	const short = [spend, ...further].find((cost) => !canAfford(character, sheet, cost));
	if (short)
		return {
			text: {
				key: 'combat.notice.notEnoughResource',
				values: { resource: resourceName(sheet, short.resource), name: option.name },
			},
			description: { key: 'combat.notice.restToRecharge' },
		};
	const slot = ACTION_TYPE_SLOT[option.actionType];
	if (slot && !canSpendTurnSlot(character, sheet, slot))
		return {
			text: {
				key: 'combat.notice.noSlotLeft',
				values: { slot: { catalog: 'combat.slot', id: slot } },
			},
			description: { key: 'combat.notice.nextTurnToRefresh' },
		};
	return null;
}

/** The spell slot a `spend_slot` option is paid with: asked for when more than one level has one
 *  left, and the level it rolls at. None for an option that spends no slot. */
function slotPaid(a: Activation): Halt | { key: string; level: number } | null {
	const { character, sheet, use, verbs } = a;
	if (!verbs.some(({ verb }) => verb === VERB.spendSlot)) return null;
	const { pools } = sheet.spellcasting;
	const spentSlots = character.play.spellSlotsSpent;
	const levels = castableSlotLevels(ANY_SLOT_LEVEL, pools, spentSlots);
	const pactLevel = castablePactLevel(ANY_SLOT_LEVEL, pools, spentSlots);
	const distinctPact = pactLevel !== null && !levels.includes(pactLevel);
	const offered = distinctPact ? [...levels, pactLevel].sort((x, y) => x - y) : levels;
	if (offered.length > 1 && use.slot === undefined)
		return asking(character, { kind: PLAY_REQUEST.slot, levels: offered });
	const reserved =
		distinctPact && use.slot === pactLevel
			? { key: PACT_SLOT_KEY }
			: slotToSpend(ANY_SLOT_LEVEL, pools, spentSlots, use.slot);
	if (!reserved || 'block' in reserved)
		return {
			halt: refusal(character, {
				text: { key: 'combat.notice.noSpellSlot', values: { name: use.option.name } },
				description: { key: 'combat.notice.restToRecharge' },
			}),
		};
	const level =
		reserved.key === PACT_SLOT_KEY
			? (pools.find((pool) => pool.forcedUpcast)?.spellLevel ?? 0)
			: Number(reserved.key);
	return { key: reserved.key, level };
}

/** A formula that did not resolve does not run, and says so where the player pressed. */
const unresolvedHalt = (a: Activation, formula: string): Halt => ({
	halt: {
		...unresolved(a.character, { ...a.use.option, effectRounds: a.use.effectRounds }, formula),
		refused: true,
	},
});

/** `roll_slot:` resolved at the slot's level: the dice a Divine Smite rolls follow the slot spent. */
function withSlotRolls(a: Activation, action: string, level: number): Halt | { action: string } {
	if (!a.verbs.some(({ verb }) => verb === ROLL_WITH_SLOT)) return { action };
	const castCtx = a.sheet.castCtx;
	const slotCtx = level > 0 && castCtx ? withCastSlot(castCtx, level, 0) : undefined;
	const resolved: string[] = [];
	for (const { verb, arg } of a.verbs) {
		if (verb !== ROLL_WITH_SLOT) {
			resolved.push(arg ? `${verb}:${arg}` : verb);
			continue;
		}
		const roll = slotCtx
			? resolveActionFormula(`roll:${arg}`, slotCtx, a.use.option.name, undefined)
			: '';
		if (!roll || !isResolvedFormula(roll.slice('roll:'.length))) return unresolvedHalt(a, arg);
		resolved.push(roll);
	}
	return { action: resolved.join(';') };
}

/** A roll that is spent only if it turns the check (Tactical Mind): rolled first and shown, paid
 *  when the player confirms. */
function trialFirst(a: Activation): Halt | null {
	const trial = a.verbs.find(({ verb }) => verb === ROLL_TO_CONFIRM_SPEND);
	if (!trial) return null;
	if (!isResolvedFormula(trial.arg)) return unresolvedHalt(a, trial.arg);
	if (a.use.confirmed) return null;
	const rolled = rollFormula(trial.arg, a.ctx.rng);
	return {
		halt: {
			...quietly(a.character),
			log: [{ name: { text: a.use.option.name }, rolled }],
			asks: [{ kind: PLAY_REQUEST.confirmSpend, total: rolled.total }],
		},
	};
}

/** `attack_pick:` answered with the attack the player chose, from the ones its scope allows. */
function withAttackPicked(a: Activation, action: string): Halt | { action: string } {
	const attack = a.verbs.find(({ verb }) => verb === VERB.pickAttack);
	if (!attack) return { action };
	const { character, sheet, ctx, use } = a;
	const available = sheetAttacks(character, sheet, ctx.graph, ctx.locale).filter(
		({ id, scopes }) =>
			attack.arg === 'any' ||
			(attack.arg === 'weapon' ? id !== UNARMED_STRIKE_ID : scopes.includes(attack.arg)),
	);
	const choices = [...new Map(available.map((entry) => [entry.id, entry])).values()];
	if (choices.length && use.attack === undefined)
		return asking(character, { kind: PLAY_REQUEST.pickAttack, choices });
	const chosen = choices.find((entry) => entry.id === use.attack);
	if (!chosen)
		return {
			halt: refusal(character, {
				text: { key: 'combat.notice.nothingToAttack', values: { name: use.option.name } },
			}),
		};
	return {
		action: action
			.split(';')
			.map((token) => (token.startsWith(`${VERB.pickAttack}:`) ? `attack:${chosen.id}` : token))
			.join(';'),
	};
}

/** Pay everything at once — the turn slot, the pools, the spell slot — then run the verbs. */
function payAndRun(
	a: Activation,
	paying: { spend: OptionSpend; spellSlot: string | null; action: string; amount: number },
): PlayOutcome {
	const { use, ctx } = a;
	const { option } = use;
	const turnSlot = ACTION_TYPE_SLOT[option.actionType];
	const { spellSlot } = paying;
	const paid = chain(
		chain(
			turnSlot ? spendTurnSlot(a.character, { slot: turnSlot }, ctx) : quietly(a.character),
			(charged) => spendOnOption(charged, paying.spend, ctx),
		),
		(charged) => {
			if (spellSlot === null) return quietly(charged);
			const spent = charged.play.spellSlotsSpent;
			const spellSlotsSpent = { ...spent, [spellSlot]: (spent[spellSlot] ?? 0) + 1 };
			return quietly({ ...charged, play: { ...charged.play, spellSlotsSpent } });
		},
	);
	const form = formOf(a.verbs);
	if (form && use.form) {
		const chosen = use.form;
		return chain(paid, (payer) => assumeForm(payer, { form, ...chosen }, ctx));
	}
	const run = {
		name: option.name,
		action: paying.action,
		effectRounds: use.effectRounds,
		amount: paying.amount,
		reaction: turnSlot === 'reaction',
	};
	return chain(paid, (payer) =>
		chain(runAction(payer, run, ctx), (next) =>
			option.cadence === OPTION_CADENCE.turn
				? markRollUsed(next, { id: option.id })
				: quietly(next),
		),
	);
}

const formOf = (verbs: VerbCall[]): string | undefined =>
	verbs.find(({ verb, arg }) => verb === VERB.assumeForm && !!arg)?.arg.trim();

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
	if (!isOpen(use, character))
		return refusal(character, {
			text: { key: 'combat.notice.notAvailable', values: { name: option.name } },
		});
	const sheet = ctx.derive(character);
	// a cost of `x` is the player's to say, up to what the pool has left: asked before anything
	// else, since every later check is of the amount answered
	const left = resourceLeft(character, sheet, option.resourceId);
	if (option.cost === 'x' && use.amount === undefined && left >= 1)
		return asking(character, { kind: PLAY_REQUEST.amount, max: left }).halt;
	const amount = use.amount ?? 1;
	const spend = optionSpend(option, amount);
	const a: Activation = { character, sheet, use, verbs: verbsOf(option.action), ctx };
	const blocked = whatBlocks(a, spend);
	if (blocked) return refusal(character, blocked);
	const form = formOf(a.verbs);
	if (form && !use.form) return asking(character, { kind: PLAY_REQUEST.form, form }).halt;
	const slot = slotPaid(a);
	if (slot && halted(slot)) return slot.halt;
	const rolled = withSlotRolls(a, option.action, slot?.level ?? 0);
	if (halted(rolled)) return rolled.halt;
	const trial = trialFirst(a);
	if (trial) return trial.halt;
	const picked = withAttackPicked(a, rolled.action);
	if (halted(picked)) return picked.halt;
	return payAndRun(a, { spend, spellSlot: slot?.key ?? null, action: picked.action, amount });
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
