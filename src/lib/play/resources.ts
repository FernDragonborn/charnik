/*
 * What a character spends and gets back, as actions: spell-slot pips, named pools (rage, ki, an
 * item's charges), a spend-option's cost, and the boundaries of a day.
 *
 * A pool's `spent` is stored by id and outlives whatever granted it, so every read here goes through
 * `resourceSpent`, which clamps it to what the sheet grants NOW.
 */
import { pipClick, titleCase } from '$lib/combat/helpers';
import { RECHARGE_ALL } from '$lib/rules/recharge';
import { rechargeCount } from '$lib/effects/recharge-amount';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { SaidText } from '$lib/util/say';
import { countAt } from '$lib/util/records';
import { quietly, type PlayContext, type PlayNotice, type PlayOutcome } from './outcome';
import { settled } from './settle';

/** A boundary that is not a rest. */
export type DayBoundary = 'dawn' | 'dusk';

const poolOf = (sheet: CharacterSheet, id: string) => sheet.resources.find((r) => r.id === id);

/** What a pool is CALLED — never its id, which is a key, not a word the player has ever read. A
 *  pool nothing grants any more reads like a pool rather than like a database key. */
export const resourceName = (sheet: CharacterSheet, id: string): string =>
	poolOf(sheet, id)?.name ?? titleCase(id);

/** Spent count for a pool, CLAMPED to what the sheet grants: after a feature is removed or its max
 *  drops, the stored count can exceed the live max, or name a pool that is gone (max 0). */
export function resourceSpent(character: Character, sheet: CharacterSheet, id: string): number {
	const stored = countAt(character.play.resourcesSpent, id);
	return Math.max(0, Math.min(stored, poolOf(sheet, id)?.max ?? 0));
}

/** Units left in a pool (max − spent). */
export const resourceLeft = (character: Character, sheet: CharacterSheet, id: string): number =>
	(poolOf(sheet, id)?.max ?? 0) - resourceSpent(character, sheet, id);

/** Spent count for a hit-die pool, clamped to the live max for the reason `resourceSpent` is. */
export function hitDiceSpent(character: Character, sheet: CharacterSheet, die: string): number {
	const stored = character.play.hitDiceSpent[die] ?? 0;
	const max = sheet.hitDice.find((h) => h.die === die)?.max ?? 0;
	return Math.max(0, Math.min(stored, max));
}

const withSpent = (character: Character, id: string, spent: number): Character => ({
	...character,
	play: { ...character.play, resourcesSpent: { ...character.play.resourcesSpent, [id]: spent } },
});

/** How much of a finite pool is left, or how often an unlimited one (`inf` max) has been used. */
const leftOf = (max: number, spent: number): SaidText =>
	Number.isFinite(max)
		? { key: 'combat.notice.resourceLeftOf', values: { left: max - spent, max } }
		: { key: 'combat.notice.resourceUsedUnlimited', values: { used: spent } };

/** Press a spell-slot pip: a filled one spends down to it, a spent one restores up to it. `full`
 *  and `spent` are the pool as the pips show it — a feature's gained slots are counted into it. */
export function setSlotPip(
	character: Character,
	{ key, full, spent, index }: { key: string; full: number; spent: number; index: number },
	ctx: PlayContext,
): PlayOutcome {
	const spellSlotsSpent = {
		...character.play.spellSlotsSpent,
		[key]: pipClick(spent, index, full),
	};
	return settled(quietly({ ...character, play: { ...character.play, spellSlotsSpent } }), ctx);
}

/** Use ONE unit of a pool, or refuse when it is empty — the way a cast reserves a spell slot. */
export function useResource(
	character: Character,
	{ id, max }: { id: string; max: number },
	ctx: PlayContext,
): PlayOutcome {
	const sheet = ctx.derive(character);
	const name = resourceName(sheet, id);
	const before = resourceSpent(character, sheet, id);
	if (before >= max)
		return {
			...quietly(character),
			refused: true,
			notices: [
				{
					text: { key: 'combat.notice.resourceNoneLeft', values: { name } },
					description: { key: 'combat.notice.rechargeOnRest' },
				},
			],
		};
	return settled(
		{
			character: withSpent(character, id, before + 1),
			log: [],
			notices: [
				{
					text: { key: 'combat.notice.resourceUsed', values: { name } },
					description: leftOf(max, before + 1),
				},
			],
		},
		ctx,
	);
}

/** Press a pool's pip: set the spent count the way a slot pip does, and say which way it moved. */
export function setResourcePip(
	character: Character,
	{ id, max, index }: { id: string; max: number; index: number },
	ctx: PlayContext,
): PlayOutcome {
	const sheet = ctx.derive(character);
	const before = resourceSpent(character, sheet, id);
	const after = pipClick(before, index, max);
	const notices: PlayNotice[] =
		after === before
			? []
			: [
					{
						text: {
							key:
								after > before
									? 'combat.notice.resourceUsed'
									: 'combat.notice.resourceRestoredName',
							values: { name: resourceName(sheet, id) },
						},
						description: {
							key: 'combat.notice.resourceLeftOf',
							values: { left: max - after, max },
						},
					},
				];
	return settled({ character: withSpent(character, id, after), log: [], notices }, ctx);
}

/** What a spend-option takes from its pool, and what it is called while it does. */
export interface OptionSpend {
	resource: string;
	/** Uses it costs — an `x` cost already priced at the amount the player picked. */
	cost: number;
	name: string;
	/** What the option does, in the row's own words, said with the spend. */
	says: string;
}

/** Can a pool pay this many uses right now? */
export const canAfford = (
	character: Character,
	sheet: CharacterSheet,
	{ resource, cost }: Pick<OptionSpend, 'resource' | 'cost'>,
): boolean => cost >= 1 && cost <= resourceLeft(character, sheet, resource);

/** Pay an option's cost out of its pool, or refuse when the pool cannot cover it. */
export function spendOnOption(
	character: Character,
	spend: OptionSpend,
	ctx: PlayContext,
): PlayOutcome {
	const sheet = ctx.derive(character);
	const { cost, name } = spend;
	const resource = resourceName(sheet, spend.resource);
	if (!canAfford(character, sheet, spend))
		return {
			...quietly(character),
			refused: true,
			notices: [
				{
					text: { key: 'combat.notice.notEnoughResource', values: { resource, name } },
					description: {
						key: 'combat.notice.notEnoughResourceBody',
						values: { left: resourceLeft(character, sheet, spend.resource), cost },
					},
				},
			],
		};
	const spent = resourceSpent(character, sheet, spend.resource) + cost;
	return settled(
		{
			character: withSpent(character, spend.resource, spent),
			log: [],
			notices: [
				{
					text: { key: 'combat.notice.resourceSpent', values: { name, cost, resource } },
					description: spend.says,
				},
			],
		},
		ctx,
	);
}

/** Spend `count` uses of a pool as PART of an action that already said what it is — a feature
 *  paying out of a pool another feature owns. Silent and unchecked: whoever runs the action refuses
 *  the whole of it before anything is paid. */
export function spendResource(
	character: Character,
	{ id, count }: { id: string; count: number },
	ctx: PlayContext,
): PlayOutcome {
	const spent = resourceSpent(character, ctx.derive(character), id) + count;
	return settled(quietly(withSpent(character, id, spent)), ctx);
}

/** One more spell slot of a level. It is a slot, not a restored one: it stands above the table's
 *  count until a Long Rest. */
export function gainSlot(
	character: Character,
	{ level }: { level: number },
	ctx: PlayContext,
): PlayOutcome {
	const key = String(level);
	const gained = character.play.spellSlotsGained;
	const spellSlotsGained = { ...gained, [key]: (gained[key] ?? 0) + 1 };
	return settled(
		{
			character: { ...character, play: { ...character.play, spellSlotsGained } },
			log: [],
			notices: [{ text: { key: 'combat.notice.slotGained', values: { level } } }],
		},
		ctx,
	);
}

/** Regain ALL expended uses of a pool. RAW: Persistent Rage "regain all expended uses of Rage". */
export function restoreResource(
	character: Character,
	{ id }: { id: string },
	ctx: PlayContext,
): PlayOutcome {
	const name = resourceName(ctx.derive(character), id);
	return settled(
		{
			character: withSpent(character, id, 0),
			log: [],
			notices: [{ text: { key: 'combat.notice.resourceFullyRestored', values: { name } } }],
		},
		ctx,
	);
}

/** Regain expended uses until at least `upTo` are AVAILABLE — never fewer than are there already
 *  ("regain expended until you have N"). Silent: whoever caused it names the feature. A pool the
 *  sheet does not grant is left alone. */
export function restoreResourceUpTo(
	character: Character,
	{ id, upTo }: { id: string; upTo: number },
	ctx: PlayContext,
): PlayOutcome {
	const pool = poolOf(ctx.derive(character), id);
	if (!pool) return quietly(character);
	const spent = countAt(character.play.resourcesSpent, id);
	return settled(
		quietly(withSpent(character, id, Math.min(spent, Math.max(0, pool.max - upTo)))),
		ctx,
	);
}

/**
 * Dawn, or dusk. Everything whose recharge fires there comes back — a wand's "regains 1d6+1 charges
 * daily at dawn" is rolled here, because that is when the table rolls it. Asked for by the player,
 * never by a clock: nothing knows the hour, and a long rest is eight hours from whenever it started,
 * which is not dawn.
 */
export function passBoundary(
	character: Character,
	{ trigger }: { trigger: DayBoundary },
	ctx: PlayContext,
): PlayOutcome {
	const sheet = ctx.derive(character);
	const spent = { ...character.play.resourcesSpent };
	const recharged: SaidText[] = [];
	for (const pool of sheet.resources) {
		const before = spent[pool.id] ?? 0;
		// nothing spent to give back — say nothing about it
		if (pool.recharge.trigger !== trigger || before === 0) continue;
		if (pool.recharge.amount === RECHARGE_ALL) {
			spent[pool.id] = 0;
			recharged.push({ key: 'combat.notice.rechargedAll', values: { name: pool.name } });
			continue;
		}
		const count = rechargeCount(pool.recharge.amount, sheet.castCtx, ctx.rng);
		if (count === null) continue;
		const left = Math.max(0, before - count);
		spent[pool.id] = left;
		recharged.push({
			key: 'combat.notice.recharged',
			values: { name: pool.name, count: before - left },
		});
	}
	return settled(
		{
			character: { ...character, play: { ...character.play, resourcesSpent: spent } },
			log: [],
			notices: [
				{
					text: { key: `combat.timeSkip.${trigger === 'dawn' ? 'newDay' : 'nightfall'}` },
					description: recharged.length ? recharged : { key: 'combat.notice.nothingRecharged' },
				},
			],
		},
		ctx,
	);
}
