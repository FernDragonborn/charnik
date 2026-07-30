/*
 * L3 plugin PRE-PASS — stage 2½ of deriveSheet (between the resolve stage and the stat fold), split
 * out of derive.ts. Resolves `plugin:` tokens against the registry over the least-data ctx
 * (docs/PLUGINS.md §4.2) and merges the results into the typed facts. A no-op when no plugin token /
 * no registry is present (the removability invariant), so this file only runs for plugin-using builds.
 */
import { abilityModifier, type Ability } from '../rules/core';
import { ABILITIES } from './schema';
import type { Character } from './schema';
import { applyEffects, mergeFacts, collectFacts, type EffectFacts } from '../effects/apply';
import type { ActiveEffect, EffectCtx, EffectIssue } from '../effects/token-parser';
import { expandPluginEffects, type PluginCtx } from '../effects/plugin-registry';
import { CONDITION_FLAG_ALIASES } from '../effects/expression-parser';
import { isEffectTargetSupported } from './derive-targets';
import type { Computed } from '../rules/pipeline';

/** Remaining-count map for the plugin ctx: max − spent per resource, own-or-zero guarded (the id is
 *  content-controlled, so a bare index could read an Object.prototype member — same guard as context). */
function pluginResources(
	facts: EffectFacts,
	resourcesSpent: Readonly<Record<string, number>>
): Record<string, number> {
	return Object.fromEntries(
		facts.resources.map((r) => {
			const spent = Object.hasOwn(resourcesSpent, r.id) ? (resourcesSpent[r.id] ?? 0) : 0;
			return [r.id, Math.max(0, r.max - spent)];
		})
	);
}

export interface PluginPrePassInputs {
	character: Character;
	resolvedEffects: ActiveEffect[];
	scores: Record<Ability, number>;
	prof: number;
	level: number;
	classLevels: Record<string, number>;
	facts: EffectFacts;
	effCtx: EffectCtx | undefined;
	expandCondition: (condId: string) => { source: string; tokens: string[] } | undefined;
	maxHpBase: Computed;
	issues: EffectIssue[];
}

/** L3 plugin PRE-PASS (docs/PLUGINS.md; stage 2½ — between resolve and the fold): resolve every
 *  `plugin:` token against the registry over the §4.2 least-data ctx. Returned TOKENS merge through a
 *  second collectFacts, CONTRIBUTIONS fold as host-stamped numeric facts, and a plugin-granted
 *  `apply_condition` expands ONE level (PLUGINS.md §4.3). No plugin tokens / no registry → a no-op
 *  (removability invariant). Mutates `facts` + `issues`. `api:1` limit: the ctx hpMax + the granted
 *  condition's sub-tokens read the PRE-plugin state — plugins cannot feed the condition DAG. */
export function applyPluginPrePass(o: PluginPrePassInputs): void {
	const { character, resolvedEffects, scores, prof, level, classLevels, facts, effCtx } = o;
	const preHpMax = character.play.hp.max ?? applyEffects('hp_max', o.maxHpBase, facts).value;
	const pluginCtx: PluginCtx = {
		api: 1,
		build: {
			system: character.system,
			level,
			classLevels,
			proficiencyBonus: prof,
			abilities: Object.fromEntries(
				ABILITIES.map((ab) => [ab, { score: scores[ab], mod: abilityModifier(scores[ab]) }])
			) as Record<Ability, { score: number; mod: number }>
		},
		play: {
			hp: character.play.hp.current,
			hpMax: preHpMax,
			tempHp: character.play.hp.temp,
			flags: {
				isBloodied: character.play.hp.current <= preHpMax / 2,
				isRaging: facts.conditions.includes(CONDITION_FLAG_ALIASES.is_raging),
				isConcentrating: character.play.concentration != null
			},
			conditions: facts.conditions,
			resources: pluginResources(facts, character.play.resourcesSpent)
		}
	};
	// scope = character id: the fail-closed counter is per (plugin, character), so one character's
	// ctx can't disable a plugin for another (PLG-3).
	const expansion = expandPluginEffects(resolvedEffects, pluginCtx, o.issues, character.id);
	if (!expansion) return;
	const condsBefore = new Set(facts.conditions);
	if (expansion.syntheticEffects.length)
		mergeFacts(
			facts,
			collectFacts(expansion.syntheticEffects, effCtx, o.issues, isEffectTargetSupported)
		);
	facts.numeric.push(...expansion.numeric);
	facts.pluginNotes.push(...expansion.notes);
	facts.unknown.push(...expansion.unknown);
	// a condition already active pre-plugin was expanded by the resolve stage; only the newly-granted
	// ones expand here (A11 once-per-id).
	const condEffects: ActiveEffect[] = [];
	for (const id of facts.conditions.filter((c) => !condsBefore.has(c))) {
		const cond = o.expandCondition(id);
		if (cond) condEffects.push({ source: cond.source, layer: 'condition', tokens: cond.tokens });
	}
	if (condEffects.length)
		mergeFacts(facts, collectFacts(condEffects, effCtx, o.issues, isEffectTargetSupported));
}
