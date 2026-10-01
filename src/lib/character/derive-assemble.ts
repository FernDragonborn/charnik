/*
 * The second half of a derive: everything AFTER the fold. The resolve stage hands over the effective
 * scores, the facts and the ctx; this turns them into the `CharacterSheet` the UI renders — the stat
 * phases, the armor/condition corrections that read what the fold produced, and the assembly itself.
 *
 * Split from `derive.ts` for size: the orchestrator there is now gather → prepare → resolve →
 * assemble, and this file is the last step.
 */
import type { SaidText } from '$lib/util/say';
import { ISSUE_KEY } from '$lib/effects/token-parser';
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { Character } from './schema';
import { resolveResourceOptions } from './derive-resource-options';
import { hitDicePools, type DeriveSetup } from './derive-setup';
import { gatherGrantedProficiencies, grantedEquipmentProfs } from './granted-proficiency';
import {
	resolveClassSaves,
	deriveAbilityBlocks,
	deriveSkills,
	deriveTools,
	deriveAc,
	deriveSpeed,
	derivePassives,
	deriveConditionImmunities,
	deriveIncomingAttacks,
	deriveQualifiedDefenses,
	deriveDamageSensitivities,
	deriveSenses,
	type StatInputs,
} from './derive-stats';
import {
	initiative as initiativeOf,
	attacksPerAction as attacksPerActionBase,
	critThreshold as critThresholdBase,
	carryingCapacity,
	type Ability,
} from '../rules/core';
import { gatherProfGrants, isArmorProficient, withGrantedProfs } from '../rules/proficiency';
import { ITEM_TAG } from '../content/item-tags';
import { TOOL_ITEM_CATEGORY } from '../content/schemas';
import { conditionRows } from '../content/states';
import { armorCategoryOf, type ResolvedItem } from '../content/resolved-item';
import { resourceNames, namedResources } from './resource-names';
import {
	type EffectCtx,
	type EffectIssue,
	type ActiveEffect,
	ctxOf,
	parseToken,
	resolveEffectValue,
} from '../effects/token-parser';
import { applyEffects, type EffectFacts, type NumericFact } from '../effects/apply';
import { NO_VARS, withWalkingSpeed, type ExprContext } from '../effects/context';
import { collectExprVariables } from '../effects/expression-evaluator';
import { MOVEMENT_MODE_PREFIX, WALKING_SPEED_VAR } from '../effects/expression-parser';
import { suggestClosest } from '../util/suggest';
import { deriveSpellcasting, type Spellcasting } from './spellcasting';
import { computed, type Computed, type System } from '../rules/pipeline';
import type { CharacterSheet } from './derive';

function applyStealthDisadvantage(
	equippedArmor: ResolvedItem | undefined,
	facts: EffectFacts,
): void {
	if (!equippedArmor?.tags.has(ITEM_TAG.stealthDisadvantage)) return;
	const source = equippedArmor.row.data.name_en;
	if (!facts.disadvantage.some((d) => d.target === 'skill.stealth' && d.source === source))
		facts.disadvantage.push({ target: 'skill.stealth', source });
}

/** The unknown-condition sentence and its values: a guess when one is close, the plain wording when
 *  none is. */
function conditionSaid(id: string, known: Iterable<string>): SaidText {
	const options = suggestClosest(id, known);
	return {
		key: options.length ? ISSUE_KEY.unknownConditionSuggested : ISSUE_KEY.unknownCondition,
		values: { id, ...(options.length ? { options: { options } } : {}) },
	};
}

/** A16: an `apply_condition:<id>` whose condition has no row in the active edition would set a
 *  PHANTOM flag silently (a typo'd id matches nothing). Surface it as a content-health issue with a
 *  did-you-mean. A real edition-matched condition with an empty effects column is legitimate. */
function flagPhantomConditions(
	facts: EffectFacts,
	graph: ContentGraph,
	system: System,
	issues: EffectIssue[],
): void {
	const conditionIds = new Set(conditionRows(graph, system).map((r) => r.id));
	for (const id of facts.conditions)
		if (!conditionIds.has(id))
			issues.push({
				source: 'apply_condition',
				token: `apply_condition:${id}`,
				// PLG-9
				...conditionSaid(id, conditionIds),
				detail: `apply_condition: unknown condition "${id}"`,
			});
}

interface ArmorSpellBlockInput {
	spellcasting: Spellcasting;
	equippedArmor: ResolvedItem | undefined;
	build: Character['build'];
	graph: ContentGraph;
	facts: EffectFacts;
	issues: EffectIssue[];
}

/** B9: worn armor you lack proficiency with blocks spellcasting (RAW canonical rule-block). Grants
 *  come from the character's classes plus any feature that granted one; lenient — undeclared classes
 *  stay proficient with all armor. */
function applyArmorSpellBlock({
	spellcasting,
	equippedArmor,
	build,
	graph,
	facts,
	issues,
}: ArmorSpellBlockInput): void {
	if (!equippedArmor) return;
	const armorGrants = withGrantedProfs(
		gatherProfGrants(
			build.classes.map((c) => {
				const r = graph.get(c.class);
				return r?.type === 'class' ? r.data.armor_profs : undefined;
			}),
		),
		grantedEquipmentProfs(facts).armor,
	);
	// an unclassifiable armor never blocks (isArmorProficient says true), so past this line the weight
	// class is always known — the guard is what narrows it, not a comment
	const cat = armorCategoryOf(equippedArmor);
	if (cat === undefined || isArmorProficient(armorGrants, cat)) return;
	const source = equippedArmor.row.data.name_en;
	// the armor's WEIGHT, not a sentence about it: the two panels that say so and the issue below all
	// word it themselves, in the reader's language
	spellcasting.armorBlock = { source, category: cat };
	issues.push({
		source,
		token: 'armor_proficiency',
		key: ISSUE_KEY.armorBlocksCasting,
		values: { category: { catalog: 'armorCategory', id: cat } },
	});
}

/**
 * The facts the movement modes fold from: every numeric fact as it stands, except a movement mode
 * whose value reads the walking speed, which is resolved HERE against a ctx that finally knows it.
 * The first collection read that variable as absent, so such a fact arrives holding 0.
 *
 * Resolved against the base ctx, not the carrying effect's own: a fact does not keep its effect, and
 * the two things an effect scopes (`spellcasting_mod`, `item_bonus`) have no place in a speed.
 */
function movementModeFacts(facts: EffectFacts, ctx: ExprContext): EffectFacts {
	const numeric = facts.numeric.map((fact): NumericFact => {
		if (!fact.target.startsWith(MOVEMENT_MODE_PREFIX)) return fact;
		const parsed = parseToken(fact.token);
		if (!parsed.valueExpr || !collectExprVariables(parsed.valueExpr).includes(WALKING_SPEED_VAR))
			return fact;
		const { target, op, layer, source, token } = fact;
		const value = resolveEffectValue(parsed, ctx);
		return {
			target,
			op,
			layer,
			source,
			token,
			...(value.amount !== undefined
				? { amount: value.amount }
				: { error: value.error ?? 'no value' }),
		};
	});
	return { ...facts, numeric };
}

/** The movement modes: no SRD species grants a base, so each fold starts at 0 and effects are the
 *  source. `ctx` is the one that knows the walking speed, which is why this runs after it folds. */
function deriveMovementModes(
	facts: EffectFacts,
	ctx: ExprContext,
): Pick<CharacterSheet, 'flySpeed' | 'swimSpeed' | 'climbSpeed'> {
	const movementFacts = movementModeFacts(facts, ctx);
	const speedOf = (mode: 'fly' | 'swim' | 'climb') =>
		applyEffects(`${MOVEMENT_MODE_PREFIX}${mode}`, computed([], { min: 0 }), movementFacts);
	return { flySpeed: speedOf('fly'), swimSpeed: speedOf('swim'), climbSpeed: speedOf('climb') };
}

/** What the resolve stage produced — the state every phase below reads. */
interface ResolvedState {
	effCtx: EffectCtx;
	resolvedEffects: ActiveEffect[];
	abilityComputed: Record<Ability, Computed>;
	scores: Record<Ability, number>;
	maxHpBase: Computed;
	facts: EffectFacts;
}

/** The inputs assembly needs beyond that state: what was loaded, what was asked for, and the two
 *  accumulators the whole derive has been filling. */
export interface AssembleInput {
	character: Character;
	graph: ContentGraph;
	isActive: (row: LoadedRow) => boolean;
	setup: DeriveSetup;
	state: ResolvedState;
	missing: string[];
	issues: EffectIssue[];
}

export function assembleSheet(input: AssembleInput): CharacterSheet {
	const { character, graph, isActive, setup, state, missing, issues } = input;
	const { facts, scores, abilityComputed, maxHpBase, effCtx, resolvedEffects } = state;
	const {
		level,
		proficiencyBonus: prof,
		equippedArmor,
		equippedShield,
		speciesRow,
		baseSpeed,
	} = setup;
	const build = character.build;
	const system = character.system;
	const poolNames = resourceNames(graph, system, isActive);

	applyStealthDisadvantage(equippedArmor, facts); // A4
	flagPhantomConditions(facts, graph, system, issues); // A16

	// spellcasting AFTER the resolve, so DCs/attacks read the EFFECTIVE scores (a Headband of
	// Intellect moves the wizard's DC, as it should) — and `spell_dc`/`spell_attack` effects fold in.
	const spellcasting = deriveSpellcasting({ character, graph, scores, facts, issues });

	applyArmorSpellBlock({ spellcasting, equippedArmor, build, graph, facts, issues }); // B9

	// stat phases — each reads the shared computed inputs (build/scores/level/facts); see the pure
	// helpers in derive-stats.ts.
	const statInputs: StatInputs = { build, scores, level, facts };
	const { grantedSaves, grantedSkills } = gatherGrantedProficiencies(facts);
	const classSaves = resolveClassSaves(build, graph, grantedSaves, missing);
	const abilities = deriveAbilityBlocks(statInputs, abilityComputed, classSaves, grantedSkills);
	const skills = deriveSkills(statInputs, grantedSkills);
	const tools = deriveTools(
		statInputs,
		graph
			.list('item', { system })
			.filter((r) => r.data.category === TOOL_ITEM_CATEGORY && isActive(r)),
	);
	const ac = deriveAc(statInputs, equippedArmor, equippedShield);

	// HP: the base fold came out of the resolve stage (recomputed at the final CON); hp_max flows
	// through the seam like every other stat (Toughness, Aid → `flat_bonus:hp_max+N`).
	const maxHp = applyEffects('hp_max', maxHpBase, facts);

	// the base L2 ctx (a bare synthetic effect — no per-effect spellcasting scoping): resource-option
	// formulas resolve against it here, AND it's the post-derive snapshot the cast layer wraps for
	// upcast (UPCAST §5). Always present now — built from base state even with auto-calc off (the toggle
	// gates effect LAYERS, not spell mechanics like upcast; N6).
	const baseCtx = ctxOf(effCtx, { source: '', layer: 'feature', tokens: [] });

	const speed = deriveSpeed(statInputs, speciesRow, baseSpeed, equippedArmor);

	const damageSensitivities = deriveDamageSensitivities(facts);
	const conditionImmunities = deriveConditionImmunities(facts);
	const incomingAttacks = deriveIncomingAttacks(facts);
	const qualifiedDefenses = deriveQualifiedDefenses(facts);
	const senses = deriveSenses(facts);

	return {
		level,
		proficiencyBonus: prof,
		abilities,
		skills,
		tools,
		ac,
		initiative: applyEffects('initiative', initiativeOf({ dexScore: scores.dex }), facts),
		critThreshold: applyEffects('crit_threshold', critThresholdBase(), facts),
		speed,
		...deriveMovementModes(facts, withWalkingSpeed(baseCtx ?? NO_VARS, speed.value)),
		maxHp,
		hitDice: hitDicePools(build, graph),
		passives: derivePassives(skills, facts),
		carryingCapacity: carryingCapacity({ strScore: scores.str, system }),
		attacksPerAction: applyEffects('attacks', attacksPerActionBase(), facts),
		damageSensitivities,
		conditionImmunities,
		incomingAttacks,
		qualifiedDefenses,
		senses,
		resources: namedResources(facts.resources, poolNames),
		resourceOptions: resolveResourceOptions({
			graph,
			resourceIds: new Set(facts.resources.map((r) => r.id)),
			poolNames,
			system,
			isActive,
			issues,
			// the base L2 ctx (resource-option formulas don't use per-effect spellcasting scoping), so
			// `heal:`/`roll:` formulas resolve once here like resource maxes
			ctx: baseCtx,
		}),
		spellcasting,
		missing: [...new Set(missing)], // dedupe: the same ref can be missing from several scans (D19)
		deriveIssues: issues,
		resolvedEffects,
		facts,
		...(baseCtx ? { castCtx: baseCtx } : {}),
	};
}
