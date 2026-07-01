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
 * `effects` is a `;`-separated list of bounded-vocabulary tokens (see effectsField). The
 * effect ENGINE interprets them (src/lib/effects/, optional/removable) — here we only
 * validate the surface grammar so a typo'd effect is flagged, not silently dropped.
 */
import { z } from 'zod';

export const SYSTEMS = ['5e', '5.5e'] as const;
export type System = (typeof SYSTEMS)[number];

/** Bounded effect vocabulary — the only kinds the engine understands. */
export const EFFECT_KINDS = [
	'flat-bonus',
	'set-override',
	'advantage',
	'grant-proficiency',
	'resist-immune',
	'apply-condition',
	'grant-resource'
] as const;

// --- CSV-cell coercion helpers (every cell arrives as a string) ---------------

/** Empty / missing cell → undefined (so optional fields fall back, EN i18n, etc.). */
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

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
	.regex(/^[a-z0-9][a-z0-9_-]*$/, 'id must be a lowercase slug (a-z 0-9 _ -)');

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

/** A `;`-separated list of effect tokens; each must start with a known kind. */
const effectsField = z.preprocess(
	(v) => {
		if (v === '' || v == null) return [];
		if (Array.isArray(v)) return v;
		return String(v)
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean);
	},
	z
		.array(
			z.string().refine(
				(tok) => EFFECT_KINDS.some((k) => tok === k || tok.startsWith(k + ':')),
				(tok) => ({ message: `unknown effect kind in "${tok}"` })
			)
		)
		.default([])
);

/** Fields every content row carries. Spread into each type via `.extend`. */
const base = {
	id: idField,
	systems: systemsField,
	source: reqStr,
	name_en: reqStr,
	name_uk: optStr,
	text_en: optStr,
	text_uk: optStr,
	effects: effectsField
};

const baseRow = z.object(base);

// --- Enumerations -------------------------------------------------------------

const Size = z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);
const Ability = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const HitDie = z.enum(['d6', 'd8', 'd10', 'd12']);
const CasterType = z.enum(['full', 'half', 'third', 'pact', 'none']);
const School = z.enum([
	'abjuration',
	'conjuration',
	'divination',
	'enchantment',
	'evocation',
	'illusion',
	'necromancy',
	'transmutation'
]);
/** How a spell/attack resolves against a target. */
const Resolution = z.enum(['attack', 'save', 'auto', 'none']);
const ItemCategory = z.enum(['weapon', 'armor', 'shield', 'gear', 'tool', 'pack', 'ammunition']);
const Rarity = z.enum(['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact']);

// --- Per-type schemas ---------------------------------------------------------

/** Playable species / race. 5e ability bonuses ride on the species (via `effects`);
 *  5.5e moves them to the background — so ASI-bearing rows are usually system-split. */
export const speciesSchema = baseRow.extend({
	size: Size,
	/** Walking speed in feet. */
	speed: z.coerce.number().int(),
	creature_type: optStr // default "humanoid"
});

/** A class. Subclass features live in class_features keyed by class_id+level. */
export const classSchema = baseRow.extend({
	hit_die: HitDie,
	primary_ability: optStr, // comma list of Ability
	saves: z.preprocess(
		(v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : v),
		z.array(Ability).length(2)
	),
	caster: CasterType.default('none'),
	spell_ability: z.preprocess(blankToUndef, Ability.optional()),
	skills_choose: optInt,
	skills_from: optStr, // comma list of skill ids
	subclass_level: optInt
});

/** Linked table: a class feature granted at a level (incl. ASI/feat slot markers).
 *  `subclass_id` is blank for base-class features, set for subclass features. */
export const classFeatureSchema = baseRow.extend({
	class_id: reqStr,
	level: z.coerce.number().int().min(1).max(20),
	/** Optional named resource the feature grants (e.g. "rage", "ki"); count via effects. */
	resource: optStr,
	subclass_id: optStr
});

/** A subclass (one per class in SRD 5.2.1). Its features live in class_features with
 *  `subclass_id` set; `subclass_level` on the class says when one is chosen. */
export const subclassSchema = baseRow.extend({
	class_id: reqStr
});

/** Background. 5.5e backgrounds carry the ability boosts + an origin feat. */
export const backgroundSchema = baseRow.extend({
	skills: optStr, // comma list of skill ids
	tools: optStr,
	languages: optInt,
	/** 5.5e: which abilities the +2/+1 (or +1/+1/+1) may go to. */
	ability_choices: optStr,
	/** 5.5e: granted origin feat id. */
	origin_feat: optStr
});

/** Feat. `category` distinguishes 5.5e origin/general/fighting-style; `prereq` is text. */
export const featSchema = baseRow.extend({
	category: z
		.enum(['origin', 'general', 'fighting-style', 'epic-boon', 'general-2014'])
		.default('general'),
	prereq: optStr,
	repeatable: z.preprocess((v) => (v === '' || v == null ? false : v), bool).default(false)
});

/** Spell. Semi-structured upcasting in `higher_level`; resolution + save_ability drive
 *  the combat sheet's resolution tag. Caster-wide DC/attack are computed, never stored. */
export const spellSchema = baseRow.extend({
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
export const itemSchema = baseRow.extend({
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

/** Condition (merged with effects on the sheet). Mechanics ride in `effects`. */
export const conditionSchema = baseRow.extend({
	/** Negative conditions render crimson, beneficial ones teal. */
	negative: z.preprocess((v) => (v === '' || v == null ? true : v), bool).default(true)
});

/** Catalog row for the runtime "+" effect picker (effects.csv). One bounded-vocab op. */
export const effectSchema = baseRow.extend({
	kind: z.enum(EFFECT_KINDS),
	target: optStr, // what it modifies, e.g. "ac" | "save.dex" | "skill.stealth"
	op: optStr, // "+" | "-" | "set" | "advantage" | "resist" ...
	value: optStr,
	/** Optional default duration; a round counter auto-expires it. */
	duration_rounds: optInt
});

/** Monster / NPC stat block (compendium). Headline stats are structured columns; the
 *  full traits/actions text stays verbatim in `text_en`. `cr` is a string (fractions). */
export const monsterSchema = baseRow.extend({
	size: Size,
	creature_type: reqStr, // "aberration" | "beast (dinosaur)" | "fiend (demon)" …
	alignment: optStr,
	ac: optInt,
	hp: optInt,
	hp_formula: optStr, // "20d10 + 40"
	speed: optStr, // "10 ft., Swim 40 ft."
	str: optInt,
	dex: optInt,
	con: optInt,
	int: optInt,
	wis: optInt,
	cha: optInt,
	cr: optStr, // "10" | "1/2" | "1/8" | "0"
	senses: optStr,
	languages: optStr,
	skills: optStr
});

// --- Registry: type name → { schema, file glob, column order for unparse } -----

export const CONTENT_TYPES = {
	species: { schema: speciesSchema, filebase: 'species' },
	class: { schema: classSchema, filebase: 'classes' },
	class_feature: { schema: classFeatureSchema, filebase: 'class_features' },
	background: { schema: backgroundSchema, filebase: 'backgrounds' },
	feat: { schema: featSchema, filebase: 'feats' },
	spell: { schema: spellSchema, filebase: 'spells' },
	item: { schema: itemSchema, filebase: 'items' },
	condition: { schema: conditionSchema, filebase: 'conditions' },
	effect: { schema: effectSchema, filebase: 'effects' },
	monster: { schema: monsterSchema, filebase: 'monsters' },
	subclass: { schema: subclassSchema, filebase: 'subclasses' }
} as const;

export type ContentType = keyof typeof CONTENT_TYPES;

export type Species = z.infer<typeof speciesSchema>;
export type CharClass = z.infer<typeof classSchema>;
export type ClassFeature = z.infer<typeof classFeatureSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type Feat = z.infer<typeof featSchema>;
export type Spell = z.infer<typeof spellSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type Monster = z.infer<typeof monsterSchema>;
export type Subclass = z.infer<typeof subclassSchema>;

/** Validate one raw CSV row for a given type. Returns zod's SafeParseReturn. */
export function parseRow<T extends ContentType>(type: T, row: Record<string, unknown>) {
	return CONTENT_TYPES[type].schema.safeParse(row);
}
