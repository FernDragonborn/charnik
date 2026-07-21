/*
 * Pure, stateless helpers + constants + types for the Combat view. No Svelte runes,
 * no component state — so they can be shared by the state module (state.svelte.ts) and
 * every area component. Split out of the old monolithic combat/+page.svelte.
 */
import { ABILITY_IDS, type Ability } from '$lib/rules/core';
import type { Computed, Contribution, System } from '$lib/rules/pipeline';
import type { ContentGraph } from '$lib/content/loader';
import type { Character, EffectInstance } from '$lib/character/schema';
import { SKILL_ABILITY, type CharacterSheet, type SkillId } from '$lib/character/derive';
import {
	parseDicePool,
	parseDiceTerm,
	type BonusDie,
	type DieMods,
	type Rolled
} from '$lib/rules/dice';
import { ordinal, titleCase, signed } from '$lib/util/format';
// re-exported so existing importers (`$lib/combat/helpers`) keep working after the F1/F2 dedup
export { titleCase, signed };
import { parseToken, EFFECT_KIND, type Recharge } from '$lib/effects/token-parser';
import { matchesTarget, type EffectFacts } from '$lib/effects/apply';
import { cantripDieMultiplier } from '$lib/rules/spellcasting';

/** A roll-log row: a completed roll (the primary/to-hit) plus what it was for, and — for an attack —
 *  the damage roll that follows it. Rendered as up to 3 lines: the roll, the dropped adv die, damage. */
export type RollLogEntry = Rolled & { label: string; damage?: Rolled };

/** The three action-economy slots a turn tracks. */
export type ActionSlot = 'action' | 'bonus' | 'reaction';

/** A standard combat action row (Dash, Hide, Grapple…). `roll` is present for the ones that make a
 *  check; `hint` shows its live modifier. */
export interface StandardAction {
	id: string;
	name: string;
	hint: string;
	desc: string;
	/** Short right-side tag: "action" / "contest" / "→ roll" / "→ Attacks". */
	marker: string;
	roll?: [string, number];
}

/** The anchored dropdown menus the Combat view can open (overlay.kind). */
export type MenuKind =
	| 'dice'
	| 'temphp'
	| 'levelup'
	| 'addeffect'
	| 'customeffect'
	| 'log'
	| 'pinskills'
	| 'showhide'
	| 'condition'
	| 'manage';

/** `[0, 1, …, n-1]` — for rendering N pips/dots. */
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/**
 * Click-to-set for every pip tracker (action economy, spell slots, resources) — ONE model:
 * available pips on the LEFT, spent pips accumulate on the RIGHT. Clicking an available pip spends
 * from it rightward; clicking a spent pip restores from it leftward. Returns the new spent count,
 * always in [0, total]. Pure so it's the single source shared by every tracker and unit-testable.
 */
export function pipClick(currentSpent: number, index: number, total: number): number {
	const remaining = total - currentSpent; // pips 0..remaining-1 are available (left), rest spent
	return index < remaining ? total - index : total - index - 1;
}

/** What a roll target (e.g. "save.dex", "skill.stealth", "attack", "damage") picks up from active
 *  effects: advantage/disadvantage, signed bonus/penalty dice (Bless +1d4 / Bane −1d4), the summed
 *  FLAT bonus, and the roll-manipulation facts (`reroll`/`min_die`). NB `flat` is for keys the
 *  sheet does NOT already fold (attack/damage) — for save/skill keys the flat part is already
 *  inside the sheet value, so callers must ignore it there or it double-counts. Pure — the caller
 *  gates it on the effects-auto toggle.
 *
 *  Reads the sheet's typed-facts object (D7) — the resolve stage already evaluated guards,
 *  expanded conditions and resolved L2 expression values, so an expression bonus
 *  (`is_raging ? flat_bonus:damage+cha_mod`) arrives here as a plain number. */
export interface RollEffects extends DieMods {
	advantage: boolean;
	disadvantage: boolean;
	flat: number;
	bonusDice: BonusDie[];
}
export const NO_ROLL_EFFECTS: RollEffects = {
	advantage: false,
	disadvantage: false,
	flat: 0,
	bonusDice: []
};
export function rollEffectsFor(facts: EffectFacts, key: string): RollEffects {
	const out: RollEffects = { ...NO_ROLL_EFFECTS, bonusDice: [] };
	out.advantage = facts.advantage.some((a) => matchesTarget(a.target, key));
	out.disadvantage = facts.disadvantage.some((d) => matchesTarget(d.target, key));
	for (const f of facts.numeric) {
		if (f.op !== 'add' || !matchesTarget(f.target, key)) continue;
		if (f.amount !== undefined) out.flat += f.amount;
		else if (f.diceFormula) {
			const die = parseDiceTerm(f.diceFormula);
			if (die) out.bonusDice.push(die);
		}
	}
	// several sources → the most generous single value applies (they don't stack — one reroll pass)
	for (const r of facts.rerolls)
		if (matchesTarget(r.target, key)) out.reroll = Math.max(out.reroll ?? 0, r.value);
	for (const m of facts.minDie)
		if (matchesTarget(m.target, key)) out.minDie = Math.max(out.minDie ?? 0, m.value);
	return out;
}

/** A forced roll outcome for `key`, or null to roll normally. `auto_fail`/`auto_succeed` effects
 *  (paralyzed → STR/DEX saves) override the RESULT, not the die — so a matched save doesn't roll at
 *  all. Auto-fail wins a contradictory pair (the debuff bias: conditions that force outcomes are
 *  debilitating, and a fail-closed default is safer than silently succeeding). */
export function autoOutcome(facts: EffectFacts, key: string): 'fail' | 'succeed' | null {
	if (facts.autoFail.some((a) => matchesTarget(a.target, key))) return 'fail';
	if (facts.autoSucceed.some((a) => matchesTarget(a.target, key))) return 'succeed';
	return null;
}

/** Advantage + disadvantage cancel to a straight roll (5e rule) → the −1/0/+1 the roller takes. */
export const netAdvantage = (fx: Pick<RollEffects, 'advantage' | 'disadvantage'>): number =>
	fx.advantage === fx.disadvantage ? 0 : fx.advantage ? 1 : -1;

/** The sheet's damage defenses (from `resist_immune` effects) — the three buckets by damage type. */
export interface Defenses {
	resist: string[];
	immune: string[];
	vulnerable: string[];
}

/** Which bucket, if any, a damage type hits. */
export type DefenseBucket = 'immune' | 'resist' | 'vulnerable' | null;

/**
 * Apply resist/immune/vulnerable to a raw damage amount given its type (B20). Immune → 0, resist →
 * half rounded DOWN (RAW), vulnerable → doubled; an untyped hit or a type the sheet has no defense
 * for is unchanged. Immunity outranks vulnerability (you can't be both for one type in SRD, but
 * fail-safe to 0). Pure — the resist/vuln math happens BEFORE temp-HP soak at the call site (RAW:
 * modify the damage, then absorb). */
export function applyDefense(
	amount: number,
	type: string | null,
	defenses: Defenses
): { final: number; bucket: DefenseBucket } {
	if (!type) return { final: amount, bucket: null };
	if (defenses.immune.includes(type)) return { final: 0, bucket: 'immune' };
	if (defenses.vulnerable.includes(type)) return { final: amount * 2, bucket: 'vulnerable' };
	if (defenses.resist.includes(type)) return { final: Math.floor(amount / 2), bucket: 'resist' };
	return { final: amount, bucket: null };
}

/** Feet → "N m" (metric in parentheses next to imperial). */
export const metres = (ft: number) => `${(ft * 0.3048).toFixed(1).replace(/\.0$/, '')} m`;

/** Provenance trace of a Computed → a human-readable "why" string for tooltips. */
export function why(c: Computed): string {
	const opSym = (op: Contribution['op']): string =>
		op === 'set' ? '= ' : op === 'floor' ? '≥ ' : op === 'cap' ? '≤ ' : '';
	const parts = c.trace
		.filter((t) => t.amount !== 0 || t.op === 'set' || t.op === 'floor' || t.op === 'cap')
		.map((t) => `${t.source} ${opSym(t.op)}${signed(t.amount)}${t.note ? ` (${t.note})` : ''}`);
	return (parts.join(', ') || '—') + (c.notes?.length ? ' · ' + c.notes.join(' · ') : '');
}

/** Healing dice from a spell's text ("regains Hit Points equal to 2d4 plus …"). */
const healDice = (text: string): string => {
	const m = text.match(/(?:equal to|regains?|restores?)[^.]*?(\d+d\d+)/i);
	return m?.[1] ?? '';
};

/** A bounded-vocab target key → a short readable label ("ac" → "AC", "save.dex" → "DEX save",
 *  "skill.stealth" → "Stealth", "saves"/"skills" → the group names). */
function targetLabel(t: string): string {
	if (t === 'saves') return 'all saves';
	if (t === 'skills') return 'all skills';
	if (t.startsWith('save.')) return `${t.slice(5).toUpperCase()} save`;
	if (t.startsWith('skill.')) return titleCase(t.slice(6));
	if (t === 'ac') return 'AC';
	return titleCase(t);
}

/** A bounded-vocab effect token → a short readable tag for the effects panel:
 *  flat_bonus → "AC +2" / "saves +1d4"; set_override → "AC = 13"; resist_immune → "resist · fire";
 *  advantage → "adv · <target>"; grant_proficiency → "prof · <target>"; apply_condition → the name.
 *  grant_resource is NOT tagged here — it gets its own Resources section (see groupEffects). */
export function effectTag(token: string): string {
	const p = parseToken(token);
	if (p.kind === EFFECT_KIND.flatBonus && p.target) {
		const delta =
			p.amount !== undefined
				? `${p.amount < 0 ? '−' : '+'}${Math.abs(p.amount)}`
				: `${p.dice?.startsWith('-') ? '−' : '+'}${p.dice?.replace('-', '') ?? ''}`;
		return `${targetLabel(p.target)} ${delta}`;
	}
	if (p.kind === EFFECT_KIND.setOverride && p.target) {
		const sym = p.setMode === 'floor' ? '≥' : p.setMode === 'cap' ? '≤' : '=';
		return `${targetLabel(p.target)} ${sym} ${p.amount ?? p.valueExpr ?? '?'}`;
	}
	if (p.kind === EFFECT_KIND.blockBonus && p.target) return `block · ${targetLabel(p.target)}`;
	if (p.kind === EFFECT_KIND.halve && p.target) return `${targetLabel(p.target)} ×½`;
	if (p.kind === EFFECT_KIND.resistImmune && p.target)
		return `${p.defense ?? 'resist'} · ${p.target}`;
	if (p.kind === EFFECT_KIND.advantage && p.target) return `adv · ${targetLabel(p.target)}`;
	if (p.kind === EFFECT_KIND.disadvantage && p.target) return `disadv · ${targetLabel(p.target)}`;
	if (p.kind === EFFECT_KIND.grantProficiency && p.target) return `prof · ${titleCase(p.target)}`;
	if (p.kind === EFFECT_KIND.applyCondition && p.target) return titleCase(p.target);
	if (p.kind === EFFECT_KIND.autoFail && p.target) return `auto-fail · ${targetLabel(p.target)}`;
	if (p.kind === EFFECT_KIND.autoSucceed && p.target)
		return `auto-succeed · ${targetLabel(p.target)}`;
	if (p.kind === EFFECT_KIND.note && p.target) return p.target; // free-form display text, as authored
	// a handler REFERENCE — the namespace is the readable part; args are opaque (often long) machine input
	if (p.kind === EFFECT_KIND.plugin && p.plugin) return `plugin · ${p.plugin.namespace}`;
	return token.replace(/[-:]/g, ' ');
}

/** The display text of a `note:` token (a rules effect shown but NOT auto-applied — attacks against
 *  you, auto-crit, sense/relational), or null for any other token. Lets the panel style notes apart
 *  from the mechanical tags so it's clear the engine isn't computing them. */
export function noteText(token: string): string | null {
	const p = parseToken(token);
	return p.kind === EFFECT_KIND.note && p.target ? p.target : null;
}

/** The condition id an effect applies (its `apply_condition:<id>` token), or null — so the combat
 *  panel can surface a condition's rules text (the "attacks against you" / concealed parts that no
 *  stat token carries). First applied condition wins (an effect usually applies at most one). */
export function conditionIdOf(e: Pick<EffectInstance, 'effects'>): string | null {
	for (const token of e.effects) {
		const p = parseToken(token);
		if (p.kind === EFFECT_KIND.applyCondition && p.target) return p.target;
	}
	return null;
}

/** A runtime effect instance — the character-schema type, re-exported for the combat views. */
export type { EffectInstance } from '$lib/character/schema';

/** A grant_resource effect, resolved for the Resources section (name + charges + recharge). */
export interface ResourceView {
	iid: string;
	name: string;
	id: string;
	max: number;
	recharge: Recharge;
}

/** If an effect grants a fully-specified resource pool, resolve it — else null. The effect's Resources
 *  section membership is decided by this (grant_resource ⇒ Resources, not Buffs/Debuffs). */
export function parseResourceEffect(eff: EffectInstance): ResourceView | null {
	for (const tok of eff.effects) {
		const p = parseToken(tok);
		// runtime effects carry a LITERAL max (user-entered via the "+" form); an expression max
		// (`class_level.monk`) needs a derive ctx to resolve and is handled there, not in this panel.
		if (p.kind === EFFECT_KIND.grantResource && p.resource && p.resource.max !== undefined)
			return {
				iid: eff.iid,
				name: eff.label,
				id: p.resource.id,
				max: p.resource.max,
				recharge: p.resource.recharge
			};
	}
	return null;
}

/** Split active effects into the three panel sections. Resource-granting effects go to Resources
 *  (they recharge on rests, not rounds); the rest split by their positive flag. */
export function groupEffects(effects: EffectInstance[]): {
	buffs: EffectInstance[];
	debuffs: EffectInstance[];
	resources: ResourceView[];
} {
	const buffs: EffectInstance[] = [];
	const debuffs: EffectInstance[] = [];
	const resources: ResourceView[] = [];
	for (const eff of effects) {
		const res = parseResourceEffect(eff);
		if (res) resources.push(res);
		else if (eff.positive) buffs.push(eff);
		else debuffs.push(eff);
	}
	return { buffs, debuffs, resources };
}

/** Recharge id → the label shown on a resource's recharge chip. */
export const rechargeLabel = (r: Recharge): string =>
	r === 'long' ? 'long rest' : r === 'short' ? 'short rest' : 'special';

/** Rounds an effect has left at the given round counter (null = indefinite, floor 0). */
export const remainingRounds = (e: EffectInstance, round: number): number | null =>
	e.durationRounds == null ? null : Math.max(0, (e.startedRound ?? 0) + e.durationRounds - round);

/** A round-timed effect is expired once the counter has advanced past its duration. */
export const isEffectExpired = (e: EffectInstance, round: number): boolean =>
	e.durationRounds != null && round >= (e.startedRound ?? 0) + e.durationRounds;

/** Spell duration text → rounds (1 round = 6 s): "1 minute" → 10, "Concentration, up to 1 hour" →
 *  600, "2 rounds" → 2. Null when it doesn't map to rounds (Instantaneous / Until dispelled /
 *  Special) — a cast-applied effect is then indefinite (until removed). Pure. */
export function durationToRounds(text: string): number | null {
	const m = /(\d+)\s*(round|minute|hour|day)/i.exec(text);
	if (!m) return null;
	const n = Number(m[1]);
	const unit = (m[2] ?? '').toLowerCase();
	return unit === 'round' ? n : unit === 'minute' ? n * 10 : unit === 'hour' ? n * 600 : n * 14400;
}

/** The common effect durations offered in the duration dropdown (game terms, no round/minute dup).
 *  `rounds: null` = indefinite (until removed). "Custom…" is handled separately in the menu. */
export const EFFECT_DURATION_PRESETS: { label: string; rounds: number | null }[] = [
	{ label: '1 round', rounds: 1 },
	{ label: '1 minute · 10 rds', rounds: 10 },
	{ label: '10 minutes · 100 rds', rounds: 100 },
	{ label: '1 hour · 600 rds', rounds: 600 },
	{ label: '∞ until removed', rounds: null }
];

/** The 18 SRD skills (id order) — for the custom-modifier target picker. */
// the 18 skill ids from the ONE owner (AUDIT F4) — snake-case post-E3, so the target values below
// are `skill.animal_handling` (a stale kebab list here silently produced unmatched targets).
const SKILL_IDS = Object.keys(SKILL_ABILITY) as SkillId[];

/** Targets a custom "+N" modifier can point at, grouped for a native <select> with optgroups.
 *  Values are the exact keys the effects engine matches (`ac`, `save.dex`, `skill.stealth`,
 *  the `saves`/`skills` groups). */
export const MOD_TARGETS: { group: string; opts: { v: string; l: string }[] }[] = [
	{
		group: 'Combat',
		opts: [
			{ v: 'ac', l: 'AC' },
			{ v: 'initiative', l: 'Initiative' },
			{ v: 'speed', l: 'Speed (ft)' }
		]
	},
	{
		group: 'Saves',
		opts: [
			{ v: 'saves', l: 'All saves' },
			...(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => ({
				v: `save.${a}`,
				l: `${a.toUpperCase()} save`
			}))
		]
	},
	{
		group: 'Skills',
		opts: [
			{ v: 'skills', l: 'All skills' },
			...SKILL_IDS.map((s) => ({ v: `skill.${s}`, l: titleCase(s) }))
		]
	}
];

/** A normal tap rolls instantly; Alt/Ctrl/Cmd-click opens the prefilled roll tray. */
export const wantsTray = (e: Event) => {
	const m = e as MouseEvent;
	return m.altKey || m.ctrlKey || m.metaKey;
};

export const PANEL_TITLE: Record<string, string> = {
	skills: 'Skills',
	attacks: 'Attacks',
	spells: 'Spells',
	actions: 'Actions',
	effects: 'Effects & conditions'
};
/** Re-export of the ONE ability-id list (AUDIT F3) — importers keep using `ABIL`. */
export const ABIL: readonly Ability[] = ABILITY_IDS;
export const ABILITY_NAME: Record<Ability, string> = {
	str: 'Strength',
	dex: 'Dexterity',
	con: 'Constitution',
	int: 'Intelligence',
	wis: 'Wisdom',
	cha: 'Charisma'
};
export const DICE = [4, 6, 8, 10, 12, 20, 100];
export const GROUP_MODES = ['level', 'prepared', 'school'] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

/** A weapon/unarmed attack row. */
export interface Atk {
	name: string;
	toHit: number;
	dmg: string;
	meta: string;
}

/** A spell row in the spell block. */
export interface SpRow {
	id: string;
	/** The content ref (effectiveId) — used to set play.concentration when cast. */
	ref: string;
	name: string;
	/** Spell level (0 = cantrip). Drives which spell slot a cast spends (AUDIT A17). */
	level: number;
	/** Ritual-taggable — only these can be cast as a ritual (no slot). Not all spells qualify (SRD). */
	ritual: boolean;
	spe: string;
	res: '' | 'hit' | 'save' | 'auto';
	resLabel: string;
	tm: string;
	ct: '' | 'react' | 'bonus'; // casting time → icon before the level
	dmg: Record<number, number> | null; // parsed damage/healing dice (for casting)
	/** Whether casting this spell requires concentration. */
	conc: boolean;
	prep: '' | 'on' | 'always';
}

/** A group of spells (Pinned / by level / by prepared / by school). */
export interface SpGroup {
	key: string;
	label: string;
	slots: { full: number; spent: number } | null;
	rows: SpRow[];
}

/** Casting-time → the icon shown before the level (↩ reaction, ⚡ bonus). */
const castingIcon = (ct: string): SpRow['ct'] =>
	/bonus/i.test(ct) ? 'bonus' : /reaction/i.test(ct) ? 'react' : '';

/** Short effect summary for a non-damage spell (curated, falls back to "utility"). */
function effectHint(d: Record<string, unknown>): string {
	const range = String(d.range ?? '');
	if (/self/i.test(range) && /step|door|teleport/i.test(String(d.name_en))) return 'teleport';
	if (/counter/i.test(String(d.name_en))) return 'negate spell';
	if (
		/mage hand|prestidig|light|message|minor illusion|mage armor|fly|invis|mirror/i.test(
			String(d.name_en)
		)
	)
		return (
			{
				'mage hand': 'utility',
				'mage armor': 'set AC 13',
				fly: 'fly 60 ft',
				'mirror image': '3 duplicates'
			}[String(d.name_en).toLowerCase()] ?? 'utility'
		);
	return 'utility';
}

/** Human label for a custom-modifier target key (for the auto effect name). Pure. */
export function modTargetLabel(t: string): string {
	if (t === 'saves') return 'to all saves';
	if (t === 'skills') return 'to all skills';
	if (t.startsWith('save.')) return `to ${t.slice(5).toUpperCase()} save`;
	if (t.startsWith('skill.')) return `to ${titleCase(t.slice(6))}`;
	return `to ${t.toUpperCase()}`;
}

/** Parse a weapon/spell damage string ("1d8 +3 slashing", "1d6 −1 bludgeoning") into its dice pool +
 *  flat mod. Handles the unicode minus `signed()` emits. Pure. */
export function parseDamage(dmg: string): { pool: Record<number, number>; mod: number } {
	const pool = parseDicePool(dmg);
	// A7: a die's count must not be read as a flat mod — in "2d6+1d4" the `+1` precedes `d4`, so match
	// a signed number only when NOT immediately followed by `d` (a die is `<count>d<sides>`, never
	// spaced). Damage-type words never start with `d`, so a real "+3 slashing" mod still parses.
	const m = /([+\-−])\s*(\d+)(?!d)/i.exec(dmg);
	const mod = m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
	return { pool, mod };
}

/** Equipped weapons (+ Unarmed Strike) as attack rows, with to-hit/damage from the sheet. Pure. */
export function computeAttacks(
	character: Character,
	sheet: CharacterSheet,
	graph: ContentGraph
): Atk[] {
	const prof = sheet.proficiencyBonus,
		strMod = sheet.abilities.str.mod,
		dexMod = sheet.abilities.dex.mod;
	const out: Atk[] = [];
	for (const inv of character.build.inventory) {
		if (!inv.equipped) continue;
		const row = graph.get(inv.item);
		if (row?.type !== 'item' || row.data.category !== 'weapon') continue;
		const props = String(row.data.properties ?? '').toLowerCase();
		const ranged = String(row.data.item_type ?? '').includes('ranged');
		const mod = ranged ? dexMod : props.includes('finesse') ? Math.max(strMod, dexMod) : strMod;
		out.push({
			name: String(row.data.name_en),
			toHit: mod + prof,
			dmg: `${row.data.damage ?? ''} ${signed(mod)} ${row.data.damage_type ?? ''}`.trim(),
			meta: [row.data.item_type, props.split(/[,;]/)[0]].filter(Boolean).join(' · ')
		});
	}
	out.push({
		name: 'Unarmed Strike',
		toHit: strMod + prof,
		dmg: `${1 + strMod} bludgeoning`,
		meta: 'melee'
	});
	return out;
}

/** The standard combat actions (Dash, Hide, Grapple…); roll ones reference live skills. Pure. */
export function standardActions(sheet: CharacterSheet | null, system: System): StandardAction[] {
	const sk = (k: SkillId) => sheet?.skills[k]?.value ?? 0;
	const is2024 = system === '5.5e';
	return [
		{
			id: 'attack',
			name: 'Attack',
			hint: '',
			desc: 'weapon / spell / unarmed',
			marker: '→ Attacks'
		},
		{ id: 'dash', name: 'Dash', hint: '', desc: '+speed this turn', marker: 'action' },
		{
			id: 'disengage',
			name: 'Disengage',
			hint: '',
			desc: 'no opportunity attacks',
			marker: 'action'
		},
		{ id: 'dodge', name: 'Dodge', hint: '', desc: 'attackers have disadv.', marker: 'action' },
		{
			id: 'hide',
			name: 'Hide',
			hint: signed(sk('stealth')),
			desc: 'Stealth',
			marker: '→ roll',
			roll: ['Hide (Stealth)', sk('stealth')]
		},
		{
			id: 'search',
			name: 'Search',
			hint: signed(sk('perception')),
			desc: 'Perception',
			marker: '→ roll',
			roll: ['Search (Perception)', sk('perception')]
		},
		// Study is a 2024 action; 2014 has no separate Study action
		...(is2024
			? [
					{
						id: 'study',
						name: 'Study',
						hint: signed(sk('arcana')),
						desc: 'recall lore',
						marker: '→ roll',
						roll: ['Study (Arcana)', sk('arcana')] as [string, number]
					}
				]
			: []),
		{
			id: 'grapple',
			name: 'Grapple',
			hint: signed(sk('athletics')),
			desc: 'Athletics vs target',
			marker: 'contest',
			roll: ['Grapple (Athletics)', sk('athletics')]
		},
		{
			id: 'shove',
			name: 'Shove',
			hint: signed(sk('athletics')),
			desc: 'prone / push 5 ft',
			marker: 'contest',
			roll: ['Shove (Athletics)', sk('athletics')]
		},
		{ id: 'help', name: 'Help', hint: '', desc: 'give an ally advantage', marker: 'action' },
		{ id: 'ready', name: 'Ready', hint: '', desc: 'prepare a trigger', marker: 'action' },
		// 2024 renamed 2014's "Use an Object" to "Utilize"
		{
			id: 'utilize',
			name: is2024 ? 'Utilize' : 'Use an Object',
			hint: '',
			desc: 'use an object',
			marker: 'action'
		}
	];
}

/** Group the character's spells for the spell block (Pinned first, then by level / prepared / school),
 *  attaching the castable slot pool per level. Pure — the VM just wraps it in a `$derived`. */
export function buildSpellGroups(
	character: Character,
	sheet: CharacterSheet | null,
	graph: ContentGraph,
	groupBy: GroupMode,
	pinned: Record<string, boolean>,
	/** effectiveIds hidden from the sheet via the spellbook eye (Issue #3) — filtered out entirely. */
	hidden: readonly string[] = []
): SpGroup[] {
	const slotsByLevel = new Map<number, number>();
	for (const p of sheet?.spellcasting.pools ?? [])
		if (!p.forcedUpcast && p.spellLevel) slotsByLevel.set(p.spellLevel, p.max);
	const all = character.build.spells
		.map((sp) => ({
			sp,
			row: spellRow(
				graph,
				sp.spell,
				sp.alwaysPrepared ? 'always' : sp.prepared ? 'on' : '',
				sheet?.level ?? 1
			)
		}))
		.filter((x): x is { sp: (typeof character.build.spells)[number]; row: SpRow } => !!x.row)
		.filter((x) => !hidden.includes(x.row.ref));
	const groups: SpGroup[] = [];
	const pins = all.filter((x) => pinned[x.row.id]);
	if (pins.length)
		groups.push({ key: 'pinned', label: '★ Pinned', slots: null, rows: pins.map((x) => x.row) });

	if (groupBy === 'level') {
		const byLevel = new Map<number, SpRow[]>();
		for (const x of all) {
			const spell = graph.get(x.sp.spell);
			const lvl = spell?.type === 'spell' ? Number(spell.data.level) : 0;
			const bucket = byLevel.get(lvl) ?? [];
			bucket.push(x.row);
			byLevel.set(lvl, bucket);
		}
		for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
			groups.push({
				key: String(lvl),
				label: lvl === 0 ? 'Cantrips' : ordinal(lvl),
				slots:
					lvl === 0
						? null
						: {
								full: slotsByLevel.get(lvl) ?? 0,
								spent: Number(character.play.spellSlotsSpent[String(lvl)] ?? 0)
							},
				rows: byLevel.get(lvl) ?? []
			});
		}
	} else if (groupBy === 'prepared') {
		const prep = all.filter((x) => x.row.prep).map((x) => x.row);
		const rest = all.filter((x) => !x.row.prep).map((x) => x.row);
		if (prep.length) groups.push({ key: 'prep', label: 'Prepared', slots: null, rows: prep });
		if (rest.length) groups.push({ key: 'unprep', label: 'Not prepared', slots: null, rows: rest });
	} else {
		const bySchool = new Map<string, SpRow[]>();
		for (const x of all) {
			const spell = graph.get(x.sp.spell);
			const sch = String((spell?.type === 'spell' ? spell.data.school : '') || 'Other');
			const bucket = bySchool.get(sch) ?? [];
			bucket.push(x.row);
			bySchool.set(sch, bucket);
		}
		for (const sch of [...bySchool.keys()].sort())
			groups.push({
				key: 'sch:' + sch,
				label: titleCase(sch),
				slots: null,
				rows: bySchool.get(sch) ?? []
			});
	}
	return groups;
}

/** Build a spell row from the content graph (or null if the ref is missing). `charLevel` scales
 *  cantrip damage dice (the 5/11/17 steps, both editions — AUDIT A15): Fire Bolt is 2d10 at
 *  character level 5, shown AND rolled that way. */
export function spellRow(
	graph: ContentGraph,
	ref: string,
	prep: SpRow['prep'],
	charLevel = 1
): SpRow | null {
	const row = graph.get(ref);
	if (row?.type !== 'spell') return null;
	const lvl = Number(row.data.level);
	const res = String(row.data.resolution ?? 'none');
	// dice for casting: the damage field, or (for auto/healing spells) the "regains …
	// equal to NdM" dice parsed out of the description
	let dmg =
		String(row.data.damage ?? '') ||
		(res === 'auto' ? healDice(String(row.data.text_en ?? '')) : '');
	const scale = lvl === 0 ? cantripDieMultiplier(charLevel) : 1;
	if (scale > 1)
		dmg = dmg.replace(/(\d+)d(\d+)/gi, (_, n: string, s: string) => `${Number(n) * scale}d${s}`);
	return {
		id: String(row.data.id),
		ref,
		name: String(row.data.name_en),
		level: lvl,
		spe: dmg || effectHint(row.data),
		res: res === 'attack' ? 'hit' : res === 'save' ? 'save' : res === 'auto' ? 'auto' : '',
		resLabel:
			res === 'attack'
				? 'attack roll'
				: res === 'save'
					? `${row.data.save_ability} save`
					: res === 'auto'
						? 'auto'
						: '',
		tm: lvl === 0 ? 'cantrip' : ordinal(lvl),
		ct: castingIcon(String(row.data.casting_time ?? '')),
		dmg: dmg ? parseDicePool(dmg) : null,
		conc: String(row.data.concentration) === 'true',
		ritual: String(row.data.ritual) === 'true',
		prep
	};
}
