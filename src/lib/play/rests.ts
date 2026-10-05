/*
 * Rests as actions: what a short or a long rest gives back, the Hit Dice a short rest spends, and
 * the `half` house variant of one.
 *
 * A rest is a DURATION, so it also expires what runs out inside it — and not what is still running
 * after: a long rest is eight hours, not forever.
 */
import { rollFormula } from '$lib/rules/dice';
import {
	effectiveHpMax,
	hitDiceRecoveredOnLongRest,
	hitDiceRecovery,
	shortRestHalfHeal,
} from '$lib/rules/core';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { RECHARGE_ALL, restRecharge } from '$lib/rules/recharge';
import { rechargeCount } from '$lib/effects/recharge-amount';
import { remainingRounds, ROUNDS_PER_UNIT } from '$lib/combat/effects-view';
import type { Character, CharacterPlay } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { dropEffects } from './concentration';
import { chain, quietly, type PlayContext, type PlayOutcome } from './outcome';
import { hitDiceSpent } from './resources';
import { settled } from './settle';
import { countAt } from '$lib/util/records';

export type RestKind = 'short' | 'long';

/** How long a rest TAKES, in hours — RAW in both editions, and the only thing that decides which
 *  round-timed effects it outlasts. */
const REST_HOURS: Record<RestKind, number> = { short: 1, long: 8 };

/** What the player decided about a rest before taking it. Every part is optional: a rest nobody
 *  chose for takes the default each part documents. */
export interface RestChoice {
	/** Which spent Hit Dice a long rest returns, die size → count (`rules/core` ▸ `hitDiceRecovery`). */
	hitDice?: Record<string, number>;
}

/** How many spent Hit Dice a long rest may return to this character, whichever sizes they are. */
export const longRestHitDiceBudget = (character: Character, sheet: CharacterSheet): number =>
	hitDiceRecoveredOnLongRest(
		character.system,
		sheet.hitDice.reduce((n, h) => n + h.max, 0),
	);

/** The long-rest-only half of a rest: slots, hit points, concentration, Hit Dice and Exhaustion. */
function longRest(
	character: Character,
	play: CharacterPlay,
	sheet: CharacterSheet,
	choice: RestChoice,
): CharacterPlay {
	// Hit Dice regained — edition-divergent (2014 half total, min 1; 2024 all). WHICH dice is the
	// player's call where the rest cannot return them all; a rest nobody chose for takes the largest
	// first.
	const back = hitDiceRecovery(
		sheet.hitDice,
		play.hitDiceSpent,
		longRestHitDiceBudget(character, sheet),
		choice.hitDice,
	);
	const hitDice = { ...play.hitDiceSpent };
	for (const h of sheet.hitDice) {
		const regained = back[h.die] ?? 0;
		if (regained > 0) hitDice[h.die] = Math.min(hitDice[h.die] ?? 0, h.max) - regained;
	}
	return {
		...play,
		spellSlotsSpent: {},
		// a slot a feature gave lasts until the rest that would have refilled it anyway. Font of
		// Magic's text says so ("vanishes when you finish a Long Rest"); Wild Resurgence's is silent,
		// and a slot that outlived every rest would be a permanent one — RAI
		spellSlotsGained: {},
		// full HP is the EFFECTIVE max (A14): a manual max does not silence an `hp_max` effect
		hp: { ...play.hp, current: effectiveHpMax(play.hp.max ?? null, sheet.maxHp), temp: 0 },
		// a long rest ALWAYS ends concentration, even with no effect of the spell's on the character
		// (Hold Person on an enemy)
		concentration: null,
		hitDiceSpent: hitDice,
		// RAW both editions: a Long Rest removes ONE Exhaustion level. 2014 adds "provided the
		// creature has also ingested some food and drink" — a tracker does not model rations, so it
		// is applied unconditionally (RAI, the universal reading).
		exhaustion: Math.max(0, play.exhaustion - 1),
	};
}

/**
 * Take a rest: recharge pools by what each one's recharge says of this rest, reset spell slots (long
 * = all, short = pact only), restore hit points on a long rest, and expire the round-timed effects
 * the rest outlasts. Indefinite effects persist — those are curses and manual states the player
 * removes.
 */
export function rest(
	character: Character,
	{ kind, choice = {} }: { kind: RestKind; choice?: RestChoice },
	ctx: PlayContext,
): PlayOutcome {
	const sheet = ctx.derive(character);
	const before = character.play;
	const resourcesSpent = { ...before.resourcesSpent };
	for (const pool of sheet.resources) {
		// what this rest gives the pool back is the recharge model's call: `null` nothing, `'all'`
		// the whole pool, otherwise an amount to roll or read
		const back = restRecharge(pool.recharge, kind);
		if (back === null) continue;
		if (back === RECHARGE_ALL) resourcesSpent[pool.id] = 0;
		else {
			const count = rechargeCount(back, sheet.castCtx, ctx.rng);
			if (count !== null)
				resourcesSpent[pool.id] = Math.max(0, countAt(resourcesSpent, pool.id) - count);
		}
	}
	let play: CharacterPlay = { ...before, resourcesSpent };
	if (kind === 'long') play = longRest(character, play, sheet, choice);
	else {
		// warlock pact slots return on a short rest
		const { [PACT_SLOT_KEY]: _pact, ...spellSlotsSpent } = play.spellSlotsSpent;
		play = { ...play, spellSlotsSpent };
	}
	// a rest expires an effect it OUTLASTS: rounds LEFT (not total duration) against the rest's own
	// length. A 24-hour effect is still running when you get up.
	const restRounds = REST_HOURS[kind] * (ROUNDS_PER_UNIT.hour ?? 0);
	play = dropEffects(play, (effect) => {
		const left = remainingRounds(effect, play.round);
		return left != null && left <= restRounds;
	});
	return settled(
		{
			character: { ...character, play },
			log: [],
			notices: [
				{
					text: {
						key: 'combat.notice.restRestored',
						values: { kind: { catalog: 'combat.restKind', id: kind } },
					},
					...(before.exhaustion > play.exhaustion
						? {
								description: {
									key: 'combat.notice.exhaustionChanged',
									values: { from: before.exhaustion, to: play.exhaustion },
								},
							}
						: {}),
				},
			],
		},
		ctx,
	);
}

/** Spend one Hit Die of a size: roll it plus the Constitution modifier, heal a MINIMUM of 1 (RAW)
 *  up to the maximum, and mark it spent. Refused when that pool is empty. */
export function spendHitDie(
	character: Character,
	{ die }: { die: string },
	ctx: PlayContext,
): PlayOutcome {
	const sheet = ctx.derive(character);
	const pool = sheet.hitDice.find((h) => h.die === die);
	if (!pool) return { ...quietly(character), refused: true };
	const spent = hitDiceSpent(character, sheet, die);
	if (pool.max - spent <= 0)
		return {
			...quietly(character),
			refused: true,
			notices: [
				{
					text: { key: 'combat.notice.noHitDice', values: { die } },
					description: { key: 'combat.notice.regainOnLongRest' },
				},
			],
		};
	const con = sheet.abilities.con.mod;
	const rolled = rollFormula(`1${die}${con >= 0 ? `+${con}` : con}`, ctx.rng);
	const play = character.play;
	const max = effectiveHpMax(play.hp.max ?? null, sheet.maxHp);
	return settled(
		{
			character: {
				...character,
				play: {
					...play,
					hp: { ...play.hp, current: Math.min(max, play.hp.current + Math.max(1, rolled.total)) },
					hitDiceSpent: { ...play.hitDiceSpent, [die]: spent + 1 },
				},
			},
			log: [
				{ name: { text: `Hit Die ${die}`, key: 'combat.roll.hitDie', values: { die } }, rolled },
			],
			notices: [],
		},
		ctx,
	);
}

/** The RAW short rest: recharge, then spend each chosen Hit Die (die size → count). */
export function diceShortRest(
	character: Character,
	{ hitDice }: { hitDice: Record<string, number> },
	ctx: PlayContext,
): PlayOutcome {
	let outcome = rest(character, { kind: 'short' }, ctx);
	for (const [die, count] of Object.entries(hitDice))
		for (let i = 0; i < count; i++)
			outcome = chain(outcome, (rested) => spendHitDie(rested, { die }, ctx));
	return chain(outcome, (rested) => ({
		...quietly(rested),
		notices: [{ text: { key: 'combat.notice.shortRestTaken' } }],
	}));
}

/** The `half` short rest (a house variant): recharge and heal half the maximum, no Hit Dice spent. */
export function halfShortRest(character: Character, ctx: PlayContext): PlayOutcome {
	return chain(rest(character, { kind: 'short' }, ctx), (rested) => {
		const play = rested.play;
		const max = effectiveHpMax(play.hp.max ?? null, ctx.derive(rested).maxHp);
		const hp = shortRestHalfHeal(max);
		return settled(
			{
				character: {
					...rested,
					play: { ...play, hp: { ...play.hp, current: Math.min(max, play.hp.current + hp) } },
				},
				log: [
					{
						name: {
							text: `Short rest — +${hp} HP (½ max)`,
							key: 'combat.log.shortRestHalf',
							values: { hp },
						},
					},
				],
				notices: [{ text: { key: 'combat.notice.shortRestHealed', values: { hp } } }],
			},
			ctx,
		);
	});
}
