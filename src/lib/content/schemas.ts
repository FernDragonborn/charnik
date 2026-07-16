/*
 * Per-type content schemas (CSV row shapes), validated with zod.
 *
 * One schema per content type, SHARED by: the CSV loader, the content-editor forms, and
 * the content-health view (docs/PLAN.md "Data model (CSV)"). CSV cells are all strings;
 * schemas coerce numeric/boolean columns and treat empty cells as "absent" (EN fallback,
 * optional mechanics). Bad rows are flagged by the loader, never crashed on.
 *
 * Columns common to every type: id, systems, source, name_en/uk, text_en/uk, effects.
 * Localization is L2 suffixed columns (name_xx / text_xx); only en/uk are seeded, more can
 * be added without code changes (the loader discovers *_<lang> columns).
 *
 * `effects` is a `;`-separated list of tokens (see effectsField). The effect ENGINE interprets
 * them (src/lib/effects/, optional/removable) — the schema only SPLITS the cell into tokens and
 * never rejects one (B12): an unknown/future token degrades to an inert note downstream, so
 * vocabulary growth never breaks older rows.
 */
import { z } from 'zod';

export const SYSTEMS = ['5e', '5.5e'] as const;

/** Bounded effect vocabulary — the only kinds the engine understands. Kept as its own list (not
 *  imported from `$lib/effects`) so content validation doesn't depend on the removable effects
 *  module; a test (`effects.test.ts`) guards it against drifting from the engine's `EFFECT_KINDS`. */
export const EFFECT_KINDS = [
	'flat_bonus',
	'set_override',
	'advantage',
	'disadvantage',
	'grant_proficiency',
	'resist_immune',
	'apply_condition',
	'grant_resource',
	'reroll',
	'min_die'
] as const;

// --- CSV-cell coercion helpers (every cell arrives as a string) ---------------

/** Empty / missing cell → undefined (so optional fields fall back, EN i18n, etc.). */
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

/** Split a CSV list cell (comma/semicolon separated) into trimmed, non-empty items. Already-parsed
 *  arrays pass through stringified. The one splitter shared by build/content code. */
export const splitList = (v: unknown): string[] =>
	Array.isArray(v)
		? v.map(String)
		: v == null || v === ''
			? []
			: String(v)
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean);

const optStr = z.preprocess(blankToUndef, z.string().optional());
const reqStr = z.string().min(1);
const optNum = z.preprocess(blankToUndef, z.coerce.number().optional());
const optInt = z.preprocess(blankToUndef, z.coerce.number().int().optional());
const bool = z.preprocess(
	(v) => (typeof v === 'string' ? ['true', '1', 'yes', 'y'].includes(v.toLowerCase()) : !!v),
	z.boolean()
);

/** `id` is a local slug; effective identity is `source:id`, built by the loader. */
const idField = z
	.string()
	.min(1)
	.regex(/^[a-z0-9][a-z0-9_]*$/, 'id must be a lowercase snake_case slug (a-z 0-9 _)');

/** `systems` = comma list over SYSTEMS, e.g. "5e" | "5.5e" | "5e,5.5e". */
const systemsField = z.preprocess(
	(v) =>
		typeof v === 'string'
			? v
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: v,
	z.array(z.enum(SYSTEMS)).min(1)
);

/** A `;`-separated list of effect tokens. The loader NEVER rejects a token (B12): an unknown or
 *  not-yet-understood token (an L2 guard that starts with a condition not a kind, a `plugin:` token,
 *  a future `reroll:`/`min_die:` kind) is kept VERBATIM and degrades to an inert text note when the
 *  engine interprets it (`parseEffect` → `unknown`), never a killed row — so vocabulary growth is
 *  additive, not a breaking change for older apps. Classifying/flagging an unknown token is the
 *  effect engine's job (and a downstream content-health pass, which may import `$lib/effects`), NOT
 *  the schema's — the schema deliberately stays independent of the removable engine. */
const effectsField = z.preprocess((v) => {
	if (v === '' || v == null) return [];
	if (Array.isArray(v)) return v;
	return String(v)
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
}, z.array(z.string()).default([]));

/** Fields every content row carries. Spread into each type via `.extend`. `systems` and `source` are
 *  OPTIONAL on the row because they are normally declared once in the file's `#content-*:` header and
 *  stamped onto every row by the loader; a per-row column is only a legacy fallback (validated when
 *  present — a bad `systems` value still errors). */
const base = {
	id: idField,
	systems: systemsField.optional(),
	source: optStr,
	name_en: reqStr,
	name_uk: optStr,
	text_en: optStr,
	text_uk: optStr,
	effects: effectsField
};

const baseRow = z.object(base);

// --- Enumerations -------------------------------------------------------------

// Option lists are exported (single source) so the homebrew authoring form renders identical
// selects — a value the form offers is by construction a value the schema accepts.
// SIZES/ABILITIES are owned by rules/core (AUDIT F3) and re-exported for the form imports.
export { SIZES, ABILITY_IDS as ABILITIES } from '../rules/core';
import { SIZES, ABILITY_IDS as ABILITIES } from '../rules/core';
export const HIT_DICE = ['d6', 'd8', 'd10', 'd12'] as const;
export const CASTER_TYPES = ['full', 'half', 'third', 'pact', 'none'] as const;
export const CASTER_SHARES = ['full', 'half', 'half-up', 'third', 'none'] as const;
export const PREPARE_STYLES = ['prepared', 'known'] as const;
export const SCHOOLS = [
	'abjuration',
	'conjuration',
	'divination',
	'enchantment',
	'evocation',
	'illusion',
	'necromancy',
	'transmutation'
] as const;
export const RESOLUTIONS = ['attack', 'save', 'auto', 'none'] as const;
export const ITEM_CATEGORIES = [
	'weapon',
	'armor',
	'shield',
	'gear',
	'tool',
	'pack',
	'ammunition'
] as const;
export const RARITIES = [
	'common',
	'uncommon',
	'rare',
	'very_rare',
	'legendary',
	'artifact'
] as const;
/** Feat categories as named constants — compare against these, not bare strings. */
export const FEAT_CATEGORY = {
	origin: 'origin',
	general: 'general',
	fightingStyle: 'fighting-style',
	epicBoon: 'epic-boon',
	general2014: 'general-2014'
} as const;
export const FEAT_CATEGORIES = Object.values(FEAT_CATEGORY);

const Size = z.enum(SIZES);
const Ability = z.enum(ABILITIES);
const HitDie = z.enum(HIT_DICE);
const CasterType = z.enum(CASTER_TYPES);
/** Multiclass caster-level contribution + rounding, as DATA (so e.g. Artificer's half-rounds-up
 *  is a column value, never a hardcoded class name). full=×1, half=⌊/2⌋, half-up=⌈/2⌉,
 *  third=⌊/3⌋, none=0 (pact contributes nothing to the shared pool). */
const CasterShare = z.enum(CASTER_SHARES);
const PrepareStyle = z.enum(PREPARE_STYLES);
const School = z.enum(SCHOOLS);
/** How a spell/attack resolves against a target. */
const Resolution = z.enum(RESOLUTIONS);
const ItemCategory = z.enum(ITEM_CATEGORIES);
const Rarity = z.enum(RARITIES);

// --- Per-type schemas ---------------------------------------------------------

/** Playable species / race. 5e ability bonuses ride on the species (via `effects`);
 *  5.5e moves them to the background — so ASI-bearing rows are usually system-split. */
const speciesSchema = baseRow.extend({
	size: Size,
	/** Walking speed in feet. */
	speed: z.coerce.number().int(),
	creature_type: optStr, // default "humanoid"
	/** A "+N to M abilities of your choice" ASI (5e Half-Elf), encoded `NxM` (e.g. `1x2`). The
	 *  fixed part rides on `effects`; abilities already boosted there are excluded from the choice. */
	boost_choice: optStr
});

/** A sub-choice within a species: a 2014 **subrace** (Hill Dwarf) or a 2024 in-species
 *  **lineage / legacy / ancestry** choice. Linked to its parent by `species_id`; carries its own
 *  ASI + traits via the common `effects`/`text`. `option_label` overrides the picker heading
 *  (e.g. "Subrace" vs "Lineage") when the default from `kind` isn't right. */
const speciesOptionSchema = baseRow.extend({
	species_id: reqStr,
	kind: z.enum(['subrace', 'lineage', 'legacy', 'ancestry']).default('subrace'),
	option_label: optStr,
	/** Like `species.boost_choice` — a "+N to M of your choice" ASI carried by the sub-option. */
	boost_choice: optStr
});

/** A class. Subclass features live in class_features keyed by class_id+level. */
const classSchema = baseRow.extend({
	hit_die: HitDie,
	primary_ability: optStr, // comma list of Ability
	saves: z.preprocess(
		(v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : v),
		z.array(Ability).length(2)
	),
	caster: CasterType.default('none'),
	/** Multiclass share (defaults follow `caster` if blank — resolved in the rules layer). */
	caster_share: z.preprocess(blankToUndef, CasterShare.optional()),
	/** Spellcasting shape: prepared (choose from a set each rest) vs known (fixed learned list). */
	prepare_style: z.preprocess(blankToUndef, PrepareStyle.optional()),
	/** Can cast ritual-tagged spells (source of rituals varies by class — see rules layer). */
	ritual: z.preprocess((v) => (v === '' || v == null ? false : v), bool).default(false),
	/** Id of the `spell_slots` table this class uses (e.g. `full`, `pact`, or a homebrew id). */
	slot_table: optStr,
	spell_ability: z.preprocess(blankToUndef, Ability.optional()),
	skills_choose: optInt,
	skills_from: optStr, // comma list of skill ids
	subclass_level: optInt,
	/** Levels at which this class grants an ASI-or-feat slot (e.g. "4,6,8,12,14,16,19" for Fighter).
	 *  Data, not a class-name switch — derived from the SRD progression by the converters. */
	asi_levels: z.preprocess(
		(v) =>
			typeof v === 'string'
				? v
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
						.map(Number)
				: v,
		z.array(z.number().int()).default([])
	)
});

/** Linked table: a class feature granted at a level (incl. ASI/feat slot markers).
 *  `subclass_id` is blank for base-class features, set for subclass features. */
const classFeatureSchema = baseRow.extend({
	class_id: reqStr,
	level: z.coerce.number().int().min(1).max(20),
	/** Optional named resource the feature grants (e.g. "rage", "ki"); count via effects. */
	resource: optStr,
	subclass_id: optStr
});

/** A subclass (one per class in SRD 5.2.1). Its features live in class_features with
 *  `subclass_id` set; `subclass_level` on the class says when one is chosen. */
const subclassSchema = baseRow.extend({
	class_id: reqStr,
	/** Casting subclasses (Eldritch Knight / Arcane Trickster / Blood Hunter's Profane Soul) carry
	 *  the caster descriptor here — active from the subclass's grant level. All optional; a
	 *  non-casting subclass leaves them blank. */
	caster: z.preprocess(blankToUndef, CasterType.optional()),
	caster_share: z.preprocess(blankToUndef, CasterShare.optional()),
	prepare_style: z.preprocess(blankToUndef, PrepareStyle.optional()),
	slot_table: optStr,
	spell_ability: z.preprocess(blankToUndef, Ability.optional()),
	/** Class level at which this subclass's spellcasting comes online (e.g. 3 for EK/AT). */
	caster_from_level: optInt
});

/** Background. 5.5e backgrounds carry the ability boosts + an origin feat. */
const backgroundSchema = baseRow.extend({
	skills: optStr, // comma list of skill ids
	tools: optStr,
	languages: optInt,
	/** 5.5e: which abilities the +2/+1 (or +1/+1/+1) may go to. */
	ability_choices: optStr,
	/** 5.5e: granted origin feat id. */
	origin_feat: optStr
});

/** Feat. `category` distinguishes 5.5e origin/general/fighting-style; `prereq` is text. */
const featSchema = baseRow.extend({
	category: z.enum(FEAT_CATEGORIES).default('general'),
	prereq: optStr,
	repeatable: z.preprocess((v) => (v === '' || v == null ? false : v), bool).default(false)
});

/** Spell. Semi-structured upcasting in `higher_level`; resolution + save_ability drive
 *  the combat sheet's resolution tag. Caster-wide DC/attack are computed, never stored. */
const spellSchema = baseRow.extend({
	level: z.coerce.number().int().min(0).max(9),
	school: School,
	casting_time: reqStr, // "1 action" | "1 bonus action" | "1 reaction" | "1 minute" ...
	range: reqStr, // "60 feet" | "Self" | "Touch" | "Self (15-foot cone)"
	components: reqStr, // subset of V,S,M e.g. "V,S,M"
	material: optStr,
	duration: reqStr, // "Instantaneous" | "Concentration, up to 1 minute" | "8 hours"
	concentration: bool,
	ritual: bool,
	classes: optStr, // comma list of class ids that can learn it
	resolution: Resolution.default('none'),
	save_ability: z.preprocess(blankToUndef, Ability.optional()),
	damage: optStr, // "8d6 fire" base damage/effect summary
	higher_level: optStr // upcast / cantrip-scaling text
});

/** Item / equipment. Weapon, armor, shield, gear, tool, pack, ammunition. */
const itemSchema = baseRow.extend({
	category: ItemCategory,
	item_type: optStr, // "martial melee" | "light armor" | "artisan's tools" ...
	cost: optStr, // "15 gp"
	weight_lb: optNum,
	properties: optStr, // weapon props / notes, comma list
	damage: optStr, // "1d8"
	damage_type: optStr, // "slashing"
	range: optStr, // "80/320" thrown/ranged
	ac: optInt, // armor base AC
	armor_dex_cap: optStr, // "" full | "2" medium cap | "0" none (heavy)
	str_min: optInt, // heavy-armor STR requirement
	stealth_disadvantage: z
		.preprocess((v) => (v === '' || v == null ? false : v), bool)
		.default(false),
	attunement: z.preprocess((v) => (v === '' || v == null ? false : v), bool).default(false),
	rarity: z.preprocess(blankToUndef, Rarity.optional())
});

/** A language (SRD Standard / Exotic). Simple reference content the builder picks from. */
const languageSchema = baseRow.extend({
	category: z.enum(['standard', 'exotic']).default('standard'),
	speakers: optStr, // typical speakers
	script: optStr
});

/** Condition (merged with effects on the sheet). Mechanics ride in `effects`. */
const conditionSchema = baseRow.extend({
	/** Negative conditions render crimson, beneficial ones teal. */
	negative: z.preprocess((v) => (v === '' || v == null ? true : v), bool).default(true)
});

/** Catalog row for the runtime "+" effect picker (effects.csv). The mechanics ride in the shared
 *  `effects` token list like every other content type; this row only adds picker metadata. */
const effectSchema = baseRow.extend({
	/** Debuffs (Bane, covers against you…) render crimson in the panel, like conditions. */
	negative: z.preprocess((v) => (v === '' || v == null ? false : v), bool).default(false),
	/** Optional default duration the picker applies; the round counter auto-expires it. */
	duration_rounds: optInt
});

/** Monster / NPC stat block (compendium). Headline stats are structured columns; the
 *  full traits/actions text stays verbatim in `text_en`. `cr` is a string (fractions). */
const monsterSchema = baseRow.extend({
	size: Size,
	creature_type: reqStr, // "aberration" | "beast (dinosaur)" | "fiend (demon)" …
	alignment: optStr,
	ac: optInt,
	initiative: optStr, // "+3 (13)"
	hp: optInt,
	hp_formula: optStr, // "20d10 + 40"
	speed: optStr, // "10 ft., Swim 40 ft."
	str: optInt,
	dex: optInt,
	con: optInt,
	int: optInt,
	wis: optInt,
	cha: optInt,
	str_save: optInt,
	dex_save: optInt,
	con_save: optInt,
	int_save: optInt,
	wis_save: optInt,
	cha_save: optInt,
	cr: optStr, // "10" | "1/2" | "1/8" | "0"
	resistances: optStr,
	immunities: optStr,
	vulnerabilities: optStr,
	gear: optStr,
	senses: optStr,
	languages: optStr,
	skills: optStr
});

// --- Rules / lookup tables (NOT browsable articles: no name_en, minimal identity) ----------

/** Common identity for a lookup/join row: the loader builds `type:source:id` + edition-scopes it, but
 *  carries no name/text/effects. `systems`/`source` are optional (file header stamps them; per-row
 *  column is a legacy fallback). */
const lookupBase = {
	id: idField,
	systems: systemsField.optional(),
	source: optStr
};

/** Spell-slot progression table, matrix form (row = character level, cols = slots per spell
 *  level). Keyed by an arbitrary `kind` id (SRD ships full/half/third/pact; homebrew ships its
 *  own). A class references it via `slot_table`. */
const spellSlotsSchema = z.object({
	...lookupBase,
	kind: reqStr,
	level: z.coerce.number().int().min(1).max(20),
	slot_1: optInt,
	slot_2: optInt,
	slot_3: optInt,
	slot_4: optInt,
	slot_5: optInt,
	slot_6: optInt,
	slot_7: optInt,
	slot_8: optInt,
	slot_9: optInt
});

/** Per-class-level casting counts (linked `class_id`+`level`). `prepared_known` = the size of the
 *  prepared/known set (2024 table count); blank → the rules layer applies a `prepare_style`
 *  formula instead. */
const classCastingSchema = z.object({
	...lookupBase,
	class_id: reqStr,
	level: z.coerce.number().int().min(1).max(20),
	cantrips_known: optInt,
	prepared_known: optInt
});

/** Additive class→spell access join (`class_id`,`spell_id`), so a homebrew class grants access to
 *  existing spells without editing the shipped spell rows. Unioned with inline `spells.classes`. */
const spellListsSchema = z.object({
	...lookupBase,
	class_id: reqStr,
	spell_id: reqStr
});

// --- Registry: type name → { schema, file glob, column order for unparse } -----

export const CONTENT_TYPES = {
	species: { schema: speciesSchema, filebase: 'species' },
	species_option: { schema: speciesOptionSchema, filebase: 'species_options' },
	class: { schema: classSchema, filebase: 'classes' },
	class_feature: { schema: classFeatureSchema, filebase: 'class_features' },
	background: { schema: backgroundSchema, filebase: 'backgrounds' },
	feat: { schema: featSchema, filebase: 'feats' },
	spell: { schema: spellSchema, filebase: 'spells' },
	item: { schema: itemSchema, filebase: 'items' },
	condition: { schema: conditionSchema, filebase: 'conditions' },
	language: { schema: languageSchema, filebase: 'languages' },
	effect: { schema: effectSchema, filebase: 'effects' },
	monster: { schema: monsterSchema, filebase: 'monsters' },
	subclass: { schema: subclassSchema, filebase: 'subclasses' },
	spell_slots: { schema: spellSlotsSchema, filebase: 'spell_slots' },
	class_casting: { schema: classCastingSchema, filebase: 'class_casting' },
	spell_lists: { schema: spellListsSchema, filebase: 'spell_lists' }
} as const;

export type ContentType = keyof typeof CONTENT_TYPES;

/** Rules/lookup tables — data the engine consumes, NOT browsable articles (no name/text). The
 *  compendium, search and article views skip these. */
const LOOKUP_TYPES = new Set<ContentType>(['spell_slots', 'class_casting', 'spell_lists']);

/** A browsable content type (has name/text; shows in compendium + search). */
export const isBrowsable = (t: ContentType): boolean => !LOOKUP_TYPES.has(t);

/** The localizable prose bases that carry per-locale columns (`name_uk`, `text_de`, `material_fr`,
 *  `higher_level_uk`). Kept in ONE place — the loader re-attach, the translate write path and this
 *  type all key off it — so "which columns are translatable" has a single source of truth. */
export const PROSE_BASES = ['name', 'text', 'material', 'higher_level'] as const;
export type ProseBase = (typeof PROSE_BASES)[number];

/** Localized prose columns the strict per-type schema strips (it declares only name/text en+uk) and
 *  the loader re-attaches. Typed by the prose bases so ONLY real `<base>_<loc>` columns are allowed —
 *  arbitrary junk columns stay off the row. Reads come back `string | undefined`
 *  (`noUncheckedIndexedAccess`), which is the intended "missing translation → EN fallback" signal. */
type ProseLocaleColumns = Partial<Record<`${ProseBase}_${string}`, string>>;

/** The validated, coerced data a loaded row of type `T` carries: the zod-inferred model for `T` PLUS
 *  the re-attached prose-locale columns. This is what replaces the old `Record<string, unknown>` bag —
 *  reads like `spell.data.level` are now `number`, not `unknown`. */
export type RowData<T extends ContentType> = z.infer<(typeof CONTENT_TYPES)[T]['schema']> &
	ProseLocaleColumns;

/** A column name of type `T`'s model (used to type grouping/facet keys so `row.data[key]` is
 *  provably safe — no cast). `& string` drops any non-string index keys. */
export type RowColumn<T extends ContentType> = keyof z.infer<(typeof CONTENT_TYPES)[T]['schema']> &
	string;

/** Validate one raw CSV row for a given type. Returns zod's SafeParseReturn, **narrowed to the
 *  schema for `T`** (so `res.data` is that type's shape at a literal call site, not the union). */
export function parseRow<T extends ContentType>(
	type: T,
	row: Record<string, unknown>
): ReturnType<(typeof CONTENT_TYPES)[T]['schema']['safeParse']> {
	return CONTENT_TYPES[type].schema.safeParse(row) as ReturnType<
		(typeof CONTENT_TYPES)[T]['schema']['safeParse']
	>;
}
