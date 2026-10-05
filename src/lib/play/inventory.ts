/*
 * What play does to what a character carries, as actions: equip, attune, change how many, use one
 * up, answer what a row asks (which weapon it is, which +N, which damage type), and the purse.
 *
 * The inventory is BUILD data — the builder decides what a character owns — and these are the same
 * acts reached from where you notice them. They are actions like any other because what is equipped
 * and attuned moves the sheet: an item's `hp_max` leaving has to pull hit points down wherever the
 * item was taken off. The list semantics are `$lib/character/inventory`, shared with the builder.
 */
import {
	ATTUNEMENT_CAP,
	addItem,
	attunedCount,
	bumpQty,
	removeItem,
	removeItemsOf,
	toggleAttuned,
	toggleEquipped,
	useOne,
	type InventoryEntry,
} from '$lib/character/inventory';
import type { Character } from '$lib/character/schema';
import { quietly, type PlayContext, type PlayOutcome } from './outcome';
import { settled } from './settle';

const withInventory = (character: Character, inventory: InventoryEntry[]): Character => ({
	...character,
	build: { ...character.build, inventory },
});

/** An action that is one change to the list. */
const listAction =
	<Intent>(change: (list: readonly InventoryEntry[], intent: Intent) => InventoryEntry[]) =>
	(character: Character, intent: Intent, ctx: PlayContext): PlayOutcome =>
		settled(quietly(withInventory(character, change(character.build.inventory, intent))), ctx);

/** Put on or take off — a shield in hand is what the Armor Class counts. */
export const toggleEquip = listAction<{ row: string }>((list, { row }) =>
	toggleEquipped(list, row),
);

/** Start carrying an item, and stop carrying it altogether — the two a picker asks for, which
 *  speak of the ITEM. `dropItem` is one row leaving. */
export const ownItem = listAction<{ item: string }>((list, { item }) => addItem(list, item));
export const disownItem = listAction<{ item: string }>((list, { item }) =>
	removeItemsOf(list, item),
);
export const dropItem = listAction<{ row: string }>((list, { row }) => removeItem(list, row));

/** Change how many of a stack are carried. */
export const changeQuantity = listAction<{ row: string; by: number }>((list, { row, by }) =>
	bumpQty(list, row, by),
);

/**
 * Reorder what is carried. The inventory ARRAY is the order. Rows the caller does not name keep
 * their places at the end rather than being dropped: a list rebuilt from a drag is the view's idea
 * of the list, and the character's is the one that counts.
 */
export const reorderInventory = listAction<{ rows: readonly string[] }>((list, { rows }) => {
	const byRow = new Map(list.map((entry) => [entry.iid, entry]));
	const moved = rows.flatMap((iid) => byRow.get(iid) ?? []);
	return [...moved, ...list.filter((entry) => !rows.includes(entry.iid))];
});

/** One carried entry changed, the rest as they were. */
const forRow = (
	list: readonly InventoryEntry[],
	row: string,
	change: (entry: InventoryEntry) => InventoryEntry,
): InventoryEntry[] => list.map((entry) => (entry.iid === row ? change(entry) : entry));

/*
 * The answers a carried row can be asked for. Taking one back (no value) takes whatever it granted
 * off the sheet rather than leaving the last pick standing.
 */

/** Which mundane item a template IS ("Weapon (Any Melee Weapon)"). */
export const setItemBase = listAction<{ row: string; base?: string }>((list, { row, base }) =>
	forRow(list, row, ({ base: _was, ...rest }) => (base ? { ...rest, base } : rest)),
);
/** Which of the bonuses a `+1/+2/+3` row offers this one is. */
export const setItemBonus = listAction<{ row: string; bonus?: number }>((list, { row, bonus }) =>
	forRow(list, row, ({ bonus: _was, ...rest }) =>
		bonus === undefined ? rest : { ...rest, bonus },
	),
);
/** Which of a row's options this one is — a Ring of Resistance's damage type. */
export const setItemChoice = listAction<{ row: string; choice?: string }>((list, { row, choice }) =>
	forRow(list, row, ({ choice: _was, ...rest }) => (choice ? { ...rest, choice } : rest)),
);

/**
 * Attune, or stop. Stopping is always allowed. Attuning past the cap is REFUSED in Strict and
 * allowed with a note in Free — the same split the builder's caps use: the mode the character was
 * built in decides whether a cap is a wall or a note.
 */
export function attune(
	character: Character,
	{ row }: { row: string },
	ctx: PlayContext,
): PlayOutcome {
	const list = character.build.inventory;
	const entry = list.find((carried) => carried.iid === row);
	if (!entry) return quietly(character);
	const over = !entry.attuned && attunedCount(list) >= ATTUNEMENT_CAP;
	if (over && character.ui.strict)
		return {
			...quietly(character),
			refused: true,
			notices: [
				{
					text: { key: 'combat.notice.attunementFull', values: { cap: ATTUNEMENT_CAP } },
					description: { key: 'combat.notice.attunementFullBody' },
				},
			],
		};
	return settled(
		{
			...quietly(withInventory(character, toggleAttuned(list, row))),
			notices: over
				? [
						{
							text: { key: 'combat.notice.overAttunement', values: { cap: ATTUNEMENT_CAP } },
							description: { key: 'combat.notice.overAttunementBody' },
						},
					]
				: [],
		},
		ctx,
	);
}

/** Spend one of a stack — or `count`, never more than it holds. The last one leaves the list, so a
 *  used-up stack does not linger as a zero row. */
export function useItem(
	character: Character,
	{ row, count = 1 }: { row: string; count?: number },
	ctx: PlayContext,
): PlayOutcome {
	const entry = character.build.inventory.find((carried) => carried.iid === row);
	if (!entry) return quietly(character);
	const spent = Math.min(count, entry.qty);
	let list: InventoryEntry[] = [...character.build.inventory];
	for (let i = 0; i < spent; i++) list = useOne(list, row);
	return settled(
		{
			...quietly(withInventory(character, list)),
			notices: [
				{
					text: { key: 'combat.notice.usedItem' },
					description: { key: 'combat.notice.itemsLeft', values: { count: entry.qty - spent } },
					rows: { name: entry.item },
				},
			],
		},
		ctx,
	);
}

/** How many of one coin the purse holds. */
export function setCoin(
	character: Character,
	{ coin, count }: { coin: string; count: number },
): PlayOutcome {
	const currency = { ...character.play.currency, [coin]: Math.max(0, Math.floor(count)) };
	return quietly({ ...character, play: { ...character.play, currency } });
}
