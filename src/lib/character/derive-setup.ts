/*
 * Everything `deriveSheet` reads off the build BEFORE anything is folded: the ability seeds, class
 * levels by bare id, which caster is primary, the hit-dice pools, the equipped armor, the condition
 * lookup and the ctx factory. The pure slices are (build, graph) → plain data with no effects, no ctx
 * and no order dependency between them; `prepareDerive` assembles the lot into one `DeriveSetup`.
 *
 * They live here rather than in `derive.ts` for size (§2.6); the orchestrator keeps the resolve
 * stage, and `derive-assemble.ts` the phases that read what the fold produced.
 */
import { recordOf } from '../util/records';
import { tokensOf, type ContentGraph, type LoadedRow } from '../content/loader';
import { ABILITIES, type Character } from './schema';
import { DIE_MAX, maxHpForClass, proficiencyBonus, type Ability } from '../rules/core';
import { SOURCE_KEY, type Contribution } from '../rules/pipeline';
import { resolveItem, type ResolvedItem } from '../content/resolved-item';
import { castingAbilityByClass } from './spellcasting';
import { makeEffectCtxFactory } from './derive-context';
import { num } from './derive-stats';

/** A10 seeds: the score fold starts from the base score + allocated boosts, as traced contributions. */
function seedAbilityBase(build: Character['build']): Record<Ability, Contribution[]> {
	return recordOf(ABILITIES, (ab) => {
		const contribs: Contribution[] = [
			{
				source: 'Base score',
				layer: 'base',
				op: 'add',
				amount: build.abilities[ab],
				key: SOURCE_KEY.baseScore,
			},
		];
		const boost = build.abilityBoosts?.[ab] ?? 0;
		if (boost)
			contribs.push({
				source: 'Ability boosts',
				layer: 'base',
				op: 'add',
				amount: boost,
				key: SOURCE_KEY.abilityBoosts,
			});
		return contribs;
	});
}

/** Class levels keyed by BARE id (`class_level.monk`), summed across multiclass entries. */
function computeClassLevels(
	build: Character['build'],
	graph: ContentGraph,
): Record<string, number> {
	const classLevels: Record<string, number> = {};
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (row) classLevels[row.id] = (classLevels[row.id] ?? 0) + c.level;
	}
	return classLevels;
}

/** The primary caster's ability (highest caster-class level) — the ctx's default `spellcasting_mod`. */
function pickPrimaryCaster(
	abilityByClass: Record<string, Ability>,
	classLevels: Record<string, number>,
): Ability | undefined {
	let primaryAbility: Ability | undefined;
	let primaryLevel = -1;
	for (const [cid, ab] of Object.entries(abilityByClass)) {
		const lvl = classLevels[cid] ?? 0;
		if (lvl > primaryLevel) {
			primaryLevel = lvl;
			primaryAbility = ab;
		}
	}
	return primaryAbility;
}

/** A hit-dice pool: one die size + how many of it the character has (= summed levels of classes with
 *  that die). Spent counts live in `play.hitDiceSpent`, keyed by `die`. */
export interface HitDiePool {
	die: string;
	max: number;
}

/** Group the character's classes into hit-dice pools by die size (RAW multiclass: pool same-size dice,
 *  keep different sizes separate). Sorted largest die first — a deterministic recover order for the
 *  2014 half-recovery. Pure. */
export function hitDicePools(build: Character['build'], graph: ContentGraph): HitDiePool[] {
	const byDie = new Map<string, number>();
	for (const c of build.classes) {
		const row = graph.get(c.class);
		const die = String((row?.type === 'class' ? row.data.hit_die : undefined) || 'd8');
		byDie.set(die, (byDie.get(die) ?? 0) + c.level);
	}
	return [...byDie]
		.map(([die, max]) => ({ die, max }))
		.sort((a, b) => (DIE_MAX[b.die] ?? 0) - (DIE_MAX[a.die] ?? 0));
}

/** Everything `deriveSheet` needs in hand BEFORE the fold: the level-derived numbers, the pure build
 *  slices, the equipped armor, the primary caster, the condition lookup, and the ctx factory that
 *  closes over all of it. One object because the resolve stage and every phase after it read from the
 *  same set — and because assembling it is the half of the orchestrator that has no order to explain. */
export interface DeriveSetup {
	level: number;
	proficiencyBonus: number;
	abilityBase: Record<Ability, Contribution[]>;
	classLevels: Record<string, number>;
	speciesRow: LoadedRow | undefined;
	baseSpeed: number;
	/** Base max HP as a function of the FINAL CON — the DAG's con→hp_max edge recomputes it once the
	 *  score-writing effects have resolved. */
	hpMaxBaseFor: (conScore: number) => Contribution[];
	equippedArmor: ResolvedItem | undefined;
	/** The shield in hand, resolved the same way armour is. A shield you WIELD is worth its AC while
	 *  you wield it — 5e has no action for raising one — so being equipped is the whole condition. */
	equippedShield: ResolvedItem | undefined;
	abilityByClass: Record<string, Ability>;
	primaryAbility: Ability | undefined;
	expandCondition: (condId: string) => { source: string; tokens: string[] } | undefined;
	makeCtx: ReturnType<typeof makeEffectCtxFactory>;
}

export function prepareDerive(character: Character, graph: ContentGraph): DeriveSetup {
	const build = character.build;
	const system = character.system;
	const level = build.classes.reduce((n, c) => n + c.level, 0) || 1;
	const prof = proficiencyBonus(level);

	// A10 seeds + class levels (bare id) + species base speed — the pure setup slices.
	const abilityBase = seedAbilityBase(build);
	const classLevels = computeClassLevels(build, graph);
	const speciesRow = build.species ? graph.get(build.species) : undefined;
	const baseSpeed = num(speciesRow?.type === 'species' ? speciesRow.data.speed : undefined, 30);

	// base max HP (pre-effect) as a function of the FINAL CON — the DAG's structural con→hp_max
	// edge means score-writing effects resolve first, then this recomputes with the effective CON.
	// classes[0] grants the max hit die; multiclasses avg-up (RAW).
	const hpMaxBaseFor = (conScore: number): Contribution[] => {
		const parts = build.classes.map((c, i) => {
			const row = graph.get(c.class);
			const hitDie = String((row?.type === 'class' ? row.data.hit_die : undefined) || 'd8');
			return maxHpForClass({ hitDie, level: c.level, conScore, includesCharacterLevel1: i === 0 });
		});
		return parts.length
			? parts.flatMap((h) => h.trace)
			: maxHpForClass({ hitDie: 'd8', level, conScore, includesCharacterLevel1: true }).trace;
	};

	// equipped armor — shared by the AC math below and the `armor_type`/`is_wearing_armor` guards.
	// RESOLVED once (tags, plus whatever it inherits from its `base_item_id` or from the base the
	// player chose for a template), because five readers downstream ask it what it is and they must
	// not each answer differently.
	const equippedArmorEntry = build.inventory.find((i) => {
		const row = i.equipped ? graph.get(i.item) : undefined;
		return row?.type === 'item' && row.data.category === 'armor';
	});
	const equippedArmorRow = equippedArmorEntry ? graph.get(equippedArmorEntry.item) : undefined;
	const equippedArmor =
		equippedArmorRow?.type === 'item'
			? resolveItem(graph, equippedArmorRow, equippedArmorEntry?.base)
			: undefined;

	// the shield is its own category, and its own slot: a character wears one armour and holds one
	// shield, so it is found beside the armour rather than folded into it
	const equippedShieldEntry = build.inventory.find((i) => {
		const row = i.equipped ? graph.get(i.item) : undefined;
		return row?.type === 'item' && row.data.category === 'shield';
	});
	const equippedShieldRow = equippedShieldEntry ? graph.get(equippedShieldEntry.item) : undefined;
	const equippedShield =
		equippedShieldRow?.type === 'item'
			? resolveItem(graph, equippedShieldRow, equippedShieldEntry?.base)
			: undefined;

	// casting ability per caster class + the primary caster (highest caster class level) — the
	// cheap slice the resolve ctx needs; full spellcasting derives AFTER the final scores exist.
	const abilityByClass = castingAbilityByClass(character, graph);
	const primaryAbility = pickPrimaryCaster(abilityByClass, classLevels);

	const expandCondition = (condId: string) => {
		// A16(a): edition-filter the lookup — a 5.5e `frightened` row must NOT apply to a 5e character
		// when both roots are loaded, exactly the `systems` gate the class-feature scan above uses.
		// A16(b): first match is now deterministic within the edition (load order); a genuine
		// same-id/same-edition clash across two sources is a collisions.json concern, not resolved here.
		const cond = graph.list('condition', { system }).find((r) => r.id === condId);
		const toks = tokensOf(cond);
		return cond && toks.length ? { source: cond.data.name_en, tokens: toks } : undefined;
	};

	// The ctx factory (derive-context.ts): closes over the static setup, returns `(state) => EffectCtx`
	// with live getters over the resolve state (see that file for the mid-resolve read contract).
	const makeCtx = makeEffectCtxFactory({
		character,
		level,
		proficiencyBonus: prof,
		classLevels,
		primaryAbility,
		baseSpeed,
		equippedArmor,
		equippedShield,
		speciesRow,
		abilityByClass,
	});
	return {
		level,
		proficiencyBonus: prof,
		abilityBase,
		classLevels,
		speciesRow,
		baseSpeed,
		hpMaxBaseFor,
		equippedArmor,
		equippedShield,
		abilityByClass,
		primaryAbility,
		expandCondition,
		makeCtx,
	};
}
