/*
 * The ONE authoritative L2/L3 expression context (EXPR-2 lands the build half; EXPR-3 the play
 * half). It adapts the character's derived numbers into the `ExprContext` the pure evaluator reads,
 * so a token like `flat_bonus:damage+ceil(class_level.rogue/2)d6` resolves against the real sheet.
 *
 * Split by lifetime, mirroring docs/PLUGINS.md §4.2: BUILD vars (level, ability mods/scores, class
 * levels…) change only on a build edit; PLAY vars (hp, flags, resources, enums) change constantly.
 * EXPR-2 passes only `build`; EXPR-3 fills `play` for condition guards. Absent-but-whitelisted vars
 * resolve to 0 / false / no-match (SPEC4) — the evaluator already treats `undefined` that way, so a
 * resolver returns `undefined` for a name it doesn't carry rather than guessing.
 */
import type { Ability } from '../rules/core';
import type { ExprContext } from './expr';

/** The six ability ids — must match rules/core's `Ability` and expr.ts's ABILITIES. */
const ABILITY_IDS: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Build-lifetime numbers (always available; the EXPR-2 subset of the ctx). */
export interface BuildVars {
	level: number;
	proficiencyBonus: number;
	/** Effective (post-effect) ability modifiers — SPEC2: expressions read the EFFECTIVE value. */
	abilityMods: Record<Ability, number>;
	abilityScores: Record<Ability, number>;
	/** Class level keyed by BARE class id (`class_level.monk`). */
	classLevels: Record<string, number>;
	/** The active/primary caster's casting-stat modifier (0 for a non-caster). */
	spellcastingMod: number;
	/** Species walking speed pre-effect (`base_speed`). */
	baseSpeed: number;
}

/** Play-lifetime state (the EXPR-3 half; optional so EXPR-2 can omit it entirely). */
export interface PlayVars {
	hp: number;
	hpMax: number;
	tempHp: number;
	exhaustion: number;
	/** `is_*` flags keyed by their FULL name (`is_raging`), so lookup is direct. */
	flags: Record<string, boolean>;
	/** Active condition ids, for `has_condition.<id>`. */
	conditions: ReadonlySet<string>;
	/** Remaining / max resource pools, for `resource.<id>` / `resource_max.<id>`. */
	resources: Record<string, number>;
	resourceMax: Record<string, number>;
	/** Enum-typed play state. */
	armorType: 'none' | 'light' | 'medium' | 'heavy';
	size: string;
}

/**
 * Build the `ExprContext` the evaluator reads. `play` is optional: without it, every guard variable
 * simply resolves to its absent default (0 / false / no enum match), which is exactly the EXPR-2
 * behaviour (values compute; conditions are all "off" because there's no play state to read yet).
 */
export function makeExprContext(build: BuildVars, play?: PlayVars): ExprContext {
	const dotted = (name: string): { prefix: string; id: string } | null => {
		const i = name.indexOf('.');
		return i === -1 ? null : { prefix: name.slice(0, i), id: name.slice(i + 1) };
	};

	return {
		number(name) {
			// dotted numeric families first
			const d = dotted(name);
			if (d) {
				if (d.prefix === 'class_level') return build.classLevels[d.id] ?? 0;
				if (d.prefix === 'resource') return play?.resources[d.id] ?? 0;
				if (d.prefix === 'resource_max') return play?.resourceMax[d.id] ?? 0;
				return undefined;
			}
			// ability mod / score (e.g. `wis_mod`, `dex_score`)
			const abilMatch = /^([a-z]{3})_(mod|score)$/.exec(name);
			if (abilMatch) {
				const ab = abilMatch[1] as Ability;
				if ((ABILITY_IDS as readonly string[]).includes(ab))
					return abilMatch[2] === 'mod' ? build.abilityMods[ab] : build.abilityScores[ab];
			}
			switch (name) {
				case 'level':
					return build.level;
				case 'proficiency_bonus':
					return build.proficiencyBonus;
				case 'spellcasting_mod':
					return build.spellcastingMod;
				case 'base_speed':
					return build.baseSpeed;
				case 'hp':
					return play?.hp ?? 0;
				case 'hp_max':
					return play?.hpMax ?? 0;
				case 'temp_hp':
					return play?.tempHp ?? 0;
				case 'exhaustion':
					return play?.exhaustion ?? 0;
				case 'hp_percent':
					return play && play.hpMax > 0 ? Math.floor((play.hp / play.hpMax) * 100) : 0;
				default:
					return undefined;
			}
		},
		boolean(name) {
			const d = dotted(name);
			if (d)
				return d.prefix === 'has_condition' ? (play?.conditions.has(d.id) ?? false) : undefined;
			return play?.flags[name] ?? false;
		},
		enum(name) {
			if (name === 'armor_type') return play?.armorType;
			if (name === 'size') return play?.size;
			return undefined;
		}
	};
}
