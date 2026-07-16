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
import type { ContentGraph, LoadedRow, LoadedRowOf } from '../content/loader';
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
	type ResourceDef
} from '../effects/index';
import { deriveSpellcasting, type Spellcasting } from './spellcasting';
import { makeExprContext } from '../effects/context';
import type { ExprContext } from '../effects/expr';
import type { Computed, System } from '../rules/pipeline';

/** Skill → its governing ability (the 18 SRD skills). */
// `as const satisfies` so the KEYS form the `SkillId` union (not widened to `string`) while the
// values are still checked to be `Ability`. This lets the skills map be keyed by `SkillId`, so
// indexing it with a known skill id is sound (no `T | undefined`, no non-null assertions).
export const SKILL_ABILITY = {
	acrobatics: 'dex',
	'animal-handling': 'wis',
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
	'sleight-of-hand': 'dex',
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
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);
/** A row's bounded-vocab effect tokens (empty for lookup tables, which carry no `effects`).
 *  Exported: the combat cast path reads a spell's tokens through the same single accessor. */
export const tokensOf = (row: LoadedRow | undefined): string[] => {
	// `effects` rides on every browsable type but not the lookup tables; read it only where present
	const effects = row && 'effects' in row.data ? row.data.effects : undefined;
	return Array.isArray(effects) ? effects : [];
};

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

	const species = resolve(character.build.species);
	if (species)
		active.push({
			source: String(species.data.name_en),
			layer: 'feature',
			tokens: tokensOf(species)
		});

	// species sub-option (subrace / lineage) — its ASI + traits cascade like the species' own
	const speciesOption = resolve(character.build.speciesOption);
	if (speciesOption && tokensOf(speciesOption).length)
		active.push({
			source: String(speciesOption.data.name_en),
			layer: 'feature',
			tokens: tokensOf(speciesOption)
		});

	const background = resolve(character.build.background);
	if (background && tokensOf(background).length)
		active.push({
			source: String(background.data.name_en),
			layer: 'feature',
			tokens: tokensOf(background)
		});

	// class + subclass: the class row's own tokens, its base features up to the class level, the
	// chosen subclass row, and that subclass's features (same level gate). Features are matched by
	// class_id within the CLASS ROW'S source + the character's edition, so a 5e and a 5.5e feature
	// table for the same class can coexist without double-applying.
	for (const entry of character.build.classes) {
		const classRow = resolve(entry.class);
		if (classRow && tokensOf(classRow).length)
			active.push({
				source: String(classRow.data.name_en),
				layer: 'feature',
				tokens: tokensOf(classRow)
			});
		const subclassRow = resolve(entry.subclass);
		if (subclassRow && tokensOf(subclassRow).length)
			active.push({
				source: String(subclassRow.data.name_en),
				layer: 'feature',
				tokens: tokensOf(subclassRow)
			});
		if (!classRow) continue;
		for (const f of graph.rows) {
			if (f.type !== 'class_feature' || f.source !== classRow.source) continue;
			if (f.data.class_id !== classRow.id || Number(f.data.level) > entry.level) continue;
			if (!f.systems.includes(character.system)) continue;
			// base feature (no subclass_id) always applies; a subclass feature only for the chosen one
			const forSubclass = f.data.subclass_id;
			if (forSubclass && forSubclass !== (subclassRow?.type === 'subclass' ? subclassRow.id : ''))
				continue;
			const toks = tokensOf(f);
			if (toks.length)
				active.push({ source: String(f.data.name_en), layer: 'feature', tokens: toks });
		}
	}

	// feats (incl. repeatable ones taken more than once → their effect applies each time)
	for (const featRef of character.build.feats) {
		const feat = resolve(featRef);
		const toks = tokensOf(feat);
		if (feat && toks.length)
			active.push({ source: String(feat.data.name_en), layer: 'feature', tokens: toks });
	}

	for (const inv of character.build.inventory) {
		if (!inv.equipped && !inv.attuned) continue;
		const item = resolve(inv.item);
		const toks = tokensOf(item);
		if (item && toks.length)
			active.push({ source: String(item.data.name_en), layer: 'item', tokens: toks });
	}

	for (const eff of character.play.effects) {
		if (eff.effects.length)
			active.push({ source: eff.label, layer: 'condition', tokens: eff.effects });
	}

	// expand `apply_condition:<id>` → the referenced condition's OWN effect tokens, so a spell/effect
	// that inflicts a condition actually applies that condition's mechanics (nested one level).
	for (const eff of [...active]) {
		for (const t of eff.tokens) {
			const p = parseEffect(t);
			if (p.kind !== EFFECT_KIND.applyCondition || !p.target) continue;
			const condId = p.target.trim();
			const cond = graph.rows.find((r) => r.type === 'condition' && r.id === condId);
			const toks = tokensOf(cond);
			if (cond && toks.length)
				active.push({
					source: `${eff.source} → ${cond.data.name_en}`,
					layer: 'condition',
					tokens: toks
				});
		}
	}
	return active;
}

/** Sum flat_bonus tokens that target a given ability score (the cascade layer). */
function abilityBonus(active: ActiveEffect[], ability: Ability): number {
	let sum = 0;
	for (const eff of active) {
		for (const t of eff.tokens) {
			const p = parseEffect(t);
			if (p.kind === EFFECT_KIND.flatBonus && p.target === ability && p.amount !== undefined)
				sum += p.amount;
		}
	}
	return sum;
}

export function deriveSheet(character: Character, graph: ContentGraph): CharacterSheet {
	const build = character.build;
	const system = character.system as System;
	const missing: string[] = [];
	// effects-auto global toggle: off → no effect layers (base stats / text only)
	const active = character.play.autoCalc ? gatherEffects(character, graph, missing) : [];

	const level = build.classes.reduce((n, c) => n + c.level, 0) || 1;
	const prof = proficiencyBonus(level);

	// effective ability scores (base + allocated boosts + score-targeting effects), downstream
	const scores = {} as Record<Ability, number>;
	for (const ab of ABILITIES)
		scores[ab] = build.abilities[ab] + (build.abilityBoosts?.[ab] ?? 0) + abilityBonus(active, ab);

	// L2 expression context (EXPR-2, build vars). Class levels keyed by BARE id (`class_level.monk`);
	// spellcasting computed up-front so `spellcasting_mod` reads the primary caster; base_speed is the
	// species walking speed pre-effect. Play-state guards (hp/flags/enums) arrive in EXPR-3; until then
	// every guard variable resolves to its absent default, so conditions read as "off".
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
	const exprCtx: ExprContext | undefined = character.play.autoCalc
		? makeExprContext({
				level,
				proficiencyBonus: prof,
				abilityMods,
				abilityScores: scores,
				classLevels,
				spellcastingMod: primaryCaster ? abilityMods[primaryCaster.ability] : 0,
				baseSpeed
			})
		: undefined;

	// proficiencies granted by effects (item/feat/feature): `grant_proficiency:[expertise:]<target>`
	// where target is a save (`con` / `save.con`) or a skill id (`stealth` — the parser already
	// stripped any `skill.` prefix). Skills collect the granted LEVEL (max of the ladder); saves are
	// proficient-or-not (expertise doesn't apply to saves — a granted 'expertise' still just means
	// proficient there).
	const grantedSaves = new Set<Ability>();
	const grantedSkills = new Map<string, SkillProficiency>();
	if (character.play.autoCalc)
		for (const eff of active)
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
			save: applyEffects(`save.${ab}`, base, active, exprCtx)
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
		skills[skill] = { ...applyEffects(`skill.${skill}`, base, active, exprCtx), prof };
	}

	// AC: equipped armor + shield, else unarmored; then effects
	let acBase: Computed;
	const armor = build.inventory
		.map((i) => (i.equipped ? graph.get(i.item) : undefined))
		.find((r): r is LoadedRowOf<'item'> => r?.type === 'item' && r.data.category === 'armor');
	if (armor) {
		const capRaw = armor.data.armor_dex_cap;
		const dexCap = capRaw === '' || capRaw == null ? null : num(capRaw);
		acBase = armoredAC({ armorBaseAc: num(armor.data.ac), dexScore: scores.dex, dexCap });
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
	const ac = applyEffects('ac', acBase, active, exprCtx);

	// HP: sum per class (SRD fixed); CON uses effective score. `classes[0]` IS the class taken at
	// character level 1 (BuildVM preserves add-order) → only it grants the max hit die; later
	// multiclasses get avg-up on every level, including their first (RAW multiclass HP).
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
	// hp_max flows through the seam like every other stat (Toughness, Aid → `flat_bonus:hp_max+N`)
	const maxHp = applyEffects('hp_max', maxHpBase, active, exprCtx);

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
		active,
		exprCtx
	);

	const passiveOf = (skill: 'perception' | 'investigation' | 'insight') => {
		// advantage/disadvantage on the underlying check moves the passive by ±5 (both → cancel, RAW);
		// then `passive.<skill>`-targeted effects (Observant) fold in through the seam.
		let adv = false;
		let dis = false;
		if (character.play.autoCalc)
			for (const eff of active)
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
		return applyEffects(`passive.${skill}`, base, active, exprCtx);
	};

	// damage defenses from effects: `resist_immune:<resist|immune|vulnerable>:<type>` (a bare
	// `resist_immune:<type>` defaults to resistance).
	const defenses = { resist: [] as string[], immune: [] as string[], vulnerable: [] as string[] };
	if (character.play.autoCalc)
		for (const eff of active)
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
		initiative: applyEffects('initiative', initiativeOf({ dexScore: scores.dex }), active, exprCtx),
		speed,
		maxHp,
		passives: {
			perception: passiveOf('perception'),
			investigation: passiveOf('investigation'),
			insight: passiveOf('insight')
		},
		carryingCapacity: carryingCapacity({ strScore: scores.str, system }),
		defenses,
		resources: character.play.autoCalc ? collectResources(active, exprCtx) : [],
		spellcasting,
		missing
	};
}
