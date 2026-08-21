/*
 * The pure setup slices `deriveSheet` reads off the build BEFORE anything is folded: the ability
 * seeds, class levels by bare id, which caster is primary, and the hit-dice pools. Each is
 * (build, graph) → plain data with no effects, no ctx and no order dependency between them.
 *
 * They live here rather than in `derive.ts` for size (§2.6); the orchestrator keeps the phases that
 * mutate what the fold produced.
 */
import { recordOf } from '../util/records';
import type { ContentGraph } from '../content/loader';
import { ABILITIES, type Character } from './schema';
import { DIE_MAX, type Ability } from '../rules/core';
import type { Contribution } from '../rules/pipeline';

/** A10 seeds: the score fold starts from the base score + allocated boosts, as traced contributions. */
export function seedAbilityBase(build: Character['build']): Record<Ability, Contribution[]> {
	return recordOf(ABILITIES, (ab) => {
		const contribs: Contribution[] = [
			{ source: 'Base score', layer: 'base', op: 'add', amount: build.abilities[ab] },
		];
		const boost = build.abilityBoosts?.[ab] ?? 0;
		if (boost) contribs.push({ source: 'Ability boosts', layer: 'base', op: 'add', amount: boost });
		return contribs;
	});
}

/** Class levels keyed by BARE id (`class_level.monk`), summed across multiclass entries. */
export function computeClassLevels(
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
export function pickPrimaryCaster(
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
