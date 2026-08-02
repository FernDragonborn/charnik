/*
 * The Combat "Effects & conditions" panel view-model: turn a Computed's trace into a "why" string,
 * turn effect tokens / typed facts into short display tags, split active effects into buffs /
 * debuffs / resources, and duration math. Pure. Split out of the old combat/helpers.ts junk-drawer.
 */
import { ABILITY_IDS } from '$lib/rules/core';
import { formatNote, type Computed, type Contribution } from '$lib/rules/pipeline';
import { titleCase, signed } from '$lib/util/format';
import { parseToken, EFFECT_KIND, type Recharge } from '$lib/effects/token-parser';
import type { EffectFacts, NumericFact } from '$lib/effects/apply';
import type { EffectInstance } from '$lib/character/schema';

/** A runtime effect instance — the character-schema type, re-exported for the combat views. */
export type { EffectInstance } from '$lib/character/schema';

/** Provenance trace of a Computed → a human-readable "why" string for tooltips. Pass `translate`
 *  (svelte-i18n's `$format`) to localize the rule notes; without it every note renders its EN text
 *  verbatim (the B18 invariant — structure changed, EN output byte-for-byte unchanged). */
export function why(
	c: Computed,
	translate?: (key: string, params?: Record<string, string | number>) => string
): string {
	const opSym = (op: Contribution['op']): string =>
		op === 'set' ? '= ' : op === 'floor' ? '≥ ' : op === 'cap' ? '≤ ' : '';
	const parts = c.trace
		.filter((t) => t.amount !== 0 || t.op === 'set' || t.op === 'floor' || t.op === 'cap')
		.map((t) => `${t.source} ${opSym(t.op)}${signed(t.amount)}${t.note ? ` (${t.note})` : ''}`);
	return (
		(parts.join(', ') || '—') +
		(c.notes?.length ? ' · ' + c.notes.map((n) => formatNote(n, translate)).join(' · ') : '')
	);
}

/** A bounded-vocab target key → a short readable label ("ac" → "AC", "save.dex" → "DEX save",
 *  "skill.stealth" → "Stealth", "saves"/"skills" → the group names). */
function targetLabel(t: string): string {
	if (t === 'saves') return 'all saves';
	if (t === 'skills') return 'all skills';
	if (t.startsWith('save.')) return `${t.slice(5).toUpperCase()} save`;
	if (t.startsWith('skill.')) return titleCase(t.slice(6));
	if (t === 'ac') return 'AC';
	if ((ABILITY_IDS as readonly string[]).includes(t)) return t.toUpperCase(); // STR/DEX/…
	return titleCase(t);
}

type ParsedEffect = ReturnType<typeof parseToken>;

/** flat_bonus delta: "+2" / "−1" / "+1d4" / "−1d6" (literal amount OR a dice string). */
function flatDelta(p: ParsedEffect): string {
	return p.amount !== undefined
		? `${p.amount < 0 ? '−' : '+'}${Math.abs(p.amount)}`
		: `${p.dice?.startsWith('-') ? '−' : '+'}${p.dice?.replace('-', '') ?? ''}`;
}

/** Per-kind tag formatter (assumes the required field is present — the caller guards on the result).
 *  Each returns undefined when its token lacks a target/plugin, falling through to the raw fallback. */
const TAG_FORMATTERS: Partial<
	Record<ParsedEffect['kind'], (p: ParsedEffect) => string | undefined>
> = {
	[EFFECT_KIND.flatBonus]: (p) => p.target && `${targetLabel(p.target)} ${flatDelta(p)}`,
	[EFFECT_KIND.setOverride]: (p) =>
		p.target &&
		`${targetLabel(p.target)} ${p.setMode === 'floor' ? '≥' : p.setMode === 'cap' ? '≤' : '='} ${p.amount ?? p.valueExpr ?? '?'}`,
	[EFFECT_KIND.blockBonus]: (p) => p.target && `block · ${targetLabel(p.target)}`,
	[EFFECT_KIND.halve]: (p) => p.target && `${targetLabel(p.target)} ×½`,
	[EFFECT_KIND.resistImmune]: (p) => p.target && `${p.defense ?? 'resist'} · ${p.target}`,
	[EFFECT_KIND.advantage]: (p) => p.target && `adv · ${targetLabel(p.target)}`,
	[EFFECT_KIND.disadvantage]: (p) => p.target && `disadv · ${targetLabel(p.target)}`,
	[EFFECT_KIND.grantProficiency]: (p) => p.target && `prof · ${titleCase(p.target)}`,
	[EFFECT_KIND.grantRoll]: (p) => p.target && `roll · ${titleCase(p.target)}`,
	[EFFECT_KIND.applyCondition]: (p) => p.target && titleCase(p.target),
	[EFFECT_KIND.autoFail]: (p) => p.target && `auto-fail · ${targetLabel(p.target)}`,
	[EFFECT_KIND.autoSucceed]: (p) => p.target && `auto-succeed · ${targetLabel(p.target)}`,
	[EFFECT_KIND.note]: (p) => p.target, // free-form display text, as authored
	// a handler REFERENCE — the namespace is the readable part; args are opaque machine input
	[EFFECT_KIND.plugin]: (p) => p.plugin && `plugin · ${p.plugin.namespace}`
};

/** A bounded-vocab effect token → a short readable tag for the effects panel:
 *  flat_bonus → "AC +2" / "saves +1d4"; set_override → "AC = 13"; resist_immune → "resist · fire";
 *  advantage → "adv · <target>"; grant_proficiency → "prof · <target>"; apply_condition → the name.
 *  grant_resource is NOT tagged here — it gets its own Resources section (see groupEffects). */
export function effectTag(token: string): string {
	const p = parseToken(token);
	return TAG_FORMATTERS[p.kind]?.(p) || token.replace(/[-:]/g, ' ');
}

/** One source's derived contributions, as short display tags (B14). */
export interface DerivedEffectGroup {
	source: string;
	tags: string[];
}

/** A short tag for a numeric fact, formatted from the FACT FIELDS (never re-parsing the token — the
 *  D7 invariant): "AC +1" / "Speed = 0" / "INT ≥ 19" / "hp_max ×½" / "attack +1d6". */
function numericFactTag(f: NumericFact): string {
	const t = targetLabel(f.target);
	if (f.amount !== undefined) {
		if (f.op === 'set') return `${t} = ${f.amount}`;
		if (f.op === 'floor') return `${t} ≥ ${f.amount}`;
		if (f.op === 'cap') return `${t} ≤ ${f.amount}`;
		if (f.op === 'mult') return `${t} ×${f.amount === 0.5 ? '½' : f.amount}`;
		return `${t} ${signed(f.amount)}`;
	}
	if (f.diceFormula) return `${t} ${f.diceFormula.startsWith('-') ? '' : '+'}${f.diceFormula}`;
	return `${t} (unresolved)`;
}

/**
 * B14: the effects panel's read-only "from items & features" view. Reads the sheet's ONE typed-facts
 * object (D7) — NEVER re-parses raw tokens — and surfaces the content-borne NUMERIC contributions
 * (item/feature layers, so it doesn't duplicate the runtime buff/debuff rows or the conditions the
 * panel already lists), grouped by source, plus the unknown tokens (distinctly styled inert notes).
 * Advantage/defense/proficiency facts already surface on their own stats, so they stay out here.
 */
export function describeDerivedEffects(facts: EffectFacts): {
	groups: DerivedEffectGroup[];
	unknown: { source: string; token: string }[];
} {
	const bySource = new Map<string, string[]>();
	for (const f of facts.numeric) {
		if (f.layer !== 'item' && f.layer !== 'feature') continue;
		const cur = bySource.get(f.source);
		if (cur) cur.push(numericFactTag(f));
		else bySource.set(f.source, [numericFactTag(f)]);
	}
	return {
		groups: [...bySource.entries()].map(([source, tags]) => ({ source, tags })),
		unknown: facts.unknown
	};
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
	r === 'long'
		? 'long rest'
		: r === 'short'
			? 'short rest'
			: r === 'short_one'
				? 'short rest (+1)'
				: 'special';

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
