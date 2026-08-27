/*
 * An item read against the graph — the half of ITEM-TAGS that needs to look another row up.
 *
 * Separate from `item-tags.ts` because that file is a LEAF the loader itself imports (to validate
 * tags mid-load), and a module that both parses the grammar and reaches back into the loaded graph
 * is one module doing two jobs — the cycle madge flags.
 */
import type { ContentGraph, LoadedRowOf } from './loader';
import { parseItemTags, armorWeightOf, type ArmorCategory, type ItemTags } from './item-tags';

/** An item as the sheet reads it: its row, its tags with a `base_item_id` base merged underneath,
 *  and the damage inherited the same way. Built ONCE per equipped item, so the readers that each
 *  used to re-parse `item_type` on their own cannot disagree about what the item is. */
export interface ResolvedItem {
	row: LoadedRowOf<'item'>;
	tags: ItemTags;
	damage: string;
}

/**
 * Resolve an item against the mundane row its `base_item_id` names — a +1 longsword IS a longsword,
 * so it inherits every tag and the damage it does not state itself. The base's tags go underneath
 * and the item's own win by name, so a magic row adds (`attunement`) without losing (`versatile`).
 *
 * Within the SAME source: a base and its magic version ship together, and resolving across sources
 * would make one pack authoritative over another — the argument that keeps duplicate resolution in
 * `collisions.json` (docs/internals/content.md). A `base_item_id` that resolves to nothing is
 * surfaced at load, not guessed at here.
 */
export function resolveItem(graph: ContentGraph, row: LoadedRowOf<'item'>): ResolvedItem {
	const own = parseItemTags(row.data.tags);
	const baseId = row.data.base_item_id;
	const base = baseId ? graph.get(`item:${row.source}:${baseId}`) : undefined;
	if (base?.type !== 'item') return { row, tags: own, damage: row.data.damage ?? '' };
	const tags = new Map(parseItemTags(base.data.tags));
	for (const [name, value] of own) tags.set(name, value);
	return { row, tags, damage: row.data.damage || base.data.damage || '' };
}

/** An armor/shield's proficiency category. The row's `category === 'shield'` is authoritative — a
 *  shield has no weight class — otherwise it is the `armor:` weight. */
export function armorCategoryOf(item: ResolvedItem): ArmorCategory | undefined {
	if (item.row.data.category === 'shield') return 'shield';
	return armorWeightOf(item.tags);
}
