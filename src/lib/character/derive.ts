/*
 * The aggregator: character + loaded content + rules core + effects engine → the full set
 * of derived stats a sheet renders. One call, `deriveSheet(character, graph)`.
 *
 * This is the glue seam — it resolves the character's `type:source:id` refs against the
 * content graph, runs the pure rules math on the resulting numbers, and layers active
 * effects through `applyEffects`. Ability scores flow through the SAME fold/clamp pipeline
 * as every other stat (A10): base + boosts + score-targeting effects fold into a traced,
 * clamped `Computed`, resolved in DEPENDENCY order by the effects DAG (a guarded ability
 * bonus, a rage that raises max HP feeding `is_bloodied` — see effects/dag.ts). Missing
 * referenced content is skipped gracefully (loader already flagged it) — the sheet computes
 * with what it can.
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
	parseEffect,
	matchesTarget,
	EFFECT_KIND,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue,
	type ResourceDef
} from '../effects/index';
import {
	resolveActiveEffects,
	ABILITY_SCORE_CLAMP,
	RAGE_CONDITION_ID,
	type ResolveState
} from '../effects/dag';
import { deriveSpellcasting, castingAbilityByClass, type Spellcasting } from './spellcasting';
import {
	makeExprContext,
	withSpellcastingMod,
	type BuildVars,
	type PlayVars
} from '../effects/context';
import type { ExprContext } from '../effects/expr';
import {
	computed,
	type Computed,
	type Contribution,
	type Layer,
	type System
} from '../rules/pipeline';

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
	/** The effective score — traced + clamped through the pipeline (A10), explainable on hover. */
	score: Computed;
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
	// (`resolveActiveEffects`, effects/dag.ts) — in DEPENDENCY order, so guards gate a token BEFORE
	// its condition is expanded (SPEC7) and every consumer reads the same resolved list.
	return active;
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

	// A10 seeds: the score fold starts from the base score + allocated boosts, as traced contributions
	const abilityBase = {} as Record<Ability, Contribution[]>;
	for (const ab of ABILITIES) {
		const contribs: Contribution[] = [
			{ source: 'Base score', layer: 'base', op: 'add', amount: build.abilities[ab] }
		];
		const boost = build.abilityBoosts?.[ab] ?? 0;
		if (boost) contribs.push({ source: 'Ability boosts', layer: 'base', op: 'add', amount: boost });
		abilityBase[ab] = contribs;
	}

	// class levels keyed by BARE id (`class_level.monk`)
	const classLevels: Record<string, number> = {};
	for (const c of build.classes) {
		const row = graph.get(c.class);
		if (row) classLevels[row.id] = (classLevels[row.id] ?? 0) + c.level;
	}
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
	const equippedArmor = build.inventory
		.map((i) => (i.equipped ? graph.get(i.item) : undefined))
		.find((r): r is LoadedRowOf<'item'> => r?.type === 'item' && r.data.category === 'armor');

	// casting ability per caster class + the primary caster (highest caster class level) — the
	// cheap slice the resolve ctx needs; full spellcasting derives AFTER the final scores exist.
	const abilityByClass = castingAbilityByClass(character, graph);
	let primaryAbility: Ability | undefined;
	let primaryLevel = -1;
	for (const [cid, ab] of Object.entries(abilityByClass)) {
		const lvl = classLevels[cid] ?? 0;
		if (lvl > primaryLevel) {
			primaryLevel = lvl;
			primaryAbility = ab;
		}
	}

	const expandCondition = (condId: string) => {
		const cond = graph.rows.find((r) => r.type === 'condition' && r.id === condId);
		const toks = tokensOf(cond);
		return cond && toks.length ? { source: String(cond.data.name_en), tokens: toks } : undefined;
	};

	/** The ONE ctx (makeExprContext) over the LIVE resolve state: records/Set are the state's own
	 *  mutable containers, scalars go through getters — so a guard evaluated mid-resolve reads
	 *  exactly the values the DAG has already resolved (and the final ctx reads the final state). */
	const makeCtx = (state: ResolveState): EffectCtx => {
		const buildVars: BuildVars = {
			level,
			proficiencyBonus: prof,
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
				is_wearing_armor: !!equippedArmor,
				get is_raging() {
					return state.conditions.has(RAGE_CONDITION_ID);
				}
			},
			conditions: state.conditions,
			resources: state.resources,
			resourceMax: state.resourceMax,
			armorType: armorWeightOf(equippedArmor),
			size: String(speciesRow?.type === 'species' ? speciesRow.data.size : 'medium')
		};
		const base = makeExprContext(buildVars, playVars);
		// per-class `spellcasting_mod` (SPEC4): a token carried by a class's row/feature reads THAT
		// class's casting mod (live — scores may still be resolving); anything else the primary's.
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

	// The ONE resolve stage (effects/dag.ts): dependency-ordered guards, A10 ability pipeline,
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
			resourcesSpent: character.play.resourcesSpent
		});
		issues.push(...r.issues);
		effCtx = r.ctx;
		resolvedEffects = r.effects;
		abilityComputed = r.abilities;
		maxHpBase = r.hpMaxBase;
	} else {
		abilityComputed = {} as Record<Ability, Computed>;
		for (const ab of ABILITIES)
			abilityComputed[ab] = computed(abilityBase[ab], ABILITY_SCORE_CLAMP);
		maxHpBase = computed(hpMaxBaseFor(abilityComputed.con.value), { min: 1 });
	}
	const scores = {} as Record<Ability, number>;
	for (const ab of ABILITIES) scores[ab] = abilityComputed[ab].value;

	// spellcasting AFTER the resolve, so DCs/attacks read the EFFECTIVE scores (a Headband of
	// Intellect moves the wizard's DC, as it should).
	const spellcasting = deriveSpellcasting(character, graph, scores);

	// proficiencies granted by effects (item/feat/feature): `grant_proficiency:[expertise:]<target>`
	// where target is a save (`con` / `save.con`) or a skill id (`stealth` — the parser already
	// stripped any `skill.` prefix). Skills collect the granted LEVEL (max of the ladder); saves are
	// proficient-or-not (expertise doesn't apply to saves — a granted 'expertise' still just means
	// proficient there).
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Map<string, SkillProficiency>();
	for (const eff of resolvedEffects)
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
			score: abilityComputed[ab],
			baseScore: build.abilities[ab],
			mod: abilityModifier(scores[ab]),
			save: applyEffects(`save.${ab}`, base, resolvedEffects, effCtx)
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
		const profLevel = maxProf(chosen, grantedSkills.get(skill) ?? 'none');
		const base = skillCheck({
			ability: ab,
			score: scores[ab],
			level,
			proficient: profLevel === 'proficient',
			expertise: profLevel === 'expertise',
			halfProficient: profLevel === 'half'
		});
		skills[skill] = {
			...applyEffects(`skill.${skill}`, base, resolvedEffects, effCtx),
			prof: profLevel
		};
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
	const ac = applyEffects('ac', acBase, resolvedEffects, effCtx);

	// HP: the base fold came out of the resolve stage (recomputed at the final CON); hp_max flows
	// through the seam like every other stat (Toughness, Aid → `flat_bonus:hp_max+N`).
	const maxHp = applyEffects('hp_max', maxHpBase, resolvedEffects, effCtx);

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
		resolvedEffects,
		effCtx
	);

	const passiveOf = (skill: 'perception' | 'investigation' | 'insight') => {
		// advantage/disadvantage on the underlying check moves the passive by ±5 (both → cancel, RAW);
		// then `passive.<skill>`-targeted effects (Observant) fold in through the seam.
		let adv = false;
		let dis = false;
		for (const eff of resolvedEffects)
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
		return applyEffects(`passive.${skill}`, base, resolvedEffects, effCtx);
	};

	// damage defenses from effects: `resist_immune:<resist|immune|vulnerable>:<type>` (a bare
	// `resist_immune:<type>` defaults to resistance).
	const defenses = { resist: [] as string[], immune: [] as string[], vulnerable: [] as string[] };
	for (const eff of resolvedEffects)
		for (const t of eff.tokens) {
			const p = parseEffect(t);
			if (p.kind !== EFFECT_KIND.resistImmune || !p.target) continue;
			const bucket = p.defense ?? 'resist';
			const type = p.target.trim();
			if (!defenses[bucket].includes(type)) defenses[bucket].push(type);
		}

	return {
		level,
		proficiencyBonus: prof,
		abilities,
		skills,
		ac,
		initiative: applyEffects(
			'initiative',
			initiativeOf({ dexScore: scores.dex }),
			resolvedEffects,
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
		resources: collectResources(resolvedEffects, effCtx, issues),
		spellcasting,
		missing,
		deriveIssues: issues,
		resolvedEffects
	};
}
