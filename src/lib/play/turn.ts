/*
 * The turn as play-state: the action/bonus/reaction pips and what raises them, movement, the round
 * counter that clocks every timed effect, and entering and leaving combat.
 *
 * Out of combat there is no economy: nothing is charged and nothing is refused.
 */
import { LOG_KIND } from '$lib/character/log-kind';
import { pipClick, type ActionSlot } from '$lib/combat/roll';
import { isEffectExpired } from '$lib/combat/effects-view';
import type { Character, CharacterPlay } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { dropEffects } from './concentration';
import { isIncapacitated } from './conditions';
import { quietly, type PlayContext, type PlayNotice, type PlayOutcome } from './outcome';
import { settled } from './settle';

/** A turn with nothing spent yet — what the next turn and entering combat both start from. */
const freshTurn = (): CharacterPlay['turn'] => ({
	action: 0,
	bonus: 0,
	reaction: 0,
	move: 0,
	grantedActions: 0,
	attacksMade: 0,
	usedRolls: [],
});

const withTurn = (character: Character, turn: Partial<CharacterPlay['turn']>): Character => ({
	...character,
	play: { ...character.play, turn: { ...character.play.turn, ...turn } },
});

/**
 * How many pips each slot has this turn: one, plus what standing effects add (Haste → +1 action, a
 * `flat_bonus:<slot>+N` fact) and what was granted for this turn only (Action Surge — play-state, so
 * it counts with effects-auto off). Incapacitated zeroes every slot, overriding both.
 */
export function turnSlotMax(
	character: Character,
	sheet: CharacterSheet,
): Record<ActionSlot, number> {
	if (isIncapacitated(character, sheet)) return { action: 0, bonus: 0, reaction: 0 };
	const max = { action: 1 + character.play.turn.grantedActions, bonus: 1, reaction: 1 };
	if (character.play.autoCalc)
		for (const fact of sheet.facts.numeric)
			if (fact.op === 'add' && fact.amount !== undefined && Object.hasOwn(max, fact.target))
				max[fact.target as keyof typeof max] += fact.amount;
	return max;
}

/** Is a pip of this slot free right now? Out of combat, always; incapacitated, never. */
export function canSpendTurnSlot(
	character: Character,
	sheet: CharacterSheet,
	slot: ActionSlot,
): boolean {
	if (!character.play.inCombat) return true;
	return character.play.turn[slot] < turnSlotMax(character, sheet)[slot];
}

/** Press a turn pip: a free one spends up to it, a spent one restores down to it. */
export function setTurnPip(
	character: Character,
	{ slot, index }: { slot: ActionSlot; index: number },
	ctx: PlayContext,
): PlayOutcome {
	const max = turnSlotMax(character, ctx.derive(character))[slot];
	const spent = pipClick(character.play.turn[slot], index, max);
	return settled(quietly(withTurn(character, { [slot]: spent })), ctx);
}

/** Spend a step of movement, clamped to the speed. */
export function spendMove(
	character: Character,
	{ feet }: { feet: number },
	ctx: PlayContext,
): PlayOutcome {
	const speed = ctx.derive(character).speed.value;
	const move = Math.min(speed, Math.max(0, character.play.turn.move + feet));
	return settled(quietly(withTurn(character, { move })), ctx);
}

export const resetMove = (character: Character, ctx: PlayContext): PlayOutcome =>
	settled(quietly(withTurn(character, { move: 0 })), ctx);

/**
 * In combat, spend one pip of a slot, or refuse when there is none: incapacitated is a hard block
 * with its own sentence (the next turn will not help), an exhausted slot is one the next turn
 * refreshes. Out of combat nothing is charged.
 */
export function spendTurnSlot(
	character: Character,
	{ slot }: { slot: ActionSlot },
	ctx: PlayContext,
): PlayOutcome {
	if (!character.play.inCombat) return quietly(character);
	const sheet = ctx.derive(character);
	const refusal = (notice: PlayNotice): PlayOutcome => ({
		...quietly(character),
		refused: true,
		notices: [notice],
	});
	if (isIncapacitated(character, sheet))
		return refusal({
			text: { key: 'combat.notice.incapacitated' },
			description: { key: 'combat.notice.incapacitatedBody' },
		});
	if (!canSpendTurnSlot(character, sheet, slot))
		return refusal({
			text: {
				key: 'combat.notice.noSlotLeft',
				values: { slot: { catalog: 'combat.slot', id: slot } },
			},
			description: { key: 'combat.notice.nextTurnToRefresh' },
		});
	return settled(quietly(withTurn(character, { [slot]: character.play.turn[slot] + 1 })), ctx);
}

/** Spend the turn cost of ONE weapon strike. Extra Attack buys several strikes with a single
 *  Action, so the Action is charged on the first strike of each group and the rest ride it. */
export function spendStrike(character: Character, ctx: PlayContext): PlayOutcome {
	if (!character.play.inCombat) return quietly(character);
	const perAction = Math.max(1, ctx.derive(character).attacksPerAction.value);
	const opens = character.play.turn.attacksMade % perAction === 0;
	const charged = opens ? spendTurnSlot(character, { slot: 'action' }, ctx) : quietly(character);
	if (charged.refused) return charged;
	const attacksMade = charged.character.play.turn.attacksMade + 1;
	return settled({ ...charged, character: withTurn(charged.character, { attacksMade }) }, ctx);
}

/** Round-timed effects that have run out at the current round go, each with a notice — never
 *  silently — and take the concentration they carried with them. */
function expireTimedEffects(character: Character, ctx: PlayContext): PlayOutcome {
	const play = character.play;
	const expired = play.effects.filter((effect) => isEffectExpired(effect, play.round));
	if (!expired.length) return settled(quietly(character), ctx);
	return settled(
		{
			character: { ...character, play: dropEffects(play, (effect) => expired.includes(effect)) },
			log: [],
			notices: expired.map((effect) => ({
				text: { key: 'combat.notice.effectExpired', values: { label: effect.label } },
				kind: LOG_KIND.effect,
			})),
		},
		ctx,
	);
}

/** End the turn: every slot fresh, the round counter one on, and whatever ran out expired. */
export function nextTurn(character: Character, ctx: PlayContext): PlayOutcome {
	const play = { ...character.play, turn: freshTurn(), round: character.play.round + 1 };
	return expireTimedEffects({ ...character, play }, ctx);
}

/** Pass time OUT of combat — `rounds` of six seconds each — and expire what ran out, so a ten-round
 *  Bless cast outside a fight ends instead of hanging until a rest. No turn is being taken, so the
 *  slots are left alone. */
export function advanceTime(
	character: Character,
	{ rounds }: { rounds: number },
	ctx: PlayContext,
): PlayOutcome {
	if (rounds <= 0) return quietly(character);
	const play = { ...character.play, round: character.play.round + Math.floor(rounds) };
	return expireTimedEffects({ ...character, play }, ctx);
}

/** Record that something once-per-turn was done. Out of combat there is no turn to hold it. */
export function markRollUsed(character: Character, { id }: { id: string }): PlayOutcome {
	const used = character.play.turn.usedRolls;
	if (!character.play.inCombat || used.includes(id)) return quietly(character);
	return quietly(withTurn(character, { usedRolls: [...used, id] }));
}

/** The player's own mark on a granted roll, on or off. Theirs, not the app's: only some of these
 *  are once-per-turn, and the content does not say which. */
export function toggleRollUsed(character: Character, { id }: { id: string }): PlayOutcome {
	const used = character.play.turn.usedRolls;
	const usedRolls = used.includes(id) ? used.filter((other) => other !== id) : [...used, id];
	return quietly(withTurn(character, { usedRolls }));
}

/** Enter or leave combat. Entering starts a clean turn at round 1; leaving lifts the economy. */
export function toggleCombat(character: Character, ctx: PlayContext): PlayOutcome {
	const play = character.play;
	const entered = !play.inCombat;
	return settled(
		quietly({
			...character,
			play: entered
				? { ...play, inCombat: true, turn: freshTurn(), round: 1 }
				: { ...play, inCombat: false },
		}),
		ctx,
	);
}
