/*
 * The aggregator: character + loaded content + rules core + effects engine → the full set
 * of derived stats a sheet renders. One call, `deriveSheet(character, graph)`.
 *
 * This is the glue seam — it resolves the character's `type:source:id` refs against the
 * content graph, runs the pure rules math on the resulting numbers, and layers active
 * effects through `applyEffects`. Ability scores flow through the SAME fold/clamp pipeline
 * as every other stat (A10): base + boosts + score-targeting effects fold into a traced,
 * clamped `Computed`, resolved in DEPENDENCY order by the effects DAG (a guarded ability
 * bonus, a rage that raises max HP feeding `is_bloodied` — see effects/dependency-graph.ts). Missing
 * referenced content is skipped gracefully (loader already flagged it) — the sheet computes
 * with what it can.
 *
 * Every field is a `Computed` ({value, trace, notes}), so the UI explains any number.
 *
 * Four steps, in order: gather the active effects (`derive-gather`), read the build's pre-fold slices
 * (`derive-setup`), run the ONE resolve stage here, then assemble the sheet (`derive-assemble`).
 */
import { recordOf } from '../util/records';
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { Character } from './schema';
import { gatherEffects } from './derive-gather';
import { type ResourceOption } from './derive-resource-options';
// re-exported: `ResourceOption` is part of `CharacterSheet`, so its consumers import it from here
export type { ResourceOption };
import { prepareDerive, type HitDiePool } from './derive-setup';
import { assembleSheet } from './derive-assemble';
import { applyPluginPrePass } from './derive-plugins';
import { type SkillProficiency, type AbilityBlock } from './derive-stats';
import { ABILITIES } from './schema';
import { ABILITY_SCORE_CLAMP, type Ability } from '../rules/core';
import { type ActiveEffect, type EffectCtx, type EffectIssue } from '../effects/token-parser';
import type { ExprContext } from '../effects/expression-evaluator';
import { collectFacts, type EffectFacts, type ResourceDef } from '../effects/apply';
import { resolveActiveEffects } from '../effects/resolver';
import type { Spellcasting } from './spellcasting';
import { baseResolveState } from './derive-context';
import { computed, type Computed } from '../rules/pipeline';

// SKILL_ABILITY / SkillId live in the leaf `./skills` (so derive's sub-modules share them without a
// cycle); re-exported here so existing `$lib/character/derive` importers keep working.
import { SKILL_ABILITY, type SkillId } from './skills';
export { SKILL_ABILITY, type SkillId };
// B13 target validation moved to ./derive-targets (the closed-vocab check collectFacts runs).
import { isEffectTargetSupported } from './derive-targets';

export interface CharacterSheet {
	level: number;
	proficiencyBonus: number;
	abilities: Record<Ability, AbilityBlock>;
	skills: Record<SkillId, Computed & { prof: SkillProficiency }>;
	ac: Computed;
	initiative: Computed;
	speed: Computed;
	/** Fly / swim speeds — base 0 (no SRD species grants one); effects (`set_override:speed.fly:60`
	 *  — the Fly spell, magic items) are the source. Rendered only when nonzero. */
	flySpeed: Computed;
	swimSpeed: Computed;
	maxHp: Computed;
	/** Hit-dice pools grouped by die size (paladin 5 / fighter 5 → one d10 pool of 10; different die
	 *  sizes stay separate — RAW multiclass rule). Spent counts live in `play.hitDiceSpent` keyed by die. */
	hitDice: HitDiePool[];
	/** Passive score of every skill (10 + mod ± adv/dis, `passive.<skill>` effects folded). The play
	 *  view can pin any skill as a passive sense; the strip highlights perception/investigation/insight. */
	passives: Record<SkillId, Computed>;
	carryingCapacity: Computed;
	/** How many attacks one Attack action makes (Extra Attack and its ladder). One for most
	 *  characters; the panel only says so when a feature has raised it. */
	attacksPerAction: Computed;
	/** Damage resistances / immunities / vulnerabilities from active effects (by type). */
	damageSensitivities: { resist: string[]; immune: string[]; vulnerable: string[] };
	/** Trackable resource pools (rage, ki, item N/day…) from `grant_resource` effects. */
	resources: ResourceDef[];
	/** Piece 3: spend-options on granted resources (Ki → Flurry of Blows…), resolved from the
	 *  `resource_option` linked table for the resources this character actually has. */
	resourceOptions: ResourceOption[];
	/** Per-class casting profiles + shared/pact slot pools (empty classes = non-caster). */
	spellcasting: Spellcasting;
	/** Content refs the character points at that the graph couldn't resolve. */
	missing: string[];
	/** Per-character derive-time problems (a malformed L2 expression / guard for THIS build) — the
	 *  SPEC10 channel content-health merges with loader issues. Empty on a clean sheet. */
	deriveIssues: EffectIssue[];
	/** The guard-resolved, condition-expanded effect list (the ONE resolve stage's output) — the
	 *  roll path / action economy read THIS, never raw `play.effects` (B21). Empty when
	 *  effects-auto is off. */
	resolvedEffects: ActiveEffect[];
	/** The typed-facts view of `resolvedEffects` (parsed once, values resolved once — D7): what
	 *  every consumer outside the stat folds reads (roll path, action economy, panels). */
	facts: EffectFacts;
	/** The post-derive L2 snapshot ctx (final build vars + live play getters), for CAST-TIME evaluation
	 *  that needs sheet vars plus the ephemeral `slot`/`spell_level` — upcast wraps it with
	 *  `withCastSlot` (UPCAST §4/§5). `undefined` when effects-auto is off (N6: no auto-scaling — the
	 *  cast falls back to base damage + prose), so a consumer gates on its presence. */
	castCtx?: ExprContext;
}

/** A4: armor with the stealth-disadvantage flag synthesizes a `disadvantage:skill.stealth` FACT so
 *  it reaches BOTH the hover note and the actual Hide roll (deduped by target+source, like a token). */
export function deriveSheet(
	character: Character,
	graph: ContentGraph,
	// B15: source/collision filter. Kept a PARAMETER (not an import) so derive stays framework-
	// agnostic and testable; the VMs pass `isRowActive` (reactive over the source config), tests
	// default to all-active. Applied once at gather, never per-stat.
	isActive: (row: LoadedRow) => boolean = () => true,
): CharacterSheet {
	const missing: string[] = [];
	const issues: EffectIssue[] = [];
	// effects-auto global toggle: off → no effect layers (base stats / text only)
	const active = character.play.autoCalc
		? gatherEffects({ character, graph, isActive, missing, issues })
		: [];

	const setup = prepareDerive(character, graph);
	const { level, proficiencyBonus: prof, abilityBase, classLevels } = setup;
	const { hpMaxBaseFor, expandCondition, makeCtx } = setup;

	// The ONE resolve stage (effects/dependency-graph.ts): dependency-ordered guards, A10 ability pipeline,
	// condition expansion — every consumer below reads its output.
	let effCtx: EffectCtx | undefined;
	let resolvedEffects: ActiveEffect[] = [];
	let abilityComputed: Record<Ability, Computed>;
	let maxHpBase: Computed;
	if (character.play.autoCalc) {
		const r = resolveActiveEffects({
			active,
			makeCtx,
			expandCondition,
			abilityBase,
			hpMaxBase: hpMaxBaseFor,
			resourcesSpent: character.play.resourcesSpent,
		});
		issues.push(...r.issues);
		effCtx = r.ctx;
		resolvedEffects = r.effects;
		abilityComputed = r.abilities;
		maxHpBase = r.hpMaxBase;
	} else {
		abilityComputed = recordOf(ABILITIES, (ab) => computed(abilityBase[ab], ABILITY_SCORE_CLAMP));
		maxHpBase = computed(hpMaxBaseFor(abilityComputed.con.value), { min: 1 });
	}
	const scores = recordOf(ABILITIES, (ab) => abilityComputed[ab].value);
	// Auto-calc OFF gates the effect LAYERS (Bless / Rage / conditions), NOT the spell's OWN mechanics:
	// with no resolve stage there's no `effCtx`, but upcast + resource-option formulas still need the L2
	// ctx (so a higher-slot cast scales its dice in manual mode, like cantrip die-scaling already does).
	// Build it from the base state — the same `makeCtx` factory, fed base scores.
	if (!effCtx) effCtx = makeCtx(baseResolveState(scores, maxHpBase.value));

	// the ONE typed-facts object (D7): every token parsed + value-resolved once; every consumer
	// below (and the roll path / action economy through the sheet) reads THIS, never a re-scan.
	const facts = collectFacts(resolvedEffects, effCtx, issues, isEffectTargetSupported);
	// L3 plugin PRE-PASS (stage 2½ — between resolve and the fold); a no-op with no plugin tokens.
	if (character.play.autoCalc && resolvedEffects.length)
		applyPluginPrePass({
			character,
			resolvedEffects,
			scores,
			prof,
			level,
			classLevels,
			facts,
			effCtx,
			expandCondition,
			maxHpBase,
			issues,
		});

	return assembleSheet({
		character,
		graph,
		isActive,
		setup,
		state: { effCtx, resolvedEffects, abilityComputed, scores, maxHpBase, facts },
		missing,
		issues,
	});
}
