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

export interface SpellcastingClass {
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
	/** B9: set when the character wears armor they lack proficiency with — RAW you can't cast
	 *  spells while doing so. The UI shows this as a rule-based block (the PLAN's canonical
	 *  "why is casting blocked" hover). Absent = not blocked. */
	armorBlock?: { source: string; note: string };
}

/** Does this class row cast spells at all? The ONE place the `caster !== 'none'` sentinel is compared,
 *  so the "is a caster class" test can't drift across the derive, the builder's `isCaster`, and the
 *  homebrew form's spellcaster-class list (keeps the bare-string compare in a single seam). */
export const classCasts = (classRow: LoadedRowOf<'class'>): boolean =>
	classRow.data.caster !== 'none';

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
	for (const r of graph.list('spell_slots')) {
		if (String(r.data.kind) !== kind) continue;
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
	// FILL-DOWN (E5): a class_casting table may be sparse (rows only where counts change). Use the
	// highest defined level ≤ the target — a gap means "unchanged since the last row", NOT zero.
	let best: { level: number; cantrips: number | undefined; prepared: number | undefined } | null =
		null;
	for (const r of graph.list('class_casting')) {
		if (String(r.data.class_id) !== classId) continue;
		if (!r.systems.some((s) => systems.includes(s))) continue;
		const rowLevel = Number(r.data.level);
		if (rowLevel > level || (best && rowLevel <= best.level)) continue;
		best = {
			level: rowLevel,
			cantrips: num(r.data.cantrips_known),
			prepared: num(r.data.prepared_known)
		};
	}
	return best
		? { cantrips: best.cantrips, prepared: best.prepared }
		: { cantrips: undefined, prepared: undefined };
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
		if (row?.type === 'class' && classCasts(row)) out[row.id] = row.data.spell_ability ?? 'int';
	}
	return out;
}

/** A build class normalized into "what casts, and how" — so the slot/DC/prepared pipeline is
 *  source-agnostic. The caster columns come from the CLASS row for a caster class, or from the chosen
 *  SUBCLASS row for a casting subclass (Eldritch Knight / Arcane Trickster; B25). `level` is always the
 *  class level (it drives slots + the effective caster level regardless of which row casts). */
interface CasterProfile {
	level: number;
	caster: string;
	share: CasterShare;
	ability: Ability;
	prepareStyle: 'prepared' | 'known';
	slotKind: string;
	className: string;
	/** Bare id owning the `class_casting` rows (the class, or the subclass for a subclass caster). */
	ownerId: string;
	/** The build ref (`class:…`/`subclass:…`) used as identity + for the spell-access lookup. */
	accessRef: string;
	ritual: boolean;
}

/** Resolve a build class into its caster profile, or null if it doesn't cast. Which ROW owns the
 *  casting differs (the class itself, or a casting SUBCLASS once it's online at `caster_from_level` —
 *  RAW: EK/AT gain Spellcasting at level 3), but both rows carry the SAME caster-descriptor columns,
 *  so we pick the owner + its identity fields, then build the profile ONCE (no per-branch dup). */
function casterProfileFor(
	entry: Character['build']['classes'][number],
	graph: ContentGraph
): CasterProfile | null {
	const classRow = graph.get(entry.class);
	if (classRow?.type !== 'class') return null;

	// the row that OWNS the casting + the identity/ritual bits that DON'T come from the shared columns
	let owner: LoadedRowOf<'class'> | LoadedRowOf<'subclass'>;
	let accessRef: string;
	let ownerId: string;
	let ritual: boolean;
	if (classCasts(classRow)) {
		// base-class caster (Wizard/Cleric/Sorcerer/Warlock/…)
		owner = classRow;
		accessRef = entry.class;
		ownerId = classRow.id;
		ritual = classRow.data.ritual === true;
	} else {
		// else a casting SUBCLASS whose caster columns are filled + which is online at its grant level.
		// `class_casting`/`slot_table`/spell-list access all key off the SUBCLASS id (a homebrew author
		// adds them there). NOTE the subclass spell-LIST gap (an EK draws the Wizard list) — B25 follow-up.
		const subclassRef = entry.subclass;
		if (subclassRef == null) return null;
		const subRow = graph.get(subclassRef);
		if (
			subRow?.type !== 'subclass' ||
			subRow.data.caster == null ||
			entry.level < (subRow.data.caster_from_level ?? 1)
		)
			return null;
		owner = subRow;
		accessRef = subclassRef;
		ownerId = subRow.id;
		ritual = false; // subclass schema carries no ritual column
	}

	// both class + subclass rows share these caster-descriptor columns → one construction
	const caster = String(owner.data.caster);
	return {
		level: entry.level,
		caster,
		share: owner.data.caster_share ?? shareFromCaster(caster),
		ability: owner.data.spell_ability ?? 'int',
		prepareStyle: owner.data.prepare_style ?? 'prepared',
		slotKind: String(owner.data.slot_table || caster),
		className: String(classRow.data.name_en),
		ownerId,
		accessRef,
		ritual
	};
}

export function deriveSpellcasting(
	character: Character,
	graph: ContentGraph,
	scores: Record<Ability, number>,
	facts?: EffectFacts
): Spellcasting {
	const systems = [character.system];
	const totalLevel = character.build.classes.reduce((n, c) => n + c.level, 0) || 1;

	// each build class → its caster profile (class row, or a casting subclass — B25); drop non-casters
	const sources = character.build.classes
		.map((entry) => casterProfileFor(entry, graph))
		.filter((p): p is CasterProfile => p !== null);

	if (sources.length === 0) return { classes: [], pools: [], casterLevel: 0, ritualCasting: false };

	// E7: the character can ritual-cast iff ANY caster source carries Ritual Casting (Wizard/Cleric/
	// Druid/Bard; not base Warlock, and not a subclass caster by default).
	const ritualCasting = sources.some((p) => p.ritual);

	// shared multiclass caster level (pact excluded) + shared leveled slot pool (L1 branch)
	const shared = sources.filter((p) => p.caster !== 'pact');
	const casterLevel = effectiveCasterLevel(shared.map((p) => ({ share: p.share, level: p.level })));
	let sharedCounts: number[] = [];
	const only = shared.length === 1 ? shared[0] : undefined;
	if (only) {
		sharedCounts = slotCountsFor(slotTable(graph, only.slotKind, systems), only.level);
	} else if (shared.length > 1) {
		sharedCounts = slotCountsFor(slotTable(graph, 'full', systems), casterLevel);
	}
	const pools: CastPool[] = slotPools(sharedCounts, { idPrefix: 'slot', recharge: 'long' });

	const foldSpellStat = (key: 'spell_dc' | 'spell_attack', base: Computed): Computed =>
		facts ? applyEffects(key, base, facts) : base;

	const access = getSpellAccess(graph);
	const classes: SpellcastingClass[] = sources.map((p) => {
		const isPact = p.caster === 'pact';
		const score = scores[p.ability];

		// the source's OWN table (drives its learnable max) + pact's separate pool
		const ownCounts = slotCountsFor(slotTable(graph, p.slotKind, systems), p.level);
		if (isPact)
			pools.push(
				...slotPools(ownCounts, { idPrefix: 'pact', recharge: 'short', forcedUpcast: true })
			);

		const cc = castingCounts(graph, p.ownerId, p.level, systems);
		return {
			classId: p.ownerId,
			classEffectiveId: p.accessRef,
			className: p.className,
			ability: p.ability,
			// `spell_dc`/`spell_attack` effects (a Rod-of-the-Pact-Keeper-style item) fold onto every
			// caster class's numbers — the target is not class-scoped in the L1 vocabulary
			saveDC: foldSpellStat(
				'spell_dc',
				spellSaveDC({ ability: p.ability, score, level: totalLevel })
			),
			attack: foldSpellStat(
				'spell_attack',
				spellAttackBonus({ ability: p.ability, score, level: totalLevel })
			),
			prepareStyle: p.prepareStyle,
			cantripCap: cc.cantrips ?? 0,
			preparedCap: preparedCap(cc.prepared, {
				abilityMod: abilityModifier(score),
				share: p.share,
				level: p.level
			}),
			maxSpellLevel: maxSpellLevel(ownCounts),
			accessSpellIds: access.spellIdsForClass(p.accessRef),
			isPact
		};
	});

	return { classes, pools, casterLevel, ritualCasting };
}
