/*
 * Rests as actions: what a short or a long rest gives back, the Hit Dice a short rest spends, and
 * the `half` house variant of one.
 *
 * A rest is a DURATION, so it also expires what runs out inside it — and not what is still running
 * after: a long rest is eight hours, not forever.
 */
import { LOG_KIND } from '#lib/character/log-kind.ts';
import { rollFormula } from '#lib/rules/dice.ts';
import {
	effectiveHpMax,
	hitDiceRecoveredOnLongRest,
	hitDiceRecovery,
	shortRestHalfHeal,
} from '#lib/rules/core.ts';
import { PACT_SLOT_KEY } from '#lib/rules/spellcasting.ts';
import { RECHARGE_ALL, restRecharge } from '#lib/rules/recharge.ts';
import { rechargeCount } from '#lib/effects/recharge-amount.ts';
import { remainingRounds, ROUNDS_PER_UNIT } from '#lib/combat/effects-view.ts';
import type { Character, CharacterPlay } from '#lib/character/schema.ts';
import { withoutForm } from '#lib/character/forms.ts';
import type { CharacterSheet } from '#lib/character/derive.ts';
import { activeClassFeatures, characterFeatures } from '#lib/character/features.ts';
import type { ContentGraph } from '#lib/content/loader.ts';
import { countAtLevel } from '#lib/content/level-gate.ts';
import { optionsOf } from '#lib/content/options.ts';
import { endConcentration } from './concentration';
import { endEffects } from './effects';
import { leaveForm } from './form';
import { heal, refusedWhileDead } from './hit-points';
import { chain, quietly, type PlayContext, type PlayNotice, type PlayOutcome } from './outcome';
import { hitDiceSpent, resourceSpent } from './resources';
import { settled } from './settle';
import { recoverSlots, type SlotRecoveryPicks } from './rest-slot-recovery';
import { localizedName } from '#lib/content/detail.ts';
import { speciesCantripChoice } from '#lib/character/species-spells.ts';
import { isResolvedFormula, resolveActionFormula } from '#lib/effects/action-token.ts';

export type RestKind = 'short' | 'long';

/** How long a rest TAKES, in hours — RAW in both editions, and the only thing that decides which
 *  round-timed effects it outlasts. */
const REST_HOURS: Record<RestKind, number> = { short: 1, long: 8 };

/** What the player decided about a rest before taking it. Every part is optional: a rest nobody
 *  chose for takes the default each part documents. */
export interface RestChoice {
	/** Which spent Hit Dice a long rest returns, die size → count (`rules/core` ▸ `hitDiceRecovery`). */
	hitDice?: Record<string, number>;
	options?: Record<string, string>;
	recoverSlots?: SlotRecoveryPicks;
	healFrom?: string;
	speciesCantrip?: string;
}

export function shortRestHealingOptions(character: Character, graph: ContentGraph) {
	return characterFeatures(character, graph).flatMap(({ row }) =>
		row.type === 'class_feature' && row.data.short_rest_heal
			? [{ row, formula: row.data.short_rest_heal }]
			: [],
	);
}

export function restOptionGroups(character: Character, graph: ContentGraph, kind: RestKind) {
	const entries = character.build.classes.map((entry) => ({
		classId: entry.class,
		subclassId: entry.subclass ?? null,
		level: entry.level,
	}));
	return [...activeClassFeatures(entries, graph, character.system)]
		.filter(({ row, entry }) => {
			const when = row.data.choose_on_rest;
			return (
				when &&
				(when === 'short' || kind === 'long') &&
				countAtLevel(row.data.choose, entry.level) === 1
			);
		})
		.map(({ row, entry }) => ({
			row,
			options: optionsOf(graph, row).filter(
				(option) =>
					option.systems.includes(character.system) &&
					(option.data.level ?? 1) <= entry.level &&
					!option.data.answer &&
					!option.data.requires,
			),
		}))
		.filter(({ options }) => options.length > 0);
}

function restOptionsAfter(
	character: Character,
	choice: RestChoice,
	graph: ContentGraph,
	kind: RestKind,
): CharacterPlay['restOptions'] {
	let options = character.play.restOptions;
	if (!choice.options || !Object.keys(choice.options).length) return options;
	for (const group of restOptionGroups(character, graph, kind)) {
		const id = choice.options[group.row.id];
		if (
			id &&
			group.options.some((option) => option.id === id) &&
			id !== (options?.[group.row.id] ?? character.build.options[group.row.id]?.[0])
		)
			options = { ...options, [group.row.id]: id };
	}
	return options;
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
		// a long rest ALWAYS ends concentration, even with no effect of the spell's on the character
		// (Hold Person on an enemy) — and the spell's own effect goes with it
		...endConcentration(play),
		spellSlotsSpent: {},
		// a slot a feature gave lasts until the rest that would have refilled it anyway. Font of
		// Magic's text says so ("vanishes when you finish a Long Rest"); Wild Resurgence's is silent,
		// and a slot that outlived every rest would be a permanent one — RAI
		spellSlotsGained: {},
		// full HP is the EFFECTIVE max (A14): a manual max does not silence an `hp_max` effect
		hp: { ...play.hp, current: effectiveHpMax(play.hp.max ?? null, sheet.maxHp), temp: 0 },
		hitDiceSpent: hitDice,
		// RAW both editions: a Long Rest removes ONE Exhaustion level. 2014 adds "provided the
		// creature has also ingested some food and drink" — a tracker does not model rations, so it
		// is applied unconditionally (RAI, the universal reading).
		exhaustion: Math.max(0, play.exhaustion - 1),
	};
}

/** What each pool has spent after this rest: its recharge model says what the rest gives back —
 *  nothing, the whole pool, or an amount to roll or read. */
function rechargedPools(
	waking: Character,
	sheet: CharacterSheet,
	kind: RestKind,
	ctx: PlayContext,
): CharacterPlay['resourcesSpent'] {
	const resourcesSpent = { ...waking.play.resourcesSpent };
	for (const pool of sheet.resources) {
		const back = restRecharge(pool.recharge, kind);
		if (back === null) continue;
		if (back === RECHARGE_ALL) resourcesSpent[pool.id] = 0;
		else {
			const count = rechargeCount(back, sheet.castCtx, ctx.rng);
			if (count !== null)
				resourcesSpent[pool.id] = Math.max(0, resourceSpent(waking, sheet, pool.id) - count);
		}
	}
	return resourcesSpent;
}

/** A long rest's own: hit points, Hit Dice and exhaustion, a lineage cantrip swapped, and the hit
 *  points waiting under a form that still stands. */
function afterLongRest(
	waking: Character,
	rested: CharacterPlay,
	{ sheet, choice, ctx }: { sheet: CharacterSheet; choice: RestChoice; ctx: PlayContext },
): { play: CharacterPlay; notices: PlayNotice[] } {
	let play = longRest(waking, rested, sheet, choice);
	const swap = choice.speciesCantrip ? speciesCantripChoice(waking, ctx.graph) : undefined;
	const chosenCantrip = swap?.spells.find((spell) => spell.effectiveId === choice.speciesCantrip);
	if (swap && chosenCantrip)
		play = {
			...play,
			speciesCantrip: { row: swap.row.effectiveId, spell: chosenCantrip.effectiveId },
		};
	// a form still standing (a 2014 druid of 16 and up) rests on its own count; the hit points
	// waiting under it are the character's, and a long rest restores those too
	const form = play.form;
	if (form?.hpBefore === undefined) return { play, notices: [] };
	const own = ctx.derive(withoutForm(waking)).maxHp;
	const restored = effectiveHpMax(play.hp.max ?? null, own);
	// the sheet shows the form's count, so the hit points under it are said on every rest, full or not
	return {
		play: { ...play, form: { ...form, hpBefore: restored } },
		notices: [
			{
				text: {
					key: 'combat.notice.formOwnHpRestored',
					values: { from: form.hpBefore, to: restored },
				},
				kind: LOG_KIND.rest,
			},
		],
	};
}

/** A short rest's own: the warlock's pact slots back, and the slots a recovery feature chose. */
function afterShortRest(
	play: CharacterPlay,
	recovery: ReturnType<typeof recoverSlots> | undefined,
): CharacterPlay {
	const { [PACT_SLOT_KEY]: _pact, ...spellSlotsSpent } =
		recovery?.spellSlotsSpent ?? play.spellSlotsSpent;
	return {
		...play,
		spellSlotsSpent,
		resourcesSpent: { ...play.resourcesSpent, ...recovery?.recoveredPools },
	};
}

/** The rest said, with the exhaustion it took away when it took one. */
const restedNotice = (
	kind: RestKind,
	exhaustionBefore: number,
	exhaustion: number,
): PlayNotice => ({
	text: {
		key: 'combat.notice.restRestored',
		values: { kind: { catalog: 'combat.restKind', id: kind } },
	},
	kind: LOG_KIND.rest,
	...(exhaustionBefore > exhaustion
		? {
				description: {
					key: 'combat.notice.exhaustionChanged',
					values: { from: exhaustionBefore, to: exhaustion },
				},
			}
		: {}),
});

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
	const dead = refusedWhileDead(character);
	if (dead) return dead;
	const before = character.play;
	// a rest expires an effect it OUTLASTS: rounds LEFT (not total duration) against the rest's own
	// length. A 24-hour effect is still running when you get up. That happens FIRST, and a form whose
	// carrier goes is left with it, so what the rest restores is the character's own and not a form's.
	const restRounds = REST_HOURS[kind] * (ROUNDS_PER_UNIT.hour ?? 0);
	const ended = endEffects(
		character,
		(effect) => {
			const left = remainingRounds(effect, before.round);
			return left != null && left <= restRounds;
		},
		ctx,
	);
	const outlasted = ended.character.play;
	if (outlasted.death) return ended;
	const formGone =
		outlasted.form &&
		!outlasted.effects.some((effect) => effect.source === outlasted.form?.monster);
	const waking: Character = { ...character, play: formGone ? leaveForm(outlasted) : outlasted };
	const sheet = ctx.derive(waking);
	const recovery =
		kind === 'short' && choice.recoverSlots
			? recoverSlots(waking, sheet, ctx.graph, choice.recoverSlots)
			: undefined;
	if (recovery === null)
		return {
			...quietly(character),
			refused: true,
			notices: [{ text: { key: 'combat.notice.slotRecoveryInvalid' } }],
		};
	const resourcesSpent = rechargedPools(waking, sheet, kind, ctx);
	// the rest's hours pass on the clock, so what it did not outlast has that much less left
	let play: CharacterPlay = { ...waking.play, resourcesSpent, round: before.round + restRounds };
	const notices: PlayNotice[] = [...ended.notices];
	if (kind === 'long') {
		const woke = afterLongRest(waking, play, { sheet, choice, ctx });
		play = woke.play;
		notices.push(...woke.notices);
	} else play = afterShortRest(play, recovery);
	const restOptions = restOptionsAfter(character, choice, ctx.graph, kind);
	if (restOptions) play = { ...play, restOptions };
	return settled(
		{
			character: { ...character, play },
			undoable: true,
			log: ended.log,
			notices: [restedNotice(kind, before.exhaustion, play.exhaustion), ...notices],
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
	const dead = refusedWhileDead(character);
	if (dead) return dead;
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
	{ hitDice, ...choice }: RestChoice & { hitDice: Record<string, number> },
	ctx: PlayContext,
): PlayOutcome {
	let outcome = rest(character, { kind: 'short', choice }, ctx);
	const hpBeforeDice = outcome.character.play.hp.current;
	for (const [die, count] of Object.entries(hitDice))
		for (let i = 0; i < count; i++)
			outcome = chain(outcome, (rested) => spendHitDie(rested, { die }, ctx));
	if (outcome.character.play.hp.current > hpBeforeDice && choice.healFrom)
		outcome = chain(outcome, (rested) => {
			const benefit = shortRestHealingOptions(rested, ctx.graph).find(
				({ row }) => row.id === choice.healFrom,
			);
			if (!benefit) return quietly(rested);
			const name = localizedName(benefit.row, ctx.locale);
			const castCtx = ctx.derive(rested).castCtx;
			const formula = resolveActionFormula(
				`heal:${benefit.formula}`,
				castCtx,
				name,
				undefined,
			).slice('heal:'.length);
			if (!isResolvedFormula(formula)) return quietly(rested);
			const rolled = rollFormula(formula, ctx.rng);
			const healed = heal(rested, { amount: Math.max(0, rolled.total) }, ctx);
			return { ...healed, log: [{ name: { text: name }, rolled }, ...healed.log] };
		});
	return chain(outcome, (rested) => ({
		...quietly(rested),
		notices: [{ text: { key: 'combat.notice.shortRestTaken' }, kind: LOG_KIND.rest }],
	}));
}

/** The `half` short rest (a house variant): recharge and heal half the maximum, no Hit Dice spent. */
export function halfShortRest(
	character: Character,
	ctx: PlayContext,
	choice?: RestChoice,
): PlayOutcome {
	return chain(rest(character, { kind: 'short', ...(choice ? { choice } : {}) }, ctx), (rested) => {
		const play = rested.play;
		const max = effectiveHpMax(play.hp.max ?? null, ctx.derive(rested).maxHp);
		const hp = shortRestHalfHeal(max);
		return settled(
			{
				character: {
					...rested,
					play: { ...play, hp: { ...play.hp, current: Math.min(max, play.hp.current + hp) } },
				},
				log: [],
				notices: [
					{ text: { key: 'combat.notice.shortRestHealed', values: { hp } }, kind: LOG_KIND.rest },
				],
			},
			ctx,
		);
	});
}
