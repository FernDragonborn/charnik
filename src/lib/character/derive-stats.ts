/*
 * Per-stat DERIVATION — the pure stat-phase helpers of deriveSheet, split out of derive.ts. Each
 * takes the shared computed inputs (build / effective scores / level / typed facts) and returns a
 * `Computed` (or a small record) for one facet of the sheet: saves, skills, AC, speed, passives,
 * damage sensitivities. No reactivity, no effects gathering — the effect list is already resolved into `facts`.
 */
import { recordOf } from '../util/records';
import {
	savingThrow,
	skillCheck,
	unarmoredAC,
	armoredAC,
	passiveScore,
	abilityModifier,
	type Ability,
} from '../rules/core';
import { ABILITIES } from './schema';
import type { Character } from './schema';
import { SKILL_ABILITY, type SkillId } from './skills';
import { applyEffects, matchesTarget, type EffectFacts } from '../effects/apply';
import { computed, SOURCE_KEY, type Computed, type Contribution } from '../rules/pipeline';
import {
	rowName,
	type ContentGraph,
	type LoadedRow,
	type LoadedRowByType,
} from '../content/loader';
import { tagInt, parseItemTags, ITEM_TAG } from '../content/item-tags';
import type { ResolvedItem } from '../content/resolved-item';
import { SENSE_PREFIX, INCOMING_ATTACK_TARGET } from './derive-targets';
import {
	CHECK_PREFIX,
	maxProf,
	partialFrom,
	TOOL_PREFIX,
	type GrantedProficiency,
	type SkillProficiency,
} from './granted-proficiency';

/** Coerce a CSV-derived cell to a number (already-number passes through), else the default. Shared by
 *  the stat helpers + deriveSheet's base-speed read. */
export const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);

export interface AbilityBlock {
	/** The effective score — traced + clamped through the pipeline (A10), explainable on hover. */
	score: Computed;
	baseScore: number;
	/** The raw ability modifier — what damage, a spell DC and a weapon's to-hit are built from. NOT
	 *  what a bare ability check rolls: that is `check`, the folded one. */
	mod: number;
	/** A BARE ability check (the tile's own tap), folded under `check.<ab>` so a `d20_tests` or
	 *  `ability_checks` effect reaches it the way it reaches the save and the skills. */
	check: Computed;
	save: Computed;
	/** Is this save proficient? A VALUE, because the UI used to answer it by sniffing the trace for a
	 *  `layer === 'proficiency'` contribution — reaching into the stacking algebra, which
	 *  `docs/internals/compatibility.md` §1 names as the one shared vessel nothing outside the engine may
	 *  pattern-match on (a family-B system has no such layer and the tile would silently go blank).
	 *  It costs nothing: the answer is already in hand where the save is built. */
	saveProficient: boolean;
}

/** The computed inputs every stat-phase helper reads (bundled so the helpers stay ≤4 params). */
export interface StatInputs {
	build: Character['build'];
	scores: Record<Ability, number>;
	level: number;
	facts: EffectFacts;
}

/** The ability a tool check rolls where the edition's SRD names one. 5.1 states the opposite in so
 *  many words — "Tool use is not tied to a single ability, since proficiency with a tool represents
 *  broader knowledge of its use" — so that edition's answer is the TABLE's, and a named state says
 *  so rather than an absent ability the sheet would have to guess at. */
export const TABLE_CHOSEN_ABILITY = 'table-chosen';

/** One tool this character is proficient with: what to call it, and which ability its check uses. */
export interface ToolProficiency {
	/** The bare content id — what `grant_proficiency:tool.<id>` and `build.tools` both name. */
	id: string;
	name: string;
	ability: Ability | typeof TABLE_CHOSEN_ABILITY;
}

/**
 * Tools the character is proficient with: the build's picks plus every `grant_proficiency:tool.<id>`
 * a class, feat or item granted. A tool with no row in the active edition still LISTS (under its own
 * id) — a proficiency a pack no longer ships is the player's fact, not ours to drop — it simply has
 * no ability to read.
 */
export function deriveTools(
	{ build, facts }: StatInputs,
	toolRows: readonly LoadedRowByType<'item'>[],
): ToolProficiency[] {
	const granted = facts.proficiencies
		.filter((p) => p.target.startsWith(TOOL_PREFIX))
		.map((p) => p.target.slice(TOOL_PREFIX.length));
	const byId = new Map(toolRows.map((r) => [r.id, r]));
	return [...new Set([...(build.tools ?? []), ...granted])].sort().map((id) => {
		const row = byId.get(id);
		const declared = row ? toolAbility(row) : undefined;
		return {
			id,
			name: row ? rowName(row) : id,
			ability: declared ?? TABLE_CHOSEN_ABILITY,
		};
	});
}

/** A tool row's `ability:<abl>` tag, when it carries one the ability list knows. */
function toolAbility(row: LoadedRowByType<'item'>): Ability | undefined {
	const tags = parseItemTags(row.data.tags);
	const raw = tags.get(ITEM_TAG.ability);
	return ABILITIES.find((a) => a === raw);
}

/**
 * A tool check: the ability check, plus your proficiency bonus because you are proficient. RAW says
 * nothing else — "add your Proficiency Bonus to any ability check you make that uses the tool" — so
 * it is built ON the ability's own folded check rather than beside it, and Guidance, exhaustion and
 * every other `ability_checks` effect reach it exactly as they reach a skill.
 */
export function toolCheck(abilityCheck: Computed, proficiencyBonus: number): Computed {
	return computed(
		[
			...abilityCheck.trace,
			{
				source: 'Proficiency',
				key: SOURCE_KEY.proficiency,
				layer: 'proficiency',
				op: 'add',
				amount: proficiencyBonus,
			},
		],
		undefined,
		abilityCheck.notes,
	);
}

/** Save-proficient abilities: build.saves + effect-granted + the STARTING class's saves. Multiclass
 *  RAW grants saves from the FIRST class ONLY (A8); the loop still resolves each class row so a
 *  missing ref is flagged, but only classes[0] adds saves. */
export function resolveClassSaves(
	build: Character['build'],
	graph: ContentGraph,
	grantedSaves: Set<Ability>,
	missing: string[],
): Set<Ability> {
	const classSaves = new Set<Ability>([...build.saves, ...grantedSaves]);
	build.classes.forEach((c, i) => {
		const row = graph.get(c.class);
		if (!row) {
			missing.push(c.class);
			return;
		}
		if (i === 0 && row.type === 'class' && Array.isArray(row.data.saves))
			for (const a of row.data.saves) classSaves.add(a);
	});
	return classSaves;
}

export function deriveAbilityBlocks(
	{ build, scores, level, facts }: StatInputs,
	abilityComputed: Record<Ability, Computed>,
	classSaves: Set<Ability>,
	grantedChecks: Map<string, GrantedProficiency>,
): Record<Ability, AbilityBlock> {
	return recordOf(ABILITIES, (ab) => {
		const proficient = classSaves.has(ab);
		const base = savingThrow({ ability: ab, score: scores[ab], level, proficient });
		return {
			score: abilityComputed[ab],
			baseScore: build.abilities[ab],
			mod: abilityModifier(scores[ab]),
			check: applyEffects(
				`check.${ab}`,
				skillCheck({
					ability: ab,
					score: scores[ab],
					level,
					// a BARE ability check is never proficient (that is what a skill is), so the only rung
					// that can reach it is a partial one — 2014 Remarkable Athlete's `check.<ability>`
					...partialFrom('partial', grantedChecks.get(`${CHECK_PREFIX}${ab}`)),
				}),
				facts,
			),
			save: applyEffects(`save.${ab}`, base, facts),
			saveProficient: proficient,
		};
	});
}

/** Skills: the BUILD's chosen level (expertise requires the chosen proficiency) combines with the
 *  effect-granted level by MAX on the one ladder, so no boolean combination can express an invalid
 *  state. */
export function deriveSkills(
	{ build, scores, level, facts }: StatInputs,
	grantedSkills: Map<string, GrantedProficiency>,
): Record<SkillId, Computed & { prof: SkillProficiency }> {
	// class/background picks + §C feat-granted skill choices (Skilled) + the species' own grant — all
	// three are plain proficiency, and separate lists only so no cap counts another's picks
	const chosenProf = new Set([
		...build.skills,
		...(build.featSkills ?? []),
		...(build.speciesSkills ?? []),
	]);
	const chosenExpert = new Set(build.expertise ?? []);
	// expertise only counts on a skill the build is also proficient in
	function chosenProficiency(skill: SkillId): SkillProficiency {
		if (!chosenProf.has(skill)) return 'none';
		return chosenExpert.has(skill) ? 'expertise' : 'proficient';
	}
	return recordOf(Object.keys(SKILL_ABILITY) as SkillId[], (skill) => {
		const ab = SKILL_ABILITY[skill];
		const granted = grantedSkills.get(skill);
		const profLevel = maxProf(chosenProficiency(skill), granted?.level ?? 'none');
		const base = skillCheck({
			ability: ab,
			score: scores[ab],
			level,
			proficient: profLevel === 'proficient',
			expertise: profLevel === 'expertise',
			...partialFrom(profLevel, granted),
		});
		return { ...applyEffects(`skill.${skill}`, base, facts), prof: profLevel };
	});
}

/** AC: equipped armor (dex-capped) + the shield in hand, else unarmored; then AC effects fold on top.
 *  The shield's contribution follows what is EQUIPPED, because that is the only condition 5e puts on
 *  it — there is no action for raising one, and a shield you are holding is worth its AC while you
 *  hold it. Its own `ac` tag is the amount, so a +1 shield is worth 3 rather than a flat 2, and a
 *  shield row that declares no `ac` contributes nothing — the same rule armour follows. */
export function deriveAc(
	{ scores, facts }: StatInputs,
	equippedArmor: ResolvedItem | undefined,
	equippedShield: ResolvedItem | undefined,
): Computed {
	let acBase: Computed;
	if (equippedArmor) {
		// no `dex_cap` tag means no cap (light armor), which is NOT `dex_cap:0` (heavy) — hence null
		const dexCap = tagInt(equippedArmor.tags, ITEM_TAG.dexCap);
		const armorBaseAc = tagInt(equippedArmor.tags, ITEM_TAG.ac) ?? 0;
		acBase = armoredAC({ armorBaseAc, dexScore: scores.dex, dexCap });
	} else {
		acBase = unarmoredAC({ dexScore: scores.dex });
	}
	if (equippedShield) {
		// its own `ac` tag, exactly like armour above — a shield row that does not declare one
		// contributes nothing rather than a number we made up for it
		const shieldAc = tagInt(equippedShield.tags, ITEM_TAG.ac) ?? 0;
		acBase = {
			...acBase,
			value: acBase.value + shieldAc,
			trace: [
				...acBase.trace,
				{
					source: equippedShield.row.data.name_en,
					layer: 'item',
					op: 'add',
					amount: shieldAc,
					key: SOURCE_KEY.shield,
				},
			],
		};
	}
	return applyEffects('ac', acBase, facts);
}

/** Speed from species base; A3: armor whose `str_min` exceeds the wearer's STR drops it 10 ft (RAW,
 *  both editions), traced as an item-layer contribution so it's explained; then effects layer on top. */
export function deriveSpeed(
	{ scores, facts }: StatInputs,
	speciesRow: LoadedRow | undefined,
	baseSpeed: number,
	equippedArmor: ResolvedItem | undefined,
): Computed {
	const speedBase: Contribution[] = [
		{
			// a species' own name is DATA and passes through; only the "no species yet" fallback is ours
			source: speciesRow ? rowName(speciesRow) : 'Default',
			layer: 'base',
			op: 'add',
			amount: baseSpeed,
			...(speciesRow ? {} : { key: SOURCE_KEY.speciesDefault }),
		},
	];
	const armorStrMin = equippedArmor ? (tagInt(equippedArmor.tags, ITEM_TAG.strMin) ?? 0) : 0;
	if (armorStrMin > 0 && scores.str < armorStrMin)
		speedBase.push({
			source: `${equippedArmor ? rowName(equippedArmor.row) : 'Armor'} (STR ${armorStrMin})`,
			layer: 'item',
			op: 'add',
			amount: -10,
			note: `STR ${scores.str} < ${armorStrMin}`,
			key: SOURCE_KEY.armorTooHeavy,
			noteKey: SOURCE_KEY.armorStrShort,
			// the armor's own name is DATA — the catalog holds the frame around it, never the word
			params: {
				armor: equippedArmor ? rowName(equippedArmor.row) : 'Armor',
				required: armorStrMin,
				score: scores.str,
			},
		});
	return applyEffects('speed', computed(speedBase, { min: 0 }), facts);
}

/** Passive score of every skill (10 + mod ± adv/dis, `passive.<skill>` effects folded). Any ability
 *  check has a passive form (RAW), and the play view pins arbitrary skills as passive senses. */
export function derivePassives(
	skills: Record<SkillId, Computed & { prof: SkillProficiency }>,
	facts: EffectFacts,
): Record<SkillId, Computed> {
	return recordOf(Object.keys(SKILL_ABILITY) as SkillId[], (skill) => {
		// advantage/disadvantage on the underlying check moves the passive by ±5 (both → cancel, RAW).
		const adv = facts.advantage.some((a) => matchesTarget(a.target, `skill.${skill}`));
		const dis = facts.disadvantage.some((d) => matchesTarget(d.target, `skill.${skill}`));
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
						amount: adv ? 5 : -5,
						key: adv ? SOURCE_KEY.advantage : SOURCE_KEY.disadvantage,
					},
				],
			};
		return applyEffects(`passive.${skill}`, base, facts);
	});
}

/** Every sense some effect grants, folded to its range. The KEYS come from the facts — there is no
 *  list of senses anywhere, by design — and each folds from 0 so a sense nothing grants is absent
 *  rather than present at zero feet. */
export function deriveSenses(facts: EffectFacts): Record<string, Computed> {
	const senses: Record<string, Computed> = {};
	for (const f of facts.numeric) {
		if (!f.target.startsWith(SENSE_PREFIX)) continue;
		const name = f.target.slice(SENSE_PREFIX.length);
		senses[name] ??= applyEffects(f.target, computed([], { min: 0 }), facts);
	}
	return senses;
}

/** Conditions the character cannot be given, deduped and in the order the facts arrived. Ids, not
 *  labels: the sheet resolves each against the state rows so a translated pack reads in its own
 *  language, and a word no row carries (2014's "disease") still says itself. */
export function deriveConditionImmunities(facts: EffectFacts): string[] {
	return [...new Set(facts.conditionImmunities.map((c) => c.id))];
}

/** One statement about the dice an ATTACKER rolls at this character. */
export interface IncomingAttack {
	swing: 'advantage' | 'disadvantage';
	/** The kind of attack it applies to (`spell`), absent when it applies to every attack. */
	scope?: string;
	source: string;
}

/**
 * What an attacker rolling AT this character gets — Cloak of Displacement, Spellguard Shield.
 *
 * The engine models the dice YOU roll: `rollEffectsFor` takes the rolling thing's scopes, and an
 * attack aimed at you has none of them. So this is a second, small channel that the sheet STATES and
 * the roller never folds, because we do not roll the monster's dice. Folding it into `attack` would
 * have put the enemy's disadvantage on your own swing, which is why it is a target of its own.
 */
export function deriveIncomingAttacks(facts: EffectFacts): IncomingAttack[] {
	const lists = [
		['advantage', facts.advantage],
		['disadvantage', facts.disadvantage],
	] as const;
	const out: IncomingAttack[] = [];
	for (const [swing, list] of lists)
		for (const f of list)
			if (f.target === INCOMING_ATTACK_TARGET)
				out.push({ swing, source: f.source, ...(f.scope ? { scope: f.scope } : {}) });
	return out;
}

/** One thing that is true of this character only IN A CASE — "+2 AC against ranged attacks",
 *  "advantage on saving throws against spells". */
export interface QualifiedDefense {
	/** What it moves: a stat key (`ac`) or a roll group (`saves`). */
	target: string;
	/** The case it applies in, as the row wrote it (`ranged`, `spell`, `poisoned`). */
	scope: string;
	/** A numeric bonus, for a `flat_bonus`; absent for a flag. */
	amount?: number;
	/** A flag, for an `advantage`/`disadvantage`; absent for a number. */
	swing?: 'advantage' | 'disadvantage';
	source: string;
}

/**
 * The statements a stat's own number cannot carry.
 *
 * "+2 AC against ranged attack rolls" is not +2 AC, and "advantage on saving throws against spells"
 * is not advantage on your Strength save — so the fold skips a qualified fact (`applyEffects`) and
 * the roll path skips it until the roll says what it is against (`rollEffectsFor`). This is where
 * they are read instead: the sheet STATES them beside the other facts about the body, which is the
 * honest thing a tracker can do about a case it cannot detect.
 */
export function deriveQualifiedDefenses(facts: EffectFacts): QualifiedDefense[] {
	const out: QualifiedDefense[] = [];
	for (const f of facts.numeric)
		if (f.scope && f.op === 'add' && f.amount !== undefined && QUALIFIED_TARGETS.has(f.target))
			out.push({ target: f.target, scope: f.scope, amount: f.amount, source: f.source });
	const flags = [
		['advantage', facts.advantage],
		['disadvantage', facts.disadvantage],
	] as const;
	for (const [swing, list] of flags)
		for (const f of list)
			if (f.scope && QUALIFIED_TARGETS.has(f.target))
				out.push({ target: f.target, scope: f.scope, swing, source: f.source });
	return out;
}
/** The targets whose qualified form the DEFENCES strip states. `attack`/`damage` are qualified too,
 *  but they fold per-weapon where the weapon is known, so they are not statements about the body;
 *  `attacked` has its own channel, because it is not this character's roll at all. */
const QUALIFIED_TARGETS = new Set<string>(['ac', 'saves']);

/** Damage defenses collected from `damage_sensitivity` facts, deduped per bucket. */
export function deriveDamageSensitivities(facts: EffectFacts): {
	resist: string[];
	immune: string[];
	vulnerable: string[];
} {
	const sensitivities = {
		resist: [] as string[],
		immune: [] as string[],
		vulnerable: [] as string[],
	};
	for (const d of facts.damageSensitivities)
		if (!sensitivities[d.bucket].includes(d.type)) sensitivities[d.bucket].push(d.type);
	return sensitivities;
}
