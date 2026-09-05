/*
 * Coins: what they are worth in each other, and what a pile of them weighs.
 *
 * The five PHB denominations and nothing else — a setting that mints its own coin is out of scope,
 * and a table that ignores electrum hides it rather than deleting it (`ui.coinsHidden`).
 *
 * Money is NOT an inventory row. An item stack answers "how many do I carry"; a purse answers "what
 * can I afford", and mixing them makes every price a lookup through the same list a player scrolls
 * for their sword. So it is its own play-state map, and the only thing the two share is weight.
 */

/** One denomination: its id (the key in `play.currency`) and what it is worth in copper. */
export interface Coin {
	id: string;
	/** Value in copper pieces — the one number every conversion is derived from. */
	copper: number;
}

/** The five PHB coins, smallest first: the order they are shown in, and the order a conversion
 *  walks. Values are RAW and identical in both editions. */
export const COINS: readonly Coin[] = [
	{ id: 'cp', copper: 1 },
	{ id: 'sp', copper: 10 },
	{ id: 'ep', copper: 50 },
	{ id: 'gp', copper: 100 },
	{ id: 'pp', copper: 1000 },
];

/** Coins to the pound, RAW in both editions ("fifty coins weigh a pound"), regardless of metal. */
export const COINS_PER_POUND = 50;

/** A purse as it is stored: coin id → how many. Partial on purpose — an absent key is none of that
 *  coin, which is what a character who has never seen platinum should cost to store. */
export type Purse = Readonly<Record<string, number>>;

/** How many coins in total, of every denomination — what the weight is computed from. */
export const coinCount = (purse: Purse): number =>
	COINS.reduce((n, coin) => n + Math.max(0, purse[coin.id] ?? 0), 0);

/** What the purse weighs, in pounds. Not rounded: it folds into a carried-weight total that is
 *  rounded once, at the end, where it is read. */
export const purseWeightLb = (purse: Purse): number => coinCount(purse) / COINS_PER_POUND;

/** The purse's total value in copper — what "can I afford this" is answered with, and what an
 *  exchange reference is written from. */
export const purseInCopper = (purse: Purse): number =>
	COINS.reduce((total, coin) => total + Math.max(0, purse[coin.id] ?? 0) * coin.copper, 0);
