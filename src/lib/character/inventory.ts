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
import type { InstanceAnswers } from '$lib/content/item-instance';
import type { ResolvedItem } from '$lib/content/resolved-item';
import { inventoryRow, type Character } from './schema';

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

/*
 * A row is named by its own `iid`, never by the item it holds: two rows may hold the same item — a
 * file edited by hand, two rings that resist different things — and a change to one of them is a
 * change to that one. Only `addItem` and `removeItemsOf` speak of the ITEM, because a picker's
 * question is "do you carry this", which is a question about every row at once.
 */
const withEntry = (
	list: InventoryList,
	iid: string,
	change: (entry: InventoryEntry) => InventoryEntry,
): InventoryEntry[] => list.map((entry) => (entry.iid === iid ? change(entry) : entry));

export const addItem = (list: InventoryList, ref: string): InventoryEntry[] =>
	!ref || list.some((entry) => entry.item === ref)
		? [...list]
		: [...list, inventoryRow({ item: ref })];

/** Carry one particular instance, its questions answered as it is added — a template's base, a
 *  `+1/+2/+3` row's bonus. Always a row of its own, because two Weapons +N in one pack are two
 *  weapons; the same instance already carried is not added twice. */
export const addItemInstance = (
	list: InventoryList,
	ref: string,
	answers: InstanceAnswers,
): InventoryEntry[] =>
	list.some(
		(entry) => entry.item === ref && entry.base === answers.base && entry.bonus === answers.bonus,
	)
		? [...list]
		: [...list, inventoryRow({ item: ref, ...answers })];

export const removeItem = (list: InventoryList, iid: string): InventoryEntry[] =>
	list.filter((entry) => entry.iid !== iid);

/** Stop carrying an item altogether — every row of it. The way back out of `addItem`. */
export const removeItemsOf = (list: InventoryList, ref: string): InventoryEntry[] =>
	list.filter((entry) => entry.item !== ref);

export const bumpQty = (list: InventoryList, iid: string, by: number): InventoryEntry[] =>
	withEntry(list, iid, (entry) => ({ ...entry, qty: Math.max(1, entry.qty + by) }));

export const toggleEquipped = (list: InventoryList, iid: string): InventoryEntry[] =>
	withEntry(list, iid, (entry) => ({ ...entry, equipped: !entry.equipped }));

/** Attuning is not symmetric with equipping: un-attuning is always allowed, and only the way IN can
 *  be over the cap. The caller decides what to do about that (Strict blocks, Free allows). */
export const toggleAttuned = (list: InventoryList, iid: string): InventoryEntry[] =>
	withEntry(list, iid, (entry) => ({ ...entry, attuned: !entry.attuned }));

/** Spend one of a consumable: the last one leaves the inventory rather than sitting at qty 0, which
 *  would read as "carried" on every surface that counts rows. */
export const useOne = (list: InventoryList, iid: string): InventoryEntry[] => {
	const entry = list.find((e) => e.iid === iid);
	if (!entry) return [...list];
	return entry.qty > 1 ? bumpQty(list, iid, -1) : removeItem(list, iid);
};
