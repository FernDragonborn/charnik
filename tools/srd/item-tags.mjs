/*
 * Building an item's `tags` cell out of what the SRD tables say (ITEM-TAGS, docs/plan.md). Shared by
 * both converters because the two SRDs word the same facts differently but land in the same column.
 *
 * This is prose→data, which `src/` may never do — and is exactly what a converter is FOR: the SRD
 * ships as prose, and what comes out of here lands in a CSV column a human reads in a diff before it
 * ships (docs/internals/content.md ▸ "Prose is not a data source").
 */

/** Lowercase snake_case, keeping what a tag value needs (`1d10`, `20/60`). `-` → `_` because it is
 *  the L2 minus operator. */
export const slugTag = (s) =>
	String(s ?? '')
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z0-9_/]/g, '');

/** Split on `,`/`;` at paren depth 0 — "Ammunition (Range 80/320, Bolt)" is ONE property, and
 *  splitting it blindly is what put the scope "bolt)" on three shipped weapons. */
export function splitTopLevel(raw) {
	const out = [];
	let depth = 0;
	let cur = '';
	for (const ch of String(raw ?? '')) {
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
		if ((ch === ',' || ch === ';') && depth === 0) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim()).filter(Boolean);
}

/** One weapon-property phrase → its tag(s). "Versatile (1d10)" → `versatile:1d10`; "Thrown (Range
 *  20/60)" → `thrown:20/60`; "Ammunition (Range 80/320, Bolt)" also says which ammo it fires. A
 *  parenthetical whose value has a space is prose ("Two-Handed (unless mounted)") — the word is
 *  kept and the qualifier stays in `text_en`, which is where it always was. */
export function propertyTags(raw) {
	const m = /^([^(]+?)\s*(?:\((.*)\))?$/.exec(String(raw ?? '').trim());
	const name = slugTag(m?.[1] ?? '');
	if (!name) return [];
	const inner = (m?.[2] ?? '').replace(/^range\s+/i, '').trim();
	if (!inner) return [name];
	// the SRD separates INSIDE a parenthetical with either mark: "(Range 80/320; Bolt)" in 5.5e,
	// "(range 20/60)" in 5.1
	const [value, ...rest] = inner.split(/[,;]/).map((s) => s.trim());
	const tags = value && !/\s/.test(value) ? [`${name}:${slugTag(value)}`] : [name];
	for (const extra of rest) if (extra && !/\s/.test(extra)) tags.push(`ammo:${slugTag(extra)}`);
	return tags;
}

/** A mundane weapon's tags: its table group ("simple melee"), its properties column, its mastery. */
export function weaponTags({ group, properties, mastery }) {
	const tags = String(group ?? '')
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	for (const p of splitTopLevel(properties))
		if (p !== '-' && p !== '—') tags.push(...propertyTags(p));
	if (mastery && mastery !== '-' && mastery !== '—') tags.push(`mastery:${slugTag(mastery)}`);
	return join(tags);
}

/** A mundane armor's tags. A shield declares no weight class — `category` already says it is one. */
export function armorTags({ weight, ac, dexCap, strMin, stealthDisadvantage }) {
	const tags = [];
	if (weight && weight !== 'shield') tags.push(`armor:${slugTag(weight)}`);
	if (ac !== '' && ac != null) tags.push(`ac:${ac}`);
	if (dexCap !== '' && dexCap != null) tags.push(`dex_cap:${dexCap}`);
	if (strMin !== '' && strMin != null && Number(strMin) > 0) tags.push(`str_min:${strMin}`);
	if (stealthDisadvantage) tags.push('stealth_disadvantage');
	return join(tags);
}

const join = (tags) => [...new Set(tags.filter(Boolean))].join(', ');

/** A `tags` cell → the set of tag NAMES in it, for the converter passes that read back their own
 *  output (class weapon lists, the 2014 base-weapon resolver). */
export const tagSet = (cell) =>
	new Set(splitTopLevel(cell).map((t) => slugTag(t.split(':')[0] ?? '')));

/** A weapon off the equipment TABLE, as against a magic row that only names a base in prose: it
 *  declares both halves of its category. The class weapon lists are built from these only. */
export const isMundaneWeapon = (tags) =>
	(tags.has('simple') || tags.has('martial')) && (tags.has('melee') || tags.has('ranged'));

/** What a magic item's head word says its category is — first prefix match wins, `gear` otherwise.
 *  The magic kinds (potion, ring, …) were carried by `item_type` while `category` said only "gear";
 *  they ARE the category now (schemas.ts ▸ ITEM_CATEGORIES). */
const CATEGORY_BY_HEAD = [
	['wondrous item', 'wondrous'],
	['armor', 'armor'],
	['weapon', 'weapon'],
	['shield', 'shield'],
	['ammunition', 'ammunition'],
	['potion', 'potion'],
	['ring', 'ring'],
	['wand', 'wand'],
	['staff', 'staff'],
	['rod', 'rod'],
	['scroll', 'scroll'],
];

/**
 * A magic item's italic meta head ("weapon (any sword)", "armor (plate armor)", "wondrous item")
 * → the row's `category` and the mundane item it is built from.
 *
 * Only a head naming exactly ONE existing item yields a `base_item_id`. "Any sword", or a list of
 * five polearms, is a choice the player makes when equipping — the character schema has nowhere to
 * put that yet, so the row says nothing rather than picking one (docs/plan.md ▸ ITEM-TAGS).
 */
export function magicItemHead(head, mundaneIds) {
	const m = /^([^(]+?)\s*(?:\((.*)\))?$/.exec(
		String(head ?? '')
			.trim()
			.toLowerCase(),
	);
	const kind = (m?.[1] ?? '').trim();
	const qualifier = (m?.[2] ?? '').trim();
	const candidates = qualifier.split(/,| or /).map((s) => s.trim());
	let baseItemId = '';
	if (candidates.length === 1 && candidates[0] && !/^any\b/.test(candidates[0])) {
		// "plate armor" and "studded leather armor" are the SRD naming the armor table's "Plate"
		const bare = candidates[0].replace(/\s+armor$/, '');
		baseItemId = [slugTag(candidates[0]), slugTag(bare)].find((id) => mundaneIds.has(id)) ?? '';
	}
	// "armor (shield)" is a shield, whatever its head word says
	const matched = CATEGORY_BY_HEAD.find(([head]) => kind.startsWith(head));
	const category = qualifier === 'shield' ? 'shield' : (matched?.[1] ?? 'gear');
	return { category, baseItemId };
}
