/*
 * Character-level spellcasting derive — turns a character + the content graph into a per-class
 * casting profile and the shared/pact slot pools. This is the CONSUMER that feeds the pure rules
 * (rules/spellcasting) real data from the graph.
 *
 * Fixes L11 (multiclass has one DC PER caster class, not a single one). Slots follow L1: a single
 * caster class uses its own kind table at its level; 2+ casters share ONE pool from the full table
 * at the summed caster level; warlock Pact Magic is always its own short-rest pool (L2), and the
 * highest spell level a class can LEARN is its own single-class table's max (a Wizard 1 can't
 * prepare 3rd-level spells even if a Cleric multiclass grants 3rd-level slots).
 */
import type { ContentGraph, LoadedRowOf } from '../content/loader';
import { getSpellAccess } from '../content/spellAccess';
import type { Character } from './schema';
import { abilityModifier, spellSaveDC, spellAttackBonus, type Ability } from '../rules/core';
import type { Computed } from '../rules/pipeline';
import { applyEffects, type EffectFacts } from '../effects/apply';
import {
	effectiveCasterLevel,
	shareFromCaster,
	slotCountsFor,
	maxSpellLevel,
	preparedCap,
	slotPools,
	type CastPool,
	type CasterShare,
	type SlotTable
} from '../rules/spellcasting';

interface SpellcastingClass {
	classId: string;
	classEffectiveId: string;
	className: string;
	ability: Ability;
	saveDC: Computed;
	attack: Computed;
	prepareStyle: 'prepared' | 'known';
	cantripCap: number;
	preparedCap: number;
	/** Highest spell level this class can learn/prepare (its own table's max). */
	maxSpellLevel: number;
	/** Spell effectiveIds this class can pick (the access map). */
	accessSpellIds: string[];
	isPact: boolean;
}

export interface Spellcasting {
	/** One profile per caster class (empty for a non-caster character). */
	classes: SpellcastingClass[];
	/** Shared leveled slots (long rest) + warlock pact slots (short rest), as pips. */
	pools: CastPool[];
	/** The shared multiclass caster level (0 for a pure warlock). */
	casterLevel: number;
	/** Has the Ritual Casting class feature (any class with `class.ritual` — Wizard/Cleric/Druid/Bard;
	 *  NOT Warlock by default). Gates the ritual-cast affordance (AUDIT E7/A17). The Book of Ancient
	 *  Secrets invocation that grants a warlock ritual casting is a choice-group feature — deferred. */
	ritualCasting: boolean;
}

const num = (v: unknown): number | undefined => (v === '' || v == null ? undefined : Number(v));

/** The nine spell-slot columns, as literal keys so `spell_slots` rows are read type-safely (a
 *  `slot_${number}` template would be too wide for `keyof SpellSlots`). */
const SLOT_COLUMNS = [
	'slot_1',
	'slot_2',
	'slot_3',
	'slot_4',
	'slot_5',
	'slot_6',
	'slot_7',
	'slot_8',
	'slot_9'
] as const;

/** Build a slot table (charLevel → counts) for a `kind`, scoped to the character's edition. */
function slotTable(graph: ContentGraph, kind: string, systems: string[]): SlotTable {
	const m = new Map<number, number[]>();
	for (const r of graph.rows) {
		if (r.type !== 'spell_slots' || String(r.data.kind) !== kind) continue;
		if (!r.systems.some((s) => systems.includes(s))) continue;
		m.set(
			Number(r.data.level),
			SLOT_COLUMNS.map((col) => Number(r.data[col] || 0))
		);
	}
	return m;
}

/** Cantrips-known + prepared/known-set size for a class at a level (from class_casting). */
function castingCounts(
	graph: ContentGraph,
	classId: string,
	level: number,
	systems: string[]
): { cantrips: number | undefined; prepared: number | undefined } {
	for (const r of graph.rows) {
		if (r.type !== 'class_casting' || String(r.data.class_id) !== classId) continue;
		if (Number(r.data.level) !== level) continue;
		if (!r.systems.some((s) => systems.includes(s))) continue;
		return { cantrips: num(r.data.cantrips_known), prepared: num(r.data.prepared_known) };
	}
	return { cantrips: undefined, prepared: undefined };
}

/** Casting ability per caster class id (`spell_ability`, default INT) — the cheap slice the
 *  effects resolve needs BEFORE final scores exist (`spellcasting_mod` reads a live score by
 *  ability; the full `deriveSpellcasting` waits for the final scores to compute DCs). */
export function castingAbilityByClass(
	character: Character,
	graph: ContentGraph
): Record<string, Ability> {
	const out: Record<string, Ability> = {};
	for (const c of character.build.classes) {
		const row = graph.get(c.class);
		if (row?.type === 'class' && row.data.caster !== 'none')
			out[row.id] = row.data.spell_ability ?? 'int';
	}
	return out;
}

export function deriveSpellcasting(
	character: Character,
	graph: ContentGraph,
	scores: Record<Ability, number>,
	facts?: EffectFacts
): Spellcasting {
	const systems = [character.system];
	const totalLevel = character.build.classes.reduce((n, c) => n + c.level, 0) || 1;

	// a build class references a `class` row by id; keep the ones that actually cast. The type
	// predicate narrows `row` to LoadedRowOf<'class'>, so caster/caster_share/slot_table/spell_ability
	// below read typed — no casts.
	const casters = character.build.classes
		.map((c) => ({ c, row: graph.get(c.class) }))
		.filter(
			(x): x is { c: { class: string; level: number }; row: LoadedRowOf<'class'> } =>
				x.row?.type === 'class' && x.row.data.caster !== 'none'
		);

	if (casters.length === 0) return { classes: [], pools: [], casterLevel: 0, ritualCasting: false };

	// E7: revive the dead `class.ritual` column — the character can ritual-cast iff ANY of its caster
	// classes carries Ritual Casting (Wizard/Cleric/Druid/Bard; not base Warlock).
	const ritualCasting = casters.some((x) => x.row.data.ritual === true);

	const shareOf = (row: LoadedRowOf<'class'>): CasterShare =>
		row.data.caster_share ?? shareFromCaster(String(row.data.caster));

	// shared multiclass caster level (pact excluded) + shared leveled slot pool (L1 branch)
	const shared = casters.filter((x) => x.row.data.caster !== 'pact');
	const casterLevel = effectiveCasterLevel(
		shared.map((x) => ({ share: shareOf(x.row), level: x.c.level }))
	);
	let sharedCounts: number[] = [];
	const only = shared.length === 1 ? shared[0] : undefined;
	if (only) {
		const kind = String(only.row.data.slot_table || only.row.data.caster);
		sharedCounts = slotCountsFor(slotTable(graph, kind, systems), only.c.level);
	} else if (shared.length > 1) {
		sharedCounts = slotCountsFor(slotTable(graph, 'full', systems), casterLevel);
	}
	const pools: CastPool[] = slotPools(sharedCounts, { idPrefix: 'slot', recharge: 'long' });

	const foldSpellStat = (key: 'spell_dc' | 'spell_attack', base: Computed): Computed =>
		facts ? applyEffects(key, base, facts) : base;

	const access = getSpellAccess(graph);
	const classes: SpellcastingClass[] = casters.map(({ c, row }) => {
		const caster = String(row.data.caster);
		const isPact = caster === 'pact';
		const ability: Ability = row.data.spell_ability ?? 'int';
		const score = scores[ability];

		// the class's OWN table (drives its learnable max) + pact's separate pool
		const kind = String(row.data.slot_table || caster);
		const ownCounts = slotCountsFor(slotTable(graph, kind, systems), c.level);
		if (isPact)
			pools.push(
				...slotPools(ownCounts, { idPrefix: 'pact', recharge: 'short', forcedUpcast: true })
			);

		const cc = castingCounts(graph, row.id, c.level, systems);
		return {
			classId: row.id,
			classEffectiveId: c.class,
			className: String(row.data.name_en),
			ability,
			// `spell_dc`/`spell_attack` effects (a Rod-of-the-Pact-Keeper-style item) fold onto every
			// caster class's numbers — the target is not class-scoped in the L1 vocabulary
			saveDC: foldSpellStat('spell_dc', spellSaveDC({ ability, score, level: totalLevel })),
			attack: foldSpellStat(
				'spell_attack',
				spellAttackBonus({ ability, score, level: totalLevel })
			),
			prepareStyle: row.data.prepare_style ?? 'prepared',
			cantripCap: cc.cantrips ?? 0,
			preparedCap: preparedCap(cc.prepared, {
				abilityMod: abilityModifier(score),
				share: shareOf(row),
				level: c.level
			}),
			maxSpellLevel: maxSpellLevel(ownCounts),
			accessSpellIds: access.spellIdsForClass(c.class),
			isPact
		};
	});

	return { classes, pools, casterLevel, ritualCasting };
}
