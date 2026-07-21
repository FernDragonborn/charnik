/*
 * Weapon / armor proficiency model (pure, framework-agnostic). A class grants proficiency
 * CATEGORIES (weapon: simple/martial + specific weapon ids; armor: light/medium/heavy/shield);
 * an equipped item's `item_type` normalizes to a category so we never string-match prose at the
 * gate. Feeds EFX-A7 (weapon attacks lose the proficiency bonus when non-proficient) and EFX-B9
 * (worn armor you lack proficiency with blocks spellcasting — the PLAN's canonical rule-block).
 *
 * LENIENT by design (never wrong-downward): a class with NO declared prof column, or a character
 * with no classes at all, is treated as UNCONSTRAINED (proficient with everything) — old homebrew
 * that predates these columns keeps today's always-proficient behavior. Only a class that DOES
 * declare its grants can make a weapon/armor non-proficient.
 */

/** Weapon proficiency categories (specific weapon ids also allowed in a class's grant list). */
export const WEAPON_CATEGORIES = ['simple', 'martial'] as const;
/** Armor proficiency categories. */
export const ARMOR_CATEGORIES = ['light', 'medium', 'heavy', 'shield'] as const;

/** Parse one class's comma-list prof column into a lowercased set. Blank/absent → null. */
function parseProfGrants(raw: string | undefined): Set<string> | null {
	if (raw == null || raw.trim() === '') return null;
	const set = new Set(
		raw
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
	);
	return set.size ? set : null;
}

/**
 * Union the prof grants across a character's classes. `null` = UNCONSTRAINED (proficient with
 * everything): returned when any class is undeclared, or the character has no classes — the
 * lenient fallback. Otherwise the merged set of declared categories/ids.
 */
export function gatherProfGrants(rawList: (string | undefined)[]): Set<string> | null {
	if (!rawList.length) return null;
	const union = new Set<string>();
	for (const raw of rawList) {
		const g = parseProfGrants(raw);
		if (g === null) return null; // an undeclared class → all-proficient, swallows the union
		for (const c of g) union.add(c);
	}
	return union;
}

/** Normalize a weapon item's `item_type` ("martial melee", "simple ranged") to its category. */
export function weaponCategoryOf(itemType: string | undefined): 'simple' | 'martial' | undefined {
	const t = (itemType ?? '').toLowerCase();
	if (t.includes('martial')) return 'martial';
	if (t.includes('simple')) return 'simple';
	return undefined;
}

/** Normalize an armor item to its category. `category === 'shield'` is authoritative; otherwise
 *  read the weight class out of `item_type` ("light armor" / "medium armor" / "heavy armor"). */
export function armorCategoryOf(
	itemType: string | undefined,
	itemCategory: string
): 'light' | 'medium' | 'heavy' | 'shield' | undefined {
	if (itemCategory === 'shield') return 'shield';
	const t = (itemType ?? '').toLowerCase();
	if (t.includes('light')) return 'light';
	if (t.includes('medium')) return 'medium';
	if (t.includes('heavy')) return 'heavy';
	return undefined;
}

/** Is the character proficient with this weapon? Category grant (simple/martial) OR a specific
 *  weapon-id grant. Unconstrained grants (null) or an unclassifiable weapon → proficient. */
export function isWeaponProficient(
	grants: Set<string> | null,
	itemType: string | undefined,
	weaponId: string
): boolean {
	if (grants === null) return true;
	const cat = weaponCategoryOf(itemType);
	if (cat && grants.has(cat)) return true;
	return grants.has(weaponId.toLowerCase());
}

/** Is the character proficient with this armor/shield? Unconstrained grants (null) or an
 *  unclassifiable armor category → proficient (lenient — never block on unknown data). */
export function isArmorProficient(
	grants: Set<string> | null,
	itemType: string | undefined,
	itemCategory: string
): boolean {
	if (grants === null) return true;
	const cat = armorCategoryOf(itemType, itemCategory);
	if (!cat) return true;
	return grants.has(cat);
}
