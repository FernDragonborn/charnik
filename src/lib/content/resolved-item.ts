/*
 * An item read against the graph — the half of ITEM-TAGS that needs to look another row up.
 *
 * Separate from `item-tags.ts` because that file is a LEAF the loader itself imports (to validate
 * tags mid-load), and a module that both parses the grammar and reaches back into the loaded graph
 * is one module doing two jobs — the cycle madge flags.
 */
import type { ContentGraph, LoadedRowOf } from './loader';
import {
	parseItemTags,
	armorWeightOf,
	ITEM_TAG,
	type ArmorCategory,
	type ItemTags,
} from './item-tags';

/** An item as the sheet reads it: its row, its tags with a `base_item_id` base merged underneath,
 *  and the damage inherited the same way. Built ONCE per equipped item, so the readers that each
 *  used to re-parse `item_type` on their own cannot disagree about what the item is. */
export interface ResolvedItem {
	row: LoadedRowOf<'item'>;
	tags: ItemTags;
	damage: string;
	/** Pounds, inherited from the base the way `damage` and the tags are: every shipped row that names
	 *  a `base_item_id` leaves its own weight blank, so a magic weapon read off its own row weighs
	 *  nothing — on the sheet whose load meter is the only place capacity is shown. */
	weightLb: number;
}

/**
 * Resolve an item against the mundane row its `base_item_id` names — a +1 longsword IS a longsword,
 * so it inherits every tag and the damage it does not state itself. The base's tags go underneath
 * and the item's own win by name, so a magic row adds (`attunement`) without losing (`versatile`).
 *
 * A TEMPLATE row names no base at all ("Weapon (any Simple or Martial weapon)"): there the base is
 * `chosenBase`, the player's pick stored on their inventory entry, and it merges exactly the same way.
 *
 * Within the SAME source for an authored `base_item_id`: a base and its magic version ship together,
 * and resolving across sources would make one pack authoritative over another — the argument that
 * keeps duplicate resolution in `collisions.json` (docs/internals/content.md). A `base_item_id` that
 * resolves to nothing is surfaced at load, not guessed at here.
 */
export function resolveItem(
	graph: ContentGraph,
	row: LoadedRowOf<'item'>,
	chosenBase?: string,
): ResolvedItem {
	const own = parseItemTags(row.data.tags);
	const baseId = row.data.base_item_id;
	// the row's own base wins: content that already says what it is leaves nothing to choose. The
	// chosen base is a full ref, and CROSSES sources on purpose — it is the player's answer to "which
	// weapon is this", not one pack claiming authority over another.
	const base = baseId
		? graph.get(`item:${row.source}:${baseId}`)
		: chosenBase
			? graph.get(chosenBase)
			: undefined;
	const ownWeight = Number(row.data.weight_lb ?? 0);
	if (base?.type !== 'item')
		return { row, tags: own, damage: row.data.damage ?? '', weightLb: ownWeight };
	const tags = new Map(parseItemTags(base.data.tags));
	for (const [name, value] of own) tags.set(name, value);
	return {
		row,
		tags,
		damage: row.data.damage || base.data.damage || '',
		weightLb: ownWeight || Number(base.data.weight_lb ?? 0),
	};
}

/**
 * Does this item need the player to say WHAT it is? A template row — "Weapon (Any Melee Weapon)",
 * "Armor (Medium or Heavy)" — states only that it is magical, so until a base is chosen it has no
 * proficiency category, no dice and no AC, and an attack or armour line built from it looks complete
 * while doing nothing. The one predicate behind both the attack-row note and the picker that fixes it.
 *
 * The tell is the CATEGORY-DEFINING tag, not an empty tag list: every real weapon row says `simple`
 * or `martial` and every real armour says `armor:<weight>` or `ac`, while a template carries only
 * `attunement`. A net does no damage and is still a net, which is why "no damage" alone is not it.
 */
export function needsBaseItem(item: ResolvedItem): boolean {
	if (item.row.data.base_item_id) return false;
	switch (item.row.data.category) {
		case 'weapon':
			return !item.tags.has(ITEM_TAG.simple) && !item.tags.has(ITEM_TAG.martial);
		case 'armor':
		case 'shield':
			return !item.tags.has(ITEM_TAG.armor) && !item.tags.has(ITEM_TAG.ac);
		default:
			return false;
	}
}

/** An armor/shield's proficiency category. The row's `category === 'shield'` is authoritative — a
 *  shield has no weight class — otherwise it is the `armor:` weight. */
export function armorCategoryOf(item: ResolvedItem): ArmorCategory | undefined {
	if (item.row.data.category === 'shield') return 'shield';
	return armorWeightOf(item.tags);
}
