/*
 * The expression-context factory for the derive pipeline. `makeEffectCtxFactory` closes over the
 * character's static setup (level, class levels, equipped armor, casting abilities…) and returns the
 * `(state) => EffectCtx` the resolve stage calls: scalars go through getters over the LIVE
 * `ResolveState`, so a guard evaluated mid-resolve reads exactly the values the DAG has already
 * resolved, and the final ctx reads the final state. Split out of derive.ts so the aggregator stays
 * an orchestrator.
 */
import type { Character } from './schema';
import type { Ability } from '../rules/core';
import type { LoadedRow, LoadedRowOf } from '../content/loader';
import {
	makeExprContext,
	withSpellcastingMod,
	type BuildVars,
	type PlayVars
} from '../effects/context';
import type { ExprContext } from '../effects/expression-evaluator';
import type { ActiveEffect, EffectCtx } from '../effects/token-parser';
import { type ResolveState } from '../effects/dependency-graph';

/** Armor weight class of the equipped armor (for the `armor_type` guard variable); no armor → none. */
function armorWeightOf(row: LoadedRowOf<'item'> | undefined): PlayVars['armorType'] {
	const t = String(row?.data.item_type ?? '').toLowerCase();
	if (t.includes('heavy')) return 'heavy';
	if (t.includes('medium')) return 'medium';
	if (t.includes('light')) return 'light';
	return 'none';
}

/** The static setup a derive ctx closes over — computed once per `deriveSheet`, before the resolve. */
export interface EffectCtxDeps {
	character: Character;
	level: number;
	proficiencyBonus: number;
	classLevels: Record<string, number>;
	primaryAbility: Ability | undefined;
	baseSpeed: number;
	equippedArmor: LoadedRowOf<'item'> | undefined;
	speciesRow: LoadedRow | undefined;
	abilityByClass: Record<string, Ability>;
}

/** Build the `(state) => EffectCtx` the resolve stage calls. See the file header for the live-getter
 *  contract. `scoped` memoizes the per-class `spellcasting_mod` ctx (SPEC4): a token carried by a
 *  class's row/feature reads THAT class's casting mod, anything else the primary caster's. */
export function makeEffectCtxFactory(deps: EffectCtxDeps): (state: ResolveState) => EffectCtx {
	const {
		character,
		level,
		proficiencyBonus,
		classLevels,
		primaryAbility,
		baseSpeed,
		equippedArmor,
		speciesRow,
		abilityByClass
	} = deps;
	return (state: ResolveState): EffectCtx => {
		const buildVars: BuildVars = {
			level,
			proficiencyBonus,
			abilityMods: state.mods,
			abilityScores: state.scores,
			classLevels,
			get spellcastingMod() {
				return primaryAbility !== undefined ? state.mods[primaryAbility] : 0;
			},
			baseSpeed
		};
		// a manual play-state max (play.hp.max) wins over the computed one, as everywhere
		const hpMaxLive = (): number => character.play.hp.max ?? state.hpMax.value;
		const playVars: PlayVars = {
			hp: character.play.hp.current,
			get hpMax() {
				return hpMaxLive();
			},
			tempHp: character.play.hp.temp,
			exhaustion: character.play.exhaustion,
			flags: {
				get is_bloodied() {
					return character.play.hp.current <= hpMaxLive() / 2;
				},
				is_concentrating: character.play.concentration != null,
				is_wearing_shield: character.play.shieldRaised,
				is_wearing_armor: !!equippedArmor
				// `is_raging` intentionally absent: it resolves via CONDITION_FLAG_ALIASES →
				// has_condition.rage against the live conditions set (see effects/context.ts).
			},
			conditions: state.conditions,
			resources: state.resources,
			resourceMax: state.resourceMax,
			armorType: armorWeightOf(equippedArmor),
			size: String(speciesRow?.type === 'species' ? speciesRow.data.size : 'medium')
		};
		const base = makeExprContext(buildVars, playVars);
		const scoped = new Map<string, ExprContext>();
		return (eff: ActiveEffect): ExprContext => {
			const id = eff.classId;
			const ability = id !== undefined ? abilityByClass[id] : undefined;
			if (id === undefined || ability === undefined) return base;
			let c = scoped.get(id);
			if (!c) {
				c = withSpellcastingMod(base, () => state.mods[ability]);
				scoped.set(id, c);
			}
			return c;
		};
	};
}
