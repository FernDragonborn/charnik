/*
 * The fixed words content columns take — hit dice, caster kinds, schools, item categories, rarities,
 * feat categories. Their own module because they are the content GRAMMAR's vocabulary, read by the
 * row schemas, the authoring form and the code that compares against one; `schemas.ts` re-exports
 * them, so an import site names either.
 */
export const HIT_DICE = ['d6', 'd8', 'd10', 'd12'] as const;
export const CASTER_TYPES = ['full', 'half', 'third', 'pact', 'none'] as const;
export const CASTER_SHARES = ['full', 'half', 'half_up', 'third', 'none'] as const;
export const PREPARE_STYLES = ['prepared', 'known'] as const;
/**
 * Which of its spells a class — or a subclass — may cast as a RITUAL, as the SRD states it per class:
 * `prepared` is "a spell you have prepared" (a known caster's known spells are its prepared ones),
 * `spellbook` is "in your spellbook; you don't need to have the spell prepared". Blank is a class
 * with no ritual casting at all.
 */
export const RITUAL_SOURCE = { prepared: 'prepared', spellbook: 'spellbook' } as const;
export type RitualSource = (typeof RITUAL_SOURCE)[keyof typeof RITUAL_SOURCE];
export const RITUAL_SOURCES = Object.values(RITUAL_SOURCE);
/** How a feature's `spells` are had: `prepared` — always prepared, never counted against the class's
 *  number (Domain, Oath and Patron spells); `list` — added to the class's spell list to choose from
 *  (the 2014 Fiend's "expanded list"). An open enum: a third way a feature hands over a spell is a
 *  member here. */
export const SPELLS_AS = { prepared: 'prepared', list: 'list' } as const;
export const SPELLS_AS_VALUES = Object.values(SPELLS_AS);
export const SCHOOLS = [
	'abjuration',
	'conjuration',
	'divination',
	'enchantment',
	'evocation',
	'illusion',
	'necromancy',
	'transmutation',
] as const;
// `temp` = a spell that grants TEMPORARY HP (False Life): rolls like `auto` healing but is labelled
// "temp HP" and never adds the spellcasting mod (temp HP is a flat/dice value, no ability mod — item 3).
export const RESOLUTIONS = ['attack', 'save', 'auto', 'temp', 'none'] as const;
/** The same words by name, for code that compares against one. */
export const RESOLUTION = {
	attack: 'attack',
	save: 'save',
	auto: 'auto',
	temp: 'temp',
	none: 'none',
} as const satisfies Record<string, (typeof RESOLUTIONS)[number]>;
// The magic-item kinds were carried by `item_type` while `category` said only "gear" for all 380 of
// them; ITEM-TAGS folded that column away, and a kind is what `category` is for. They sit beside the
// mundane categories rather than under a "magic" one because `rarity` is what marks an item magical.
export const ITEM_CATEGORIES = [
	'weapon',
	'armor',
	'shield',
	'gear',
	'tool',
	'pack',
	'ammunition',
	'potion',
	'ring',
	'wand',
	'staff',
	'rod',
	'scroll',
	'wondrous',
] as const;
/** The categories whose row IS the thing you swing. A `+N` on one of these names THAT item — RAW says
 *  "you have a +1 bonus to attack and damage rolls made with this magic weapon", never a bonus to
 *  every attack its owner makes — so `gatherEffects` keeps those tokens out of the global facts and
 *  `computeAttacks` pays them out per weapon. Staves and rods are here because RAW they are weapons
 *  too; the shipped rows do not yet say which base weapon, so their bonus has no attack row to land
 *  on and applies nowhere, rather than to everything. */
export const WEAPON_LIKE_ITEM_CATEGORIES: readonly string[] = ['weapon', 'staff', 'rod'];
/** The category whose rows a tool proficiency can name (`grant_proficiency:tool.<id>`). */
export const TOOL_ITEM_CATEGORY = 'tool';
export const RARITIES = [
	'common',
	'uncommon',
	'rare',
	'very_rare',
	'legendary',
	'artifact',
] as const;
/**
 * The wildcard a choice column takes instead of a list: `skills_from`, `ability_choice` and
 * `feat_choice` all read "this list, or everything there is", and they read it by the same word.
 * One name, because it is one fact of the content grammar rather than three coincidences.
 */
export const ANY_OPTION = 'any';

/** Feat categories as named constants — compare against these, not bare strings. */
export const FEAT_CATEGORY = {
	origin: 'origin',
	general: 'general',
	fightingStyle: 'fighting_style',
	epicBoon: 'epic_boon',
	general2014: 'general_2014',
} as const;
export const FEAT_CATEGORIES = Object.values(FEAT_CATEGORY);

/** What a proficiency choice-grant may be answered with — the words `feat.skill_choice_kinds` lists. */
export const PROFICIENCY_CHOICE_KIND = {
	skill: 'skill',
	tool: 'tool',
} as const;
