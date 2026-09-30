/*
 * An item's `tags` column — the one place the app learns what an item IS. A dagger is
 * `simple, melee, finesse, light, thrown:20/60, mastery:nick`; plate is
 * `armor:heavy, ac:18, dex_cap:0, str_min:15, stealth_disadvantage`.
 *
 * It replaced eight sparse columns (`item_type`, `properties`, `range`, `ac`, `armor_dex_cap`,
 * `str_min`, `stealth_disadvantage`, `attunement`) under the rule in docs/plan.md — a column when
 * its emptiness is a hole, a tag when its absence means "does not apply" — and with them the last
 * prose-sniffing in the combat path: `item_type` was a category for gear and a phrase for magic
 * items ("weapon (any sword that deals slashing damage)"), and three readers substring-matched it.
 *
 * A tag is `name` or `name:value`, lowercase snake_case, comma/semicolon separated by the shared
 * `splitList`. That is exactly the shape an effect scope has, so a weapon's tag NAMES are the scopes
 * a scoped bonus (Archery's `attack:ranged+2`) matches against — no second vocabulary.
 *
 * This is the LEAF: the grammar and nothing else, so the loader can validate tags while loading.
 * Reading an item against the base its `base_item_id` names needs the graph, and lives in
 * `resolved-item.ts` on top of this.
 */
import { splitList } from './schemas';
import type { Translate } from '$lib/i18n';

/** Tag name → its value (`''` for a bare tag like `finesse`). */
export type ItemTags = ReadonlyMap<string, string>;

/** The tag names the app itself compares against. Content may carry any others; they still reach
 *  effect scopes and the detail view, they just mean nothing to the rules. */
/** One rung of a `+1/+2/+3` row's ladder: the bonus, and the rarity the item HAS at it when its
 *  own text says so (2024 prints "Uncommon (+1), Rare (+2), or Very Rare (+3)"; SRD 5.1 prints only
 *  the numbers, which are in the row's own name, so a 2014 rung carries no rarity and the row's
 *  stated one stands). */
export interface BonusRung {
	bonus: number;
	rarity?: string;
}

/**
 * `bonus_choice` — the bonuses a row offers, as `1,2,3` or `uncommon:1,rare:2,very_rare:3`.
 *
 * The SRD prints ONE entry per kind ("Weapon, +1, +2, or +3") and lets the rarity set the number,
 * so the number is the player's answer about the item they found rather than anything the shared
 * content row can state. A blank column means the row asks nothing.
 */
export function parseBonusChoices(raw: string | undefined): BonusRung[] {
	const out: BonusRung[] = [];
	for (const part of (raw ?? '').split(',')) {
		const piece = part.trim();
		if (!piece) continue;
		const [a, b] = piece.split(':');
		const bonus = Number(b ?? a);
		if (!Number.isInteger(bonus) || bonus <= 0) continue;
		out.push(b === undefined ? { bonus } : { bonus, rarity: (a ?? '').trim() });
	}
	return out;
}

export const ITEM_TAG = {
	simple: 'simple',
	martial: 'martial',
	melee: 'melee',
	ranged: 'ranged',
	finesse: 'finesse',
	armor: 'armor',
	ac: 'ac',
	dexCap: 'dex_cap',
	strMin: 'str_min',
	stealthDisadvantage: 'stealth_disadvantage',
	attunement: 'attunement',
	/** A tool's check ability (`ability:int`). 5.5e states it per tool; 5.1 says in so many words
	 *  that tool use is NOT tied to one ability, so its rows carry no such tag and the sheet asks. */
	ability: 'ability',
	/** The weapon's one mastery property (`mastery:vex`) — 2024 only; 2014 has no such rule, so only
	 *  that edition's weapons carry it. The property does nothing until a feature unlocks this KIND
	 *  of weapon for the character (MASTERY-HALF). */
	mastery: 'mastery',
	/** A weapon that fires ammunition (`ammunition:80/320` — the value is its range). */
	ammunition: 'ammunition',
	/** WHICH ammunition it fires, and which kind a stack is (`ammo:arrow`). 5.5e states it on both
	 *  sides; SRD 5.1 never says which ammunition a weapon fires, so its weapons carry none. */
	ammo: 'ammo',
} as const;

/** Armor weight classes an `armor:<weight>` tag may name. */
const ARMOR_WEIGHTS = ['light', 'medium', 'heavy'] as const;
export type ArmorWeight = (typeof ARMOR_WEIGHTS)[number];

export type WeaponCategory = 'simple' | 'martial';
export type ArmorCategory = ArmorWeight | 'shield';

/** The proficiency CATEGORIES a class column or a `grant_proficiency` token may name. Shields are a
 *  category you can be proficient with but not a weight an armor row wears, which is why the two
 *  lists differ by exactly that entry. */
export const ARMOR_CATEGORIES: readonly ArmorCategory[] = [...ARMOR_WEIGHTS, 'shield'];
export const WEAPON_CATEGORIES: readonly WeaponCategory[] = ['simple', 'martial'];

/** Tags whose value must be a whole number. Folding a column into a list costs zod's validation of
 *  it — `ac: optInt` rejected `"eleven"` by column name, `ac:eleven` inside a list is just a string —
 *  so these are re-checked at load and a bad one becomes a content-health issue, never a silent 0. */
export const NUMERIC_TAGS: readonly string[] = [ITEM_TAG.ac, ITEM_TAG.dexCap, ITEM_TAG.strMin];

/** What a tag is CALLED. The name is an id (`two_handed`) and the catalog holds the word for it, so
 *  the vocabulary lives in the message files rather than as a second table in code; a tag nobody has
 *  a word for reads as its author wrote it. Takes the translator, like every other label in a pure
 *  module (docs/internals/ui.md ▸ Strings live in the catalogs). */
export const itemTagLabel = (name: string, translate?: Translate): string =>
	translate ? translate(`itemTag.${name}`, { default: name }) : name;

/** Parse a `tags` cell into name → value. Whitespace anywhere is harmless (`mastery: Nick` is
 *  `mastery:nick`); a repeated name keeps the last one. */
export function parseItemTags(raw: unknown): ItemTags {
	const out = new Map<string, string>();
	for (const tag of splitList(raw)) {
		const sep = tag.indexOf(':');
		const name = (sep < 0 ? tag : tag.slice(0, sep)).trim().toLowerCase();
		if (name)
			out.set(
				name,
				sep < 0
					? ''
					: tag
							.slice(sep + 1)
							.trim()
							.toLowerCase(),
			);
	}
	return out;
}

/** A numeric tag's value, or `null` when the tag is absent or not a number. `null` is not 0: an
 *  absent `dex_cap` means "no cap on Dex" while `dex_cap:0` means "no Dex at all" (heavy armor). */
export function tagInt(tags: ItemTags, name: string): number | null {
	const raw = tags.get(name);
	if (raw === undefined || raw === '') return null;
	const n = Number(raw);
	return Number.isInteger(n) ? n : null;
}

/** The armor weight an `armor:<weight>` tag names, or undefined when it names nothing known. */
export function armorWeightOf(tags: ItemTags): ArmorWeight | undefined {
	const weight = tags.get(ITEM_TAG.armor);
	return ARMOR_WEIGHTS.find((w) => w === weight);
}

/** A weapon's proficiency category. Undefined for a weapon that declares neither — treated leniently
 *  downstream (proficient), never as "not proficient". */
export function weaponCategoryOf(tags: ItemTags): WeaponCategory | undefined {
	if (tags.has(ITEM_TAG.martial)) return 'martial';
	if (tags.has(ITEM_TAG.simple)) return 'simple';
	return undefined;
}
