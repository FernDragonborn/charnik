/*
 * What a character carries, and the rules about carrying it.
 *
 * Pure list-in / list-out, because the same operations run against two different homes: the
 * builder's draft (`draft.inventory`, before the character exists) and the play sheet's
 * (`character.build.inventory`, mid-session). Neither view-model should own the semantics of
 * "attune" — they own where the list lives.
 *
 * Nothing here reads prose. Whether an item can be equipped, needs attunement, or is used up comes
 * from its `category` column and its `tags` (docs/internals/content.md).
 */
import { ITEM_TAG } from '$lib/content/item-tags';
import type { ResolvedItem } from '$lib/content/resolved-item';
import type { Character } from './schema';

export type InventoryEntry = Character['build']['inventory'][number];
export type InventoryList = readonly InventoryEntry[];

/** RAW, both editions: a creature can be attuned to at most three magic items at once. */
export const ATTUNEMENT_CAP = 3;

/** Categories worn or wielded — the ones an `equipped` flag means anything for. */
const EQUIPPABLE_CATEGORIES: readonly string[] = ['armor', 'shield', 'weapon'];

/** Categories spent by using them, so the panel offers "use" and counts one off the stack. An open
 *  list rather than a flag: a fourth kind of consumable is a new entry here, not a schema change. */
const CONSUMABLE_CATEGORIES: readonly string[] = ['potion', 'scroll', 'ammunition'];

export const isEquippable = (item: ResolvedItem | undefined): boolean =>
	!!item && EQUIPPABLE_CATEGORIES.includes(item.row.data.category);

export const isConsumable = (item: ResolvedItem | undefined): boolean =>
	!!item && CONSUMABLE_CATEGORIES.includes(item.row.data.category);

export const needsAttunement = (item: ResolvedItem | undefined): boolean =>
	!!item?.tags.has(ITEM_TAG.attunement);

export const attunedCount = (list: InventoryList): number =>
	list.filter((entry) => entry.attuned).length;

/** Total carried weight in pounds. `weightOf` is injected because the graph lookup belongs to the
 *  caller — this module stays free of content loading. It is asked with the entry's chosen BASE too:
 *  a template magic item weighs what the weapon the player answered with weighs. */
export const carriedWeight = (
	list: InventoryList,
	weightOf: (ref: string, base?: string) => number,
): number => list.reduce((lb, entry) => lb + weightOf(entry.item, entry.base) * entry.qty, 0);

const withEntry = (
	list: InventoryList,
	ref: string,
	change: (entry: InventoryEntry) => InventoryEntry,
): InventoryEntry[] => list.map((entry) => (entry.item === ref ? change(entry) : entry));

export const addItem = (list: InventoryList, ref: string): InventoryEntry[] =>
	!ref || list.some((entry) => entry.item === ref)
		? [...list]
		: [...list, { item: ref, qty: 1, equipped: false, attuned: false }];

export const removeItem = (list: InventoryList, ref: string): InventoryEntry[] =>
	list.filter((entry) => entry.item !== ref);

export const bumpQty = (list: InventoryList, ref: string, by: number): InventoryEntry[] =>
	withEntry(list, ref, (entry) => ({ ...entry, qty: Math.max(1, entry.qty + by) }));

export const toggleEquipped = (list: InventoryList, ref: string): InventoryEntry[] =>
	withEntry(list, ref, (entry) => ({ ...entry, equipped: !entry.equipped }));

/** Attuning is not symmetric with equipping: un-attuning is always allowed, and only the way IN can
 *  be over the cap. The caller decides what to do about that (Strict blocks, Free allows). */
export const toggleAttuned = (list: InventoryList, ref: string): InventoryEntry[] =>
	withEntry(list, ref, (entry) => ({ ...entry, attuned: !entry.attuned }));

/** Spend one of a consumable: the last one leaves the inventory rather than sitting at qty 0, which
 *  would read as "carried" on every surface that counts rows. */
export const useOne = (list: InventoryList, ref: string): InventoryEntry[] => {
	const entry = list.find((e) => e.item === ref);
	if (!entry) return [...list];
	return entry.qty > 1 ? bumpQty(list, ref, -1) : removeItem(list, ref);
};
