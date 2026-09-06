/*
 * Weapon / armor proficiency model (pure, framework-agnostic). A class grants proficiency
 * CATEGORIES (weapon: simple/martial + specific weapon ids; armor: light/medium/heavy/shield);
 * the caller says which category the equipped item is in — reading that off the item is
 * `content/item-tags.ts`'s job, so nothing here knows what an item looks like on disk.
 * Feeds EFX-A7 (weapon attacks lose the proficiency bonus when non-proficient) and EFX-B9
 * (worn armor you lack proficiency with blocks spellcasting — the PLAN's canonical rule-block).
 *
 * LENIENT by design (never wrong-downward): a class with NO declared prof column, or a character
 * with no classes at all, is treated as UNCONSTRAINED (proficient with everything) — old homebrew
 * that predates these columns keeps today's always-proficient behavior. Only a class that DOES
 * declare its grants can make a weapon/armor non-proficient.
 */

/**
 * What a character is proficient with — either the declared set, or `UNCONSTRAINED`.
 *
 * NAMED rather than `null` (NULL-1): the lenient state means "proficient with EVERYTHING", and
 * `null` reads as its opposite — no grants, i.e. proficient with nothing. A reader of
 * `isArmorProficient(grants, …)` should not have to look up which way round it is.
 */
export const UNCONSTRAINED = 'unconstrained';
export type ProfGrants = Set<string> | typeof UNCONSTRAINED;

/** Parse one class's comma-list prof column into a lowercased set. Blank/absent → UNCONSTRAINED. */
function parseProfGrants(raw: string | undefined): ProfGrants {
	if (raw == null || raw.trim() === '') return UNCONSTRAINED;
	const set = new Set(
		raw
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	);
	return set.size ? set : UNCONSTRAINED;
}

/**
 * Union the prof grants across a character's classes. `UNCONSTRAINED` when any class is undeclared,
 * or the character has no classes at all — the lenient fallback. Otherwise the merged set of
 * declared categories/ids.
 */
export function gatherProfGrants(rawList: (string | undefined)[]): ProfGrants {
	if (!rawList.length) return UNCONSTRAINED;
	const union = new Set<string>();
	for (const raw of rawList) {
		const g = parseProfGrants(raw);
		// an undeclared class → all-proficient, which swallows the union
		if (g === UNCONSTRAINED) return UNCONSTRAINED;
		for (const c of g) union.add(c);
	}
	return union;
}

/**
 * Fold in the categories or weapon ids a FEATURE granted (`grant_proficiency:armor.heavy`) on top of
 * what the classes declare. Adding to an UNCONSTRAINED character grants nothing — they are already
 * proficient with everything — and must never turn them constrained, which is the whole reason this
 * is a function rather than one more entry in `gatherProfGrants`'s raw list.
 */
export function withGrantedProfs(grants: ProfGrants, granted: readonly string[]): ProfGrants {
	if (grants === UNCONSTRAINED || !granted.length) return grants;
	return new Set([...grants, ...granted.map((g) => g.trim().toLowerCase()).filter(Boolean)]);
}

/** Is the character proficient with this weapon? Category grant (simple/martial) OR a specific
 *  weapon-id grant. UNCONSTRAINED grants or an unclassifiable weapon → proficient. */
export function isWeaponProficient(
	grants: ProfGrants,
	category: string | undefined,
	weaponId: string,
): boolean {
	if (grants === UNCONSTRAINED) return true;
	if (category && grants.has(category)) return true;
	return grants.has(weaponId.toLowerCase());
}

/** Is the character proficient with this armor/shield? UNCONSTRAINED grants or an unclassifiable
 *  armor category → proficient (lenient — never block on unknown data). */
export function isArmorProficient(grants: ProfGrants, category: string | undefined): boolean {
	if (grants === UNCONSTRAINED) return true;
	if (!category) return true;
	return grants.has(category);
}
