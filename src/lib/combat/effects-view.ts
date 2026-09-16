/*
 * The Combat "Effects & conditions" panel view-model: turn a Computed's trace into a "why" string,
 * turn effect tokens / typed facts into short display tags, split active effects into buffs /
 * debuffs / resources, and duration math. Pure. Split out of the old combat/helpers.ts junk-drawer.
 */
import { ABILITY_IDS } from '$lib/rules/core';
import {
	formatNote,
	sourceNoteText,
	sourceText,
	type Computed,
	type Contribution,
	type Translate,
} from '$lib/rules/pipeline';
import { abilityShortLabel, titleCase, signed } from '$lib/util/format';
import { parseToken, EFFECT_KIND, type RechargePolicy } from '$lib/effects/token-parser';
import type { EffectFacts, NumericFact } from '$lib/effects/apply';
import type { EffectInstance } from '$lib/character/schema';
import type { SaidText } from '$lib/util/say';
import { RECHARGE_ALL } from '$lib/rules/recharge';

/** A runtime effect instance — the character-schema type, re-exported for the combat views. */
export type { EffectInstance } from '$lib/character/schema';

/** Ops that read as a comparison get a symbol; a plain addend or multiplier reads as its own sign. */
const OP_SYMBOL: Record<Contribution['op'], string> = {
	add: '',
	mult: '',
	set: '=',
	floor: '≥',
	cap: '≤',
};

/** Provenance trace of a Computed → a human-readable "why" string for tooltips. Pass `translate`
 *  (svelte-i18n's `$format`) to localize the rule notes; without it every note renders its EN text
 *  verbatim (the B18 invariant — structure changed, EN output byte-for-byte unchanged). */
export function why(c: Computed, translate?: Translate): string {
	const opSym = (op: Contribution['op']): string => (OP_SYMBOL[op] ? `${OP_SYMBOL[op]} ` : '');
	const parts = c.trace
		// a comparison op says something even at 0; a plain addend of 0 says nothing
		.filter((t) => t.amount !== 0 || OP_SYMBOL[t.op] !== '')
		.map((t) => {
			const detail = sourceNoteText(t, translate);
			return `${sourceText(t, translate)} ${opSym(t.op)}${signed(t.amount)}${detail ? ` (${detail})` : ''}`;
		});
	return (
		(parts.join(', ') || '—') +
		(c.notes?.length ? ' · ' + c.notes.map((n) => formatNote(n, translate)).join(' · ') : '')
	);
}

/** What a passive score IS, said before the arithmetic of one. The sheet shows a passive beside
 *  every skill and never said what the number is FOR, which is the one thing a player new to it asks.
 *  Carries its own English for the translator-less callers, the same contract `why` keeps. */
const PASSIVE_MEANING = {
	key: 'provenance.passiveMeaning',
	en: 'Passive: what you notice without rolling — the DM reads this instead of asking for a check.',
};

/** `why` for a passive score, with the sentence that says what a passive score is on top of it. */
export function whyPassive(c: Computed, translate?: Translate): string {
	const meaning = translate ? translate(PASSIVE_MEANING.key) : PASSIVE_MEANING.en;
	// the popover renders `pre-line`, so the sentence and the breakdown read as two lines
	return `${meaning}\n${why(c, translate)}`;
}

/** A target key → its catalog key and the English it reads as with no translator. Both live in one
 *  entry because they are one fact said twice: the module is locale-free, so a caller that hands it
 *  no translator (a node test, an attack note) still gets a readable label rather than a key.
 *  Everything outside this map is a dotted family (`save.<ab>`, `skill.<id>`, `passive.<skill>`), an
 *  ability, or a homebrew target — all handled below. */
const TARGET: Record<string, { key: string; en: string }> = {
	saves: { key: 'combat.tag.allSaves', en: 'all saves' },
	skills: { key: 'combat.tag.allSkills', en: 'all skills' },
	ability_checks: { key: 'combat.tag.abilityChecks', en: 'ability checks' },
	d20_tests: { key: 'combat.tag.d20Tests', en: 'all d20 tests' },
	ac: { key: 'combat.tag.ac', en: 'AC' },
	initiative: { key: 'combat.tag.initiative', en: 'Initiative' },
	speed: { key: 'combat.tag.speed', en: 'Speed' },
	'speed.fly': { key: 'combat.tag.speedFly', en: 'Fly speed' },
	'speed.swim': { key: 'combat.tag.speedSwim', en: 'Swim speed' },
	hp_max: { key: 'combat.tag.hpMax', en: 'Max HP' },
	attack: { key: 'combat.tag.attack', en: 'Attack' },
	damage: { key: 'combat.tag.damage', en: 'Damage' },
	spell_dc: { key: 'combat.tag.spellDc', en: 'Spell DC' },
	spell_attack: { key: 'combat.tag.spellAttack', en: 'Spell attack' },
	'save.death': { key: 'combat.tag.saveDeath', en: 'Death save' },
	action: { key: 'combat.tag.action', en: 'Action' },
	bonus: { key: 'combat.tag.bonus', en: 'Bonus action' },
	reaction: { key: 'combat.tag.reaction', en: 'Reaction' },
};

/** Say one catalog key, falling back to the English it reads as when no translator was handed in. */
function say(
	translate: Translate | undefined,
	key: string,
	en: string,
	values?: Record<string, string | number>,
): string {
	return translate ? translate(key, { ...(values ? { values } : {}), default: en }) : en;
}

/** A bounded-vocab target key → a short readable label ("ac" → "AC", "save.dex" → "DEX save",
 *  "skill.stealth" → "Stealth", "saves"/"skills" → the group names). */
function targetLabel(t: string, translate?: Translate): string {
	const known = TARGET[t];
	if (known) return say(translate, known.key, known.en);
	const ability = (id: string) => abilityShortLabel(id, translate);
	const skill = (id: string) => say(translate, `skillName.${id}`, titleCase(id));
	if (t.startsWith('save.')) {
		const ab = ability(t.slice(5));
		return say(translate, 'entryMeta.save', `${ab} save`, { ability: ab });
	}
	if (t.startsWith('skill.')) return skill(t.slice(6));
	if (t.startsWith('passive.')) {
		const s = skill(t.slice(8));
		return say(translate, 'combat.tag.passive', `Passive ${s}`, { skill: s });
	}
	if ((ABILITY_IDS as readonly string[]).includes(t)) return ability(t); // STR/DEX/…
	return titleCase(t); // a homebrew target is a content row's own word
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
	Record<ParsedEffect['kind'], (p: ParsedEffect, tr?: Translate) => string | undefined>
> = {
	[EFFECT_KIND.flatBonus]: (p, tr) => p.target && `${targetLabel(p.target, tr)} ${flatDelta(p)}`,
	[EFFECT_KIND.setOverride]: (p, tr) =>
		p.target &&
		`${targetLabel(p.target, tr)} ${OP_SYMBOL[p.setMode ?? 'set']} ${p.amount ?? p.valueExpr ?? '?'}`,
	[EFFECT_KIND.blockBonus]: (p, tr) => p.target && prefixed(tr, 'block', p.target),
	[EFFECT_KIND.halve]: (p, tr) =>
		p.target &&
		say(tr, 'combat.tag.halve', `${targetLabel(p.target)} ×½`, {
			target: targetLabel(p.target, tr),
		}),
	[EFFECT_KIND.damageSensitivity]: (p, tr) =>
		p.target &&
		p.sensitivity &&
		say(tr, 'combat.tag.sensitivity', `${p.sensitivity} · ${p.target}`, {
			sensitivity: say(tr, `combat.sensitivity.${p.sensitivity}`, p.sensitivity),
			target: say(tr, `damageType.${p.target}`, p.target),
		}),
	[EFFECT_KIND.advantage]: (p, tr) => p.target && prefixed(tr, 'advantage', p.target),
	[EFFECT_KIND.disadvantage]: (p, tr) => p.target && prefixed(tr, 'disadvantage', p.target),
	[EFFECT_KIND.grantProficiency]: (p, tr) =>
		p.target &&
		say(tr, 'combat.tag.proficiency', `prof · ${titleCase(p.target)}`, {
			target: targetLabel(p.target, tr),
		}),
	[EFFECT_KIND.grantRoll]: (p, tr) =>
		p.target &&
		say(tr, 'combat.tag.grantRoll', `roll · ${titleCase(p.target)}`, {
			target: targetLabel(p.target, tr),
		}),
	[EFFECT_KIND.applyCondition]: (p) => p.target && titleCase(p.target),
	[EFFECT_KIND.autoFail]: (p, tr) => p.target && prefixed(tr, 'autoFail', p.target),
	[EFFECT_KIND.autoSucceed]: (p, tr) => p.target && prefixed(tr, 'autoSucceed', p.target),
	[EFFECT_KIND.note]: (p) => p.target, // free-form display text, as authored
	// the two roll MANIPULATIONS read as what they do to a die, not as their token
	[EFFECT_KIND.reroll]: (p, tr) =>
		p.target &&
		say(tr, 'combat.tag.reroll', `reroll ≤${p.amount} · ${targetLabel(p.target)}`, {
			value: p.amount ?? 0,
			target: targetLabel(p.target, tr),
		}),
	[EFFECT_KIND.minDie]: (p, tr) =>
		p.target &&
		say(tr, 'combat.tag.minDie', `min ${p.amount} · ${targetLabel(p.target)}`, {
			value: p.amount ?? 0,
			target: targetLabel(p.target, tr),
		}),
	// the two MARKERS carry no target or value — the whole tag is the sentence
	[EFFECT_KIND.blocksConcentration]: (_p, tr) =>
		say(tr, 'combat.tag.blocksConcentration', 'blocks concentration'),
	[EFFECT_KIND.damageReroll]: (_p, tr) => say(tr, 'combat.tag.damageReroll', 'may reroll damage'),
	[EFFECT_KIND.regainOnInitiative]: (p, tr) =>
		p.target &&
		say(tr, 'combat.tag.regainOnInitiative', `${titleCase(p.target)} +${p.amount} on initiative`, {
			value: p.amount ?? 0,
			target: titleCase(p.target),
		}),
	// an event HOOK: when it fires, and what it runs. The action keeps its own machine spelling —
	// it is a verb token, and translating half of it would read worse than showing it whole.
	[EFFECT_KIND.onEvent]: (p, tr) =>
		p.target &&
		p.action &&
		say(tr, 'combat.tag.onEvent', `on ${p.target.replace(/_/g, ' ')} · ${p.action}`, {
			event: say(tr, `combat.playEvent.${p.target}`, p.target.replace(/_/g, ' ')),
			action: p.action,
		}),
	// a handler REFERENCE — the namespace is the readable part; args are opaque machine input
	[EFFECT_KIND.plugin]: (p, tr) =>
		p.plugin &&
		say(tr, 'combat.tag.plugin', `plugin · ${p.plugin.namespace}`, {
			namespace: p.plugin.namespace,
		}),
};

/** The tags shaped "<what> · <target>" — one key, one target label, said once. */
const PREFIX_EN: Record<string, string> = {
	block: 'block',
	advantage: 'adv',
	disadvantage: 'disadv',
	autoFail: 'auto-fail',
	autoSucceed: 'auto-succeed',
};
function prefixed(tr: Translate | undefined, kind: keyof typeof PREFIX_EN, target: string): string {
	return say(tr, `combat.tag.${kind}`, `${PREFIX_EN[kind]} · ${targetLabel(target)}`, {
		target: targetLabel(target, tr),
	});
}

/** A bounded-vocab effect token → a short readable tag for the effects panel:
 *  flat_bonus → "AC +2" / "saves +1d4"; set_override → "AC = 13"; damage_sensitivity → "resist · fire";
 *  advantage → "adv · <target>"; grant_proficiency → "prof · <target>"; apply_condition → the name;
 *  the roll manips, the two markers and `on_event` → what they do. EVERY kind but one has a formatter:
 *  grant_resource is deliberately absent — it gets its own Resources section (see groupEffects) — and
 *  the raw fallback below is for a homebrew token nothing parses, never for a kind we ship. */
export function effectTag(token: string, translate?: Translate): string {
	const p = parseToken(token);
	return TAG_FORMATTERS[p.kind]?.(p, translate) || token.replace(/[-:]/g, ' ');
}

/** Panel tag for a token, preferring the DERIVE-RESOLVED value when the token's value is an L2
 *  EXPRESSION — `effectTag` alone can only show a literal, so an expression-valued numeric renders as
 *  a bare "Damage +". Match the resolved `NumericFact` (by its guard-stripped token) and render its
 *  concrete amount ("Damage +2"). Falls back to the literal tag for everything else. */
export function effectTagResolved(
	token: string,
	facts: { numeric: NumericFact[] },
	translate?: Translate,
): string {
	const f = facts.numeric.find(
		(n) => n.token === token && (n.amount !== undefined || n.diceFormula),
	);
	return f ? numericFactTag(f, translate) : effectTag(token, translate);
}

/** One source's derived contributions, as short display tags (B14). */
export interface DerivedEffectGroup {
	source: string;
	tags: string[];
}

/** A short tag for a numeric fact, formatted from the FACT FIELDS (never re-parsing the token — the
 *  D7 invariant): "AC +1" / "Speed = 0" / "INT ≥ 19" / "hp_max ×½" / "attack +1d6". */
function numericFactTag(f: NumericFact, translate?: Translate): string {
	const t = targetLabel(f.target, translate);
	if (f.amount !== undefined) {
		if (f.op === 'set') return `${t} = ${f.amount}`;
		if (f.op === 'floor') return `${t} ≥ ${f.amount}`;
		if (f.op === 'cap') return `${t} ≤ ${f.amount}`;
		if (f.op === 'mult') return `${t} ×${f.amount === 0.5 ? '½' : f.amount}`;
		return `${t} ${signed(f.amount)}`;
	}
	if (f.diceFormula) return `${t} ${f.diceFormula.startsWith('-') ? '' : '+'}${f.diceFormula}`;
	return say(translate, 'combat.tag.unresolved', `${targetLabel(f.target)} (unresolved)`, {
		target: t,
	});
}

/**
 * B14: the effects panel's read-only "from items & features" view. Reads the sheet's ONE typed-facts
 * object (D7) — NEVER re-parses raw tokens — and surfaces the content-borne NUMERIC contributions
 * (item/feature layers, so it doesn't duplicate the runtime buff/debuff rows or the conditions the
 * panel already lists), grouped by source, plus the unknown tokens (distinctly styled inert notes).
 * Advantage/defense/proficiency facts already surface on their own stats, so they stay out here.
 */
export function describeDerivedEffects(
	facts: EffectFacts,
	translate?: Translate,
): {
	groups: DerivedEffectGroup[];
	unknown: { source: string; token: string }[];
} {
	const bySource = new Map<string, string[]>();
	for (const f of facts.numeric) {
		if (f.layer !== 'item' && f.layer !== 'feature') continue;
		const cur = bySource.get(f.source);
		if (cur) cur.push(numericFactTag(f, translate));
		else bySource.set(f.source, [numericFactTag(f, translate)]);
	}
	return {
		groups: [...bySource.entries()].map(([source, tags]) => ({ source, tags })),
		unknown: facts.unknown,
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
	recharge: RechargePolicy;
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
				recharge: p.resource.recharge,
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

/** What a recharge chip SAYS: the boundary, plus the amount when it is not the whole pool. One key
 *  per shape rather than a composed sentence — "(+1d6+1)" is a parenthetical a translator has to be
 *  able to move, and a partial refill reads differently in different languages. The amount is dice
 *  NOTATION or a number, so it passes through untranslated. */
export const rechargeLabel = (policy: RechargePolicy): SaidText =>
	policy.amount === RECHARGE_ALL
		? { key: `combat.recharge.${policy.trigger}` }
		: { key: `combat.recharge.${policy.trigger}Amount`, values: { amount: policy.amount } };

/** Rounds an effect has left at the given round counter (null = indefinite, floor 0). */
export const remainingRounds = (e: EffectInstance, round: number): number | null =>
	e.durationRounds == null ? null : Math.max(0, (e.startedRound ?? 0) + e.durationRounds - round);

/**
 * An effect leaving the sheet takes its concentration WITH it. The carrier effect IS the
 * concentration (CONCENTRATION-PLAN model C: the carrier owns the clock and `play.concentration` is
 * a ref to it), so a removed or expired one has to clear the ref too — or the indicator at the top
 * of the sheet keeps naming a spell that is no longer running.
 *
 * One seam for all three ways an effect can go: the panel's ✕, a rest that outlasts it, and the
 * round counter passing its duration.
 */
export function endConcentrationCarriedBy(
	play: { concentration: string | null },
	gone: readonly EffectInstance[],
): void {
	for (const e of gone) if (e.source && e.source === play.concentration) play.concentration = null;
}

/** A round-timed effect is expired once the counter has advanced past its duration. */
export const isEffectExpired = (e: EffectInstance, round: number): boolean =>
	e.durationRounds != null && round >= (e.startedRound ?? 0) + e.durationRounds;

const ROUNDS_PER_UNIT: Record<string, number> = { round: 1, minute: 10, hour: 600, day: 14400 };

/** Spell duration text → rounds (1 round = 6 s): "1 minute" → 10, "Concentration, up to 1 hour" →
 *  600, "2 rounds" → 2. Null when it doesn't map to rounds (Instantaneous / Until dispelled /
 *  Special) — a cast-applied effect is then indefinite (until removed). Pure. */
export function durationToRounds(text: string): number | null {
	const m = /(\d+)\s*(round|minute|hour|day)/i.exec(text);
	if (!m) return null;
	const n = Number(m[1]);
	const unit = (m[2] ?? '').toLowerCase();
	return n * (ROUNDS_PER_UNIT[unit] ?? 1);
}

/** The common effect durations offered in the duration dropdown (game terms, no round/minute dup).
 *  `rounds: null` = indefinite (until removed). "Custom…" is handled separately in the menu. */
export const EFFECT_DURATION_PRESETS: { label: string; rounds: number | null }[] = [
	{ label: 'combat.duration.round1', rounds: 1 },
	{ label: 'combat.duration.minute1', rounds: 10 },
	{ label: 'combat.duration.minutes10', rounds: 100 },
	{ label: 'combat.duration.hour1', rounds: 600 },
	{ label: 'combat.duration.untilRemoved', rounds: null },
];
