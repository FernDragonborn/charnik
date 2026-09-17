/*
 * The rarity BAND a picker is showing, as a filter the panes share.
 *
 * "No rarity" is a rung of the ladder rather than a separate switch: mundane is what a row with an
 * empty `rarity` IS in the data (`content.md`), and it is where a starting character shops — the SRD
 * ships 234 magic rows against 149 priced mundane ones, so an unfiltered list buries the basics.
 */
import { RARITIES } from '$lib/content/schemas';

export const RARITY_BAND = ['none', ...RARITIES] as const;
export type RarityRung = (typeof RARITY_BAND)[number];

/** Where a row sits on the ladder; anything the schema does not know reads as mundane. */
export const rarityIndex = (rarity: unknown): number => {
	const at = RARITY_BAND.indexOf(String(rarity ?? '') as RarityRung);
	return at < 0 ? 0 : at;
};

/** The whole ladder — the state a picker opens in, so nothing is hidden until asked. */
export const WHOLE_BAND = { from: 0, to: RARITY_BAND.length - 1 };

/** Is this row inside the band? */
export const withinBand = (rarity: unknown, from: number, to: number): boolean => {
	const at = rarityIndex(rarity);
	return at >= from && at <= to;
};
