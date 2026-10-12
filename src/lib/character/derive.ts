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
import type { SkillProficiency } from './granted-proficiency';
import {
	type AbilityBlock,
	type ToolProficiency,
	type IncomingAttack,
	type QualifiedDefense,
} from './derive-stats';
import { ABILITIES } from './schema';
import { ABILITY_SCORE_CLAMP, type Ability } from '../rules/core';
import { type ActiveEffect, type EffectCtx, type EffectIssue } from '../effects/token-parser';
import type { ExprContext } from '../effects/expression-evaluator';
import { collectFacts, type EffectFacts, type ResourceDef } from '../effects/apply';
import { resolveActiveEffects } from '../effects/resolver';
import type { Spellcasting } from './spellcasting';
import { baseResolveState } from './derive-context';
import { activeForm, formHasSense, withoutForm, type MonsterRow } from './forms';
import { rowName } from '../content/loader';
import { computed, SOURCE_KEY, type Computed } from '../rules/pipeline';

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
	/** Tools this character is proficient with — the only ones with a number to show, since a tool
	 *  you lack is a plain ability check. The CHECK is composed at the roll (`toolCheck`), because in
	 *  5e the ability is the table's to pick and so cannot be folded here. */
	tools: ToolProficiency[];
	ac: Computed;
	initiative: Computed;
	/** The lowest d20 face that can be a critical hit — 20 for everyone RAW, lower for a Champion. It
	 *  decides the roll's HIGHLIGHT, never whether a hit crits (that stays the player's call). */
	critThreshold: Computed;
	speed: Computed;
	/** Fly / swim / climb speeds — base 0 (no SRD species grants one); effects are the source, as a
	 *  literal (`set_override:speed.swim:40`) or as the walking speed itself
	 *  (`set_override:speed.climb:speed:floor`). Rendered only when nonzero. */
	flySpeed: Computed;
	swimSpeed: Computed;
	climbSpeed: Computed;
	/** Senses and how far each reaches, keyed by the bare name (`darkvision`). Discovered from the
	 *  effects that grant one rather than fixed, because a sense NAME is open vocabulary; two sources
	 *  take the greater range (the rows say `:floor`), so a Goggles-wearing dwarf reads 120, not 180. */
	senses: Record<string, Computed>;
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
	/** Conditions this character cannot be given (`condition_immunity`), as state-row ids. */
	conditionImmunities: string[];
	/** What an ATTACKER rolling at this character gets (`attacked`). Stated, never folded — we do not
	 *  roll the monster's dice, so no roll on this sheet changes because of it. */
	incomingAttacks: IncomingAttack[];
	/** What is true only IN A CASE — "+2 AC against ranged attacks", "advantage on saves against
	 *  spells". Stated rather than folded: the app cannot tell what a save is against. */
	qualifiedDefenses: QualifiedDefense[];
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
	const { expandCondition, makeCtx } = setup;
	// A form replaces Constitution and leaves the character's hit points alone, so while one is
	// assumed the hit-point base is worked out from the Constitution they have WITHOUT it.
	const form = activeForm(character, graph, isActive);
	const ownCon = form
		? deriveSheet(withoutForm(character), graph, isActive).abilities.con.score.value
		: undefined;
	const hpMaxBaseFor = ownCon === undefined ? setup.hpMaxBaseFor : () => setup.hpMaxBaseFor(ownCon);

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

	const sheet = assembleSheet({
		character,
		graph,
		isActive,
		setup,
		state: { effCtx, resolvedEffects, abilityComputed, scores, maxHpBase, facts },
		missing,
		issues,
	});
	return form ? inForm(sheet, form.row, form.state) : sheet;
}

/**
 * What being in a form changes about the sheet that is NOT a number the form's own tokens fold:
 * whose hit points are being counted, whether spells can be cast, and which of the character's
 * special senses are still theirs to use.
 *
 * A form with hit points of its own (`hpBefore` is the character's, waiting) counts the stat
 * block's: its maximum is the row's `hp` and nothing else, because "you assume the beast's hit
 * points" leaves no room for the character's own bonuses to them.
 *
 * A form that allows `only_senses` leaves the character a sense when the stat block lists it too —
 * that one is the higher of the two, which the form's floor already folded — and none otherwise. A
 * sense it takes keeps its trace and ends on the form's own line, so the 0 says who set it.
 */
function inForm(
	sheet: CharacterSheet,
	row: MonsterRow,
	state: NonNullable<Character['play']['form']>,
): CharacterSheet {
	const source = rowName(row);
	const rules = sheet.facts.forms.find((form) => form.id === state.id);
	const casts = rules?.casts ?? false;
	const senses = rules?.onlySenses
		? Object.fromEntries(
				Object.entries(sheet.senses).map(([name, sense]) => [
					name,
					formHasSense(row, name)
						? sense
						: computed(
								[
									...sense.trace,
									{
										source,
										layer: 'override' as const,
										op: 'set' as const,
										amount: 0,
										noteKey: SOURCE_KEY.formLacksSense,
									},
								],
								{ min: 0 },
							),
				]),
			)
		: sheet.senses;
	const ownHp = state.hpBefore !== undefined && row.data.hp != null;
	return {
		...sheet,
		...(ownHp
			? {
					maxHp: computed([{ source, layer: 'override', op: 'set', amount: Number(row.data.hp) }], {
						min: 1,
					}),
				}
			: {}),
		spellcasting: casts ? sheet.spellcasting : { ...sheet.spellcasting, formBlock: { source } },
		senses,
	};
}
