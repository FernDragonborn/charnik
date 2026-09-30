/*
 * Which carried stack a shot comes out of. Pure — the play-time spend lives with the inventory.
 *
 * The editions differ in what they SAY, not in the rule: 5.5e names the kind on the weapon and on the
 * stack (`ammo:arrow`), so a longbow draws from arrows; SRD 5.1 prints "Ammunition (range 80/320)"
 * and never which ammunition, so a 5.1 weapon may draw from any stack and the player says which.
 */
import { ITEM_TAG, type ItemTags } from '$lib/content/item-tags';

/** The item category a stack of ammunition carries. */
export const AMMUNITION_CATEGORY = 'ammunition';

/** What a weapon fires: the kind when its row names one, `null` when it fires ammunition of a kind
 *  its source never states. Undefined for a weapon that fires none. */
export function firedAmmunition(tags: ItemTags): { kind: string | null } | undefined {
	if (!tags.has(ITEM_TAG.ammunition)) return undefined;
	return { kind: tags.get(ITEM_TAG.ammo) || null };
}

/** One carried thing, as far as this question needs it. */
export interface CarriedStack {
	category: string;
	tags: ItemTags;
}

/** The stacks a shot may come from: ammunition of the fired kind, or every stack of ammunition when
 *  the weapon names no kind. */
export function ammunitionStacks<T extends CarriedStack>(
	fired: { kind: string | null },
	carried: readonly T[],
): T[] {
	return carried.filter(
		(s) =>
			s.category === AMMUNITION_CATEGORY &&
			(fired.kind === null || s.tags.get(ITEM_TAG.ammo) === fired.kind),
	);
}
