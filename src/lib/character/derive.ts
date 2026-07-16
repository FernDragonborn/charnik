/*
 * The aggregator: character + loaded content + rules core + effects engine → the full set
 * of derived stats a sheet renders. One call, `deriveSheet(character, graph)`.
 *
 * This is the glue seam — it resolves the character's `type:source:id` refs against the
 * content graph, runs the pure rules math on the resulting numbers, and layers active
 * effects through `applyEffects`. Ability-score bonuses (e.g. a species +2 CON) cascade
 * FIRST (score → modifier → everything downstream); flat stat bonuses (AC, saves, …) layer
 * per-stat after. Missing referenced content is skipped gracefully (loader already flagged
 * it) — the sheet computes with what it can.
 *
 * Every field is a `Computed` ({value, trace, notes}), so the UI explains any number.
 */
import { tokensOf, type ContentGraph, type LoadedRow, type LoadedRowOf } from '../content/loader';
import type { Character } from './schema';
import { ABILITIES } from './schema';
import {
	abilityModifier,
	proficiencyBonus,
	savingThrow,
	skillCheck,
	passiveScore,
	initiative as initiativeOf,
	unarmoredAC,
	armoredAC,
	maxHpForClass,
	carryingCapacity,
	type Ability
} from '../rules/core';
import {
	applyEffects,
	collectResources,
	resolveActiveEffects,
	splitGuard,
	parseEffect,
	matchesTarget,
	EFFECT_KIND,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue,
	type ResolvedEffects,
	type ResourceDef
} from '../effects/index';
import { deriveSpellcasting, type Spellcasting } from './spellcasting';
import {
	makeExprContext,
	withSpellcastingMod,
	type BuildVars,
	type PlayVars
} from '../effects/context';
import type { ExprContext } from '../effects/expr';
import type { Computed, Layer, System } from '../rules/pipeline';

/** Skill → its governing ability (the 18 SRD skills). */
// `as const satisfies` so the KEYS form the `SkillId` union (not widened to `string`) while the
// values are still checked to be `Ability`. This lets the skills map be keyed by `SkillId`, so
// indexing it with a known skill id is sound (no `T | undefined`, no non-null assertions).
export const SKILL_ABILITY = {
	acrobatics: 'dex',
	animal_handling: 'wis',
	arcana: 'int',
	athletics: 'str',
	deception: 'cha',
	history: 'int',
	insight: 'wis',
	intimidation: 'cha',
	investigation: 'int',
	medicine: 'wis',
	nature: 'int',
	perception: 'wis',
	performance: 'cha',
	persuasion: 'cha',
	religion: 'int',
	sleight_of_hand: 'dex',
	stealth: 'dex',
	survival: 'wis'
} as const satisfies Record<string, Ability>;

/** The 18 SRD skill ids. */
export type SkillId = keyof typeof SKILL_ABILITY;

/** Skill proficiency level (a level, not two booleans): none → half (Jack of All Trades) →
 *  proficient → expertise (×2). */
type SkillProficiency = 'none' | 'half' | 'proficient' | 'expertise';
const PROF_ORDER: Record<SkillProficiency, number> = {
	none: 0,
	half: 1,
	proficient: 2,
	expertise: 3
};
/** The higher rung of the proficiency ladder — sources combine by MAX, never by flag-union, so
 *  "expertise without proficiency" is unrepresentable. */
const maxProf = (a: SkillProficiency, b: SkillProficiency): SkillProficiency =>
	PROF_ORDER[a] >= PROF_ORDER[b] ? a : b;

interface AbilityBlock {
	score: number;
	baseScore: number;
	mod: number;
	save: Computed;
}

export interface CharacterSheet {
	level: number;
	proficiencyBonus: number;
	abilities: Record<Ability, AbilityBlock>;
	skills: Record<SkillId, Computed & { prof: SkillProficiency }>;
	ac: Computed;
	initiative: Computed;
	speed: Computed;
	maxHp: Computed;
	passives: Record<'perception' | 'investigation' | 'insight', Computed>;
	carryingCapacity: Computed;
	/** Damage resistances / immunities / vulnerabilities from active effects (by type). */
	defenses: { resist: string[]; immune: string[]; vulnerable: string[] };
	/** Trackable resource pools (rage, ki, item N/day…) from `grant_resource` effects. */
	resources: ResourceDef[];
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
}

/** The condition id the `is_raging` L2 flag reads. A named seam, not scattered string compares —
 *  goes away when conditions-as-data lands a var→condition mapping (PLAN EXPR, AUDIT B2). */
const RAGE_CONDITION_ID = 'rage';

/** Armor weight class of the equipped armor (for the `armor_type` guard variable); no armor → none. */
function armorWeightOf(row: LoadedRowOf<'item'> | undefined): PlayVars['armorType'] {
	const t = String(row?.data.item_type ?? '').toLowerCase();
	if (t.includes('heavy')) return 'heavy';
	if (t.includes('medium')) return 'medium';
	if (t.includes('light')) return 'light';
	return 'none';
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);

/** Gather every active effect (species/items/runtime) as {source, layer, tokens}. */
function gatherEffects(
	character: Character,
	graph: ContentGraph,
	missing: string[]
): ActiveEffect[] {
	const active: ActiveEffect[] = [];
	const resolve = (ref: string | undefined) => {
		if (!ref) return undefined;
		const row = graph.get(ref);
		if (!row) missing.push(ref);
		return row;
	};
	/** Push a row's tokens as one active effect (skipping token-less rows). `classId` marks
	 *  class-borne effects so their `spellcasting_mod` reads THAT class's mod (SPEC4). */
	const pushRow = (row: LoadedRow | undefined, layer: Layer, classId?: string): void => {
		const tokens = tokensOf(row);
		if (!row || !tokens.length) return;
		active.push({
			source: String(row.data.name_en),
			layer,
			tokens,
			...(classId !== undefined ? { classId } : {})
		});
	};

	pushRow(resolve(character.build.species), 'feature');
	// species sub-option (subrace / lineage) — its ASI + traits cascade like the species' own
	pushRow(resolve(character.build.speciesOption), 'feature');
	pushRow(resolve(character.build.background), 'feature');

	// class + subclass: the class row's own tokens, its base features up to the class level, the
	// chosen subclass row, and that subclass's features (same level gate). Features are matched by
	// class_id within the CLASS ROW'S source + the character's edition, so a 5e and a 5.5e feature
	// table for the same class can coexist without double-applying.
	for (const entry of character.build.classes) {
		const classRow = resolve(entry.class);
		pushRow(classRow, 'feature', classRow?.id);
		const subclassRow = resolve(entry.subclass);
		pushRow(subclassRow, 'feature', classRow?.id);
		if (!classRow) continue;
		for (const f of graph.rows) {
			if (f.type !== 'class_feature' || f.source !== classRow.source) continue;
			if (f.data.class_id !== classRow.id || Number(f.data.level) > entry.level) continue;
			if (!f.systems.includes(character.system)) continue;
			// base feature (no subclass_id) always applies; a subclass feature only for the chosen one
			const forSubclass = f.data.subclass_id;
			if (forSubclass && forSubclass !== (subclassRow?.type === 'subclass' ? subclassRow.id : ''))
				continue;
			pushRow(f, 'feature', classRow.id);
		}
	}

	// feats (incl. repeatable ones taken more than once → their effect applies each time)
	for (const featRef of character.build.feats) pushRow(resolve(featRef), 'feature');

	for (const inv of character.build.inventory) {
		if (!inv.equipped && !inv.attuned) continue;
		pushRow(resolve(inv.item), 'item');
	}

	for (const eff of character.play.effects) {
		if (eff.effects.length)
			active.push({ source: eff.label, layer: 'condition', tokens: eff.effects });
	}
	// NOTE: guard evaluation + `apply_condition` expansion happen in the ONE resolve stage
	// (`resolveActiveEffects`, EXPR-3), not here — so guards gate a token BEFORE its condition is
	// expanded (SPEC7 order) and every consumer reads the same resolved list.
	return active;
}

/** Sum flat_bonus tokens that target a given ability score (the cascade layer).
 *
 *  Ability scores are computed BEFORE the expression ctx exists (scores feed the ctx — SPEC2's
 *  two-stage cascade), so only LITERAL, UNGUARDED bonuses can apply here; a guarded or
 *  expression-valued ability token awaits the dependency DAG (deferred, PLAN EXPR-3) and a
 *  `set_override` on a score bypasses the pipeline entirely (AUDIT A10). None of those may vanish
 *  SILENTLY — each unsupported token is surfaced as a derive issue. */
function abilityBonus(active: ActiveEffect[], ability: Ability, issues: EffectIssue[]): number {
	let sum = 0;
	for (const eff of active) {
		for (const t of eff.tokens) {
			const g = splitGuard(t);
			const p = parseEffect(g.token);
			if (p.target !== ability) continue;
			if (p.kind === EFFECT_KIND.flatBonus) {
				if (g.guard !== undefined)
					issues.push({
						source: eff.source,
						token: t,
						reason: 'a guard on an ability-score bonus is not supported yet — not applied'
					});
				else if (p.valueExpr !== undefined)
					issues.push({
						source: eff.source,
						token: t,
						reason: 'an expression on an ability-score bonus is not supported yet — not applied'
					});
				else if (p.amount !== undefined) sum += p.amount;
			} else if (p.kind === EFFECT_KIND.setOverride) {
				issues.push({
					source: eff.source,
					token: t,
					reason: 'set_override on an ability score is not supported yet — not applied'
				});
			}
		}
	}
	return sum;
}

export function deriveSheet(character: Character, graph: ContentGraph): CharacterSheet {
	const build = character.build;
	const system = character.system as System;
	const missing: string[] = [];
	const issues: EffectIssue[] = [];
	// effects-auto global toggle: off → no effect layers (base stats / text only)
	const active = character.play.autoCalc ? gatherEffects(character, graph, missing) : [];

	const level = build.classes.reduce((n, c) => n + c.level, 0) || 1;
	const prof = proficiencyBonus(level);

	// effective ability scores (base + allocated boosts + score-targeting effects), downstream
	const scores = {} as Record<Ability, number>;
	for (const ab of ABILITIES)
		scores[ab] =
			build.abilities[ab] + (build.abilityBoosts?.[ab] ?? 0) + abilityBonus(active, ab, issues);

	// L2/L3 expression context. Class levels keyed by BARE id (`class_level.monk`); spellcasting
	// computed up-front so `spellcasting_mod` reads the primary caster; base_speed is the species speed.
	const abilityMods = {} as Record<Ability, number>;
	for (const ab of ABILITIES) abilityMods[ab] = abilityModifier(scores[ab]);
	const classLevels: Record<string, number> = {};
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (row) classLevels[row.id] = (classLevels[row.id] ?? 0) + c.level;
	}
	const speciesRow = build.species ? graph.get(build.species) : undefined;
	const baseSpeed = num(speciesRow?.type === 'species' ? speciesRow.data.speed : undefined, 30);
	const spellcasting = deriveSpellcasting(character, graph, scores);
	const primaryCaster = spellcasting.classes.reduce<
		(typeof spellcasting.classes)[number] | undefined
	>(
		(best, c) =>
			(classLevels[c.classId] ?? 0) > (best ? (classLevels[best.classId] ?? 0) : -1) ? c : best,
		undefined
	);
	const buildVars: BuildVars = {
		level,
		proficiencyBonus: prof,
		abilityMods,
		abilityScores: scores,
		classLevels,
		spellcastingMod: primaryCaster ? abilityMods[primaryCaster.ability] : 0,
		baseSpeed
	};

	// base max HP (pre-effect) — computed EARLY because the play ctx's `hp_max`/`hp_percent`/
	// `is_bloodied` guards read it (§8.4). classes[0] grants the max hit die; multiclasses avg-up (RAW).
	const hpContribs = build.classes.map((c, i) => {
		const row = graph.get(c.class);
		const hitDie = String((row?.type === 'class' ? row.data.hit_die : undefined) || 'd8');
		return maxHpForClass({
			hitDie,
			level: c.level,
			conScore: scores.con,
			includesCharacterLevel1: i === 0
		});
	});
	const maxHpBase: Computed = hpContribs.length
		? {
				value: hpContribs.reduce((n, h) => n + h.value, 0),
				trace: hpContribs.flatMap((h) => h.trace)
			}
		: maxHpForClass({ hitDie: 'd8', level, conScore: scores.con, includesCharacterLevel1: true });

	// equipped armor — shared by the AC math below and the `armor_type`/`is_wearing_armor` guards.
	const equippedArmor = build.inventory
		.map((i) => (i.equipped ? graph.get(i.item) : undefined))
		.find((r): r is LoadedRowOf<'item'> => r?.type === 'item' && r.data.category === 'armor');

	// The ONE resolve stage (EXPR-3, D7/B21), run TWICE so the guard ctx is fail-closed: guards may
	// read conditions/resources, but which conditions/resources are active is itself guard-gated.
	// Pass 1 evaluates guards against an EMPTY condition/resource state (so `has_condition.x ?
	// apply_condition:x` can't self-fulfil and a false-guarded rage never sets `is_raging`); the
	// conditions + resource pools its SURVIVORS grant then feed the pass-2 ctx every consumer reads.
	// One feedback level, matching the one-level condition expansion; a guarded effect that RAISES
	// hp_max is still not fed back (the rare DAG case, deferred per the spec).
	let effCtx: EffectCtx | undefined;
	let resolved: ResolvedEffects = { effects: [], issues: [] };
	if (character.play.autoCalc) {
		// per-class `spellcasting_mod` (SPEC4): a token carried by a class's row/feature reads THAT
		// class's casting mod; anything else (feat/item/species/runtime) reads the primary caster's
		const modByClass: Record<string, number> = {};
		for (const sc of spellcasting.classes) modByClass[sc.classId] = abilityMods[sc.ability];
		const scopeCtx = (base: ExprContext): ((eff: ActiveEffect) => ExprContext) => {
			const scoped = new Map<string, ExprContext>();
			return (eff) => {
				const id = eff.classId;
				if (!id || !Object.hasOwn(modByClass, id)) return base;
				let c = scoped.get(id);
				if (!c) {
					c = withSpellcastingMod(base, modByClass[id] ?? 0);
					scoped.set(id, c);
				}
				return c;
			};
		};

		const expandCondition = (condId: string) => {
			const cond = graph.rows.find((r) => r.type === 'condition' && r.id === condId);
			const toks = tokensOf(cond);
			return cond && toks.length ? { source: String(cond.data.name_en), tokens: toks } : undefined;
		};

		const hpMaxGuard = character.play.hp.max ?? maxHpBase.value;
		const playVarsWith = (
			conditions: ReadonlySet<string>,
			resources: Record<string, number>,
			resourceMax: Record<string, number>
		): PlayVars => ({
			hp: character.play.hp.current,
			hpMax: hpMaxGuard,
			tempHp: character.play.hp.temp,
			exhaustion: character.play.exhaustion,
			flags: {
				is_bloodied: character.play.hp.current <= hpMaxGuard / 2,
				is_concentrating: character.play.concentration != null,
				is_wearing_shield: character.play.shieldRaised,
				is_wearing_armor: !!equippedArmor,
				is_raging: conditions.has(RAGE_CONDITION_ID)
			},
			conditions,
			resources,
			resourceMax,
			armorType: armorWeightOf(equippedArmor),
			size: String(speciesRow?.type === 'species' ? speciesRow.data.size : 'medium')
		});

		// pass 1 — bootstrap: empty condition/resource state; issues discarded (pass 2 re-reports)
		const ctx0 = makeExprContext(buildVars, playVarsWith(new Set(), {}, {}));
		const pass1 = resolveActiveEffects(active, scopeCtx(ctx0), expandCondition);
		const conditions = new Set<string>();
		for (const eff of pass1.effects)
			for (const t of eff.tokens) {
				const p = parseEffect(t);
				if (p.kind === EFFECT_KIND.applyCondition && p.target) conditions.add(p.target.trim());
			}
		const resources: Record<string, number> = {};
		const resourceMax: Record<string, number> = {};
		for (const r of collectResources(pass1.effects, scopeCtx(ctx0))) {
			resourceMax[r.id] = r.max;
			resources[r.id] = Math.max(0, r.max - (character.play.resourcesSpent[r.id] ?? 0));
		}

		// pass 2 — the authoritative resolve every consumer below reads
		const ctx1 = makeExprContext(buildVars, playVarsWith(conditions, resources, resourceMax));
		effCtx = scopeCtx(ctx1);
		resolved = resolveActiveEffects(active, effCtx, expandCondition);
		issues.push(...resolved.issues);
	}

	// proficiencies granted by effects (item/feat/feature): `grant_proficiency:[expertise:]<target>`
	// where target is a save (`con` / `save.con`) or a skill id (`stealth` — the parser already
	// stripped any `skill.` prefix). Skills collect the granted LEVEL (max of the ladder); saves are
	// proficient-or-not (expertise doesn't apply to saves — a granted 'expertise' still just means
	// proficient there).
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Map<string, SkillProficiency>();
	for (const eff of resolved.effects)
		for (const t of eff.tokens) {
			const p = parseEffect(t);
			if (p.kind !== EFFECT_KIND.grantProficiency || !p.target) continue;
			const raw = p.target.trim();
			const tgt = raw.replace(/^save\./, '');
			if ((ABILITIES as readonly string[]).includes(tgt)) grantedSaves.add(tgt as Ability);
			else
				grantedSkills.set(
					raw,
					maxProf(grantedSkills.get(raw) ?? 'none', p.proficiency ?? 'proficient')
				);
		}

	// saves: proficient if the ability is in build.saves (or any class's saves), or effect-granted
	const classSaves = new Set<Ability>([...(build.saves as Ability[]), ...grantedSaves]);
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (!row) missing.push(c.class);
		const s = row?.type === 'class' ? row.data.saves : undefined;
		if (Array.isArray(s)) for (const a of s) classSaves.add(a);
	}

	const abilities = {} as Record<Ability, AbilityBlock>;
	for (const ab of ABILITIES) {
		const base = savingThrow({
			ability: ab,
			score: scores[ab],
			level,
			proficient: classSaves.has(ab)
		});
		abilities[ab] = {
			score: scores[ab],
			baseScore: build.abilities[ab],
			mod: abilityModifier(scores[ab]),
			save: applyEffects(`save.${ab}`, base, resolved.effects, effCtx)
		};
	}

	// skills: the BUILD's chosen level (expertise requires the chosen proficiency — Rogue/Bard)
	// combines with the effect-granted level by MAX on the one ladder; the math flags derive from
	// that single level, so no boolean combination can express an invalid state.
	const chosenProf = new Set(build.skills);
	const chosenExpert = new Set(build.expertise ?? []);
	const skills = {} as Record<SkillId, Computed & { prof: SkillProficiency }>;
	for (const [skill, ab] of Object.entries(SKILL_ABILITY) as [SkillId, Ability][]) {
		const chosen: SkillProficiency = chosenProf.has(skill)
			? chosenExpert.has(skill)
				? 'expertise'
				: 'proficient'
			: 'none';
		const prof = maxProf(chosen, grantedSkills.get(skill) ?? 'none');
		const base = skillCheck({
			ability: ab,
			score: scores[ab],
			level,
			proficient: prof === 'proficient',
			expertise: prof === 'expertise',
			halfProficient: prof === 'half'
		});
		skills[skill] = { ...applyEffects(`skill.${skill}`, base, resolved.effects, effCtx), prof };
	}

	// AC: equipped armor (found above for the armor_type guard) + shield, else unarmored; then effects
	let acBase: Computed;
	if (equippedArmor) {
		const capRaw = equippedArmor.data.armor_dex_cap;
		const dexCap = capRaw === '' || capRaw == null ? null : num(capRaw);
		acBase = armoredAC({ armorBaseAc: num(equippedArmor.data.ac), dexScore: scores.dex, dexCap });
	} else {
		acBase = unarmoredAC({ dexScore: scores.dex });
	}
	// shield = the play-state raised flag (the dedicated combat toggle), the single source for its
	// +2 — not the inventory equipped flag (which just says the character owns/wears one)
	if (character.play.shieldRaised)
		acBase = {
			...acBase,
			value: acBase.value + 2,
			trace: [...acBase.trace, { source: 'Shield', layer: 'item', op: 'add', amount: 2 }]
		};
	const ac = applyEffects('ac', acBase, resolved.effects, effCtx);

	// HP: `maxHpBase` computed early (above, for the hp guards). hp_max flows through the seam like
	// every other stat (Toughness, Aid → `flat_bonus:hp_max+N`).
	const maxHp = applyEffects('hp_max', maxHpBase, resolved.effects, effCtx);

	// speed from species (base_speed, computed above for the expr ctx)
	const speed = applyEffects(
		'speed',
		{
			value: baseSpeed,
			trace: [
				{
					source: speciesRow ? String(speciesRow.data.name_en) : 'Default',
					layer: 'base',
					op: 'add',
					amount: baseSpeed
				}
			]
		},
		resolved.effects,
		effCtx
	);

	const passiveOf = (skill: 'perception' | 'investigation' | 'insight') => {
		// advantage/disadvantage on the underlying check moves the passive by ±5 (both → cancel, RAW);
		// then `passive.<skill>`-targeted effects (Observant) fold in through the seam.
		let adv = false;
		let dis = false;
		for (const eff of resolved.effects)
			for (const t of eff.tokens) {
				const p = parseEffect(t);
				if (!matchesTarget(p.target, `skill.${skill}`)) continue;
				if (p.kind === EFFECT_KIND.advantage) adv = true;
				else if (p.kind === EFFECT_KIND.disadvantage) dis = true;
			}
		let base = passiveScore(skills[skill]);
		if (adv !== dis)
			base = {
				...base,
				value: base.value + (adv ? 5 : -5),
				trace: [
					...base.trace,
					{
						source: adv ? 'Advantage' : 'Disadvantage',
						layer: 'condition',
						op: 'add',
						amount: adv ? 5 : -5
					}
				]
			};
		return applyEffects(`passive.${skill}`, base, resolved.effects, effCtx);
	};

	// damage defenses from effects: `resist_immune:<resist|immune|vulnerable>:<type>` (a bare
	// `resist_immune:<type>` defaults to resistance).
	const defenses = { resist: [] as string[], immune: [] as string[], vulnerable: [] as string[] };
	for (const eff of resolved.effects)
		for (const t of eff.tokens) {
			const p = parseEffect(t);
			if (p.kind !== EFFECT_KIND.resistImmune || !p.target) continue;
			const bucket = p.defense ?? 'resist';
			const type = p.target.trim();
			if (!defenses[bucket].includes(type)) defenses[bucket].push(type);
		}

	// spellcasting: per-class profiles + shared/pact slot pools (fixes multiclass DCs, L11) — computed
	// up-front (above) so `spellcasting_mod` is available to the expr ctx.

	return {
		level,
		proficiencyBonus: prof,
		abilities,
		skills,
		ac,
		initiative: applyEffects(
			'initiative',
			initiativeOf({ dexScore: scores.dex }),
			resolved.effects,
			effCtx
		),
		speed,
		maxHp,
		passives: {
			perception: passiveOf('perception'),
			investigation: passiveOf('investigation'),
			insight: passiveOf('insight')
		},
		carryingCapacity: carryingCapacity({ strScore: scores.str, system }),
		defenses,
		resources: collectResources(resolved.effects, effCtx, issues),
		spellcasting,
		missing,
		deriveIssues: issues,
		resolvedEffects: resolved.effects
	};
}
