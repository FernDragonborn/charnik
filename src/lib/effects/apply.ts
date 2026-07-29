/*
 * L1 effect FOLD seam — turn resolved effects into typed facts, then into stat contributions.
 *
 * `collectFacts` parses the RESOLVED effect list ONCE per derive into the typed `EffectFacts`
 * object (AUDIT D7); `applyEffects` is the single seam that folds the matching facts onto a
 * core `Computed` (numeric → contribution, the rest → notes), preserving the on/off invariant.
 * Every consumer (stat folds, roll path, action economy, panels) reads `EffectFacts`, never a
 * re-scan of raw tokens. The one resolve stage that produces the effect list lives in
 * dependency-graph.ts (`resolveActiveEffects`, in dependency order).
 */
import { computed, NOTE_KEY, type Computed, type Contribution, type Note } from '../rules/pipeline';
import { titleCase } from '../util/format';
import { evalExpression, lintExpression } from './expression-evaluator';
import {
	parseToken,
	resolveEffectValue,
	splitGuard,
	ctxOf,
	EFFECT_KIND,
	MAX_RESOURCE_MAX,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue,
	type ParsedEffect
} from './token-parser';
import { matchesTarget, emptyFacts } from './facts';
import type {
	EffectFacts,
	NumericFact,
	FactRef,
	RollMod,
	TargetValidator,
	ResourceDef
} from './facts';
// re-export the public facts contract so `$lib/effects/apply` import sites are unchanged
export { matchesTarget };
export type { EffectFacts, NumericFact, TargetValidator, TargetCheck, ResourceDef } from './facts';

/**
 * Builds the typed-facts object (D7) in ONE pass over the resolved effect list. State (the facts +
 * the dedup pools/sets) lives in fields so each effect KIND is a small handler — was one
 * complexity-76 for/for/switch. Numeric values (incl. L2 expressions) resolve HERE, once — a
 * resolution failure becomes an `error` fact + an `issues` entry (SPEC10), never a silent drop.
 */
class FactsCollector {
	private readonly facts = emptyFacts();
	private readonly pools = new Map<string, ResourceDef>();
	private readonly resourceIds = new Set<string>();
	private readonly conditions = new Set<string>();

	constructor(
		private readonly ctx?: EffectCtx,
		private readonly issues?: EffectIssue[],
		private readonly isTargetSupported?: TargetValidator
	) {}

	collect(effects: ActiveEffect[]): EffectFacts {
		for (const eff of effects)
			for (const token of eff.tokens) this.collectToken(parseToken(token), eff, token);
		this.facts.resources = [...this.pools.values()];
		this.facts.resourceIds = [...this.resourceIds];
		this.facts.conditions = [...this.conditions];
		return this.facts;
	}

	private collectToken(p: ParsedEffect, eff: ActiveEffect, token: string): void {
		if (this.collectStatFact(p, eff, token)) return;
		if (this.collectRollFact(p, eff, token)) return;
		this.collectOtherFact(p, eff, token);
	}

	// B13 exhaustiveness: a KNOWN kind whose target no consumer reads would fold onto nothing and
	// vanish silently (`flat_bonus:armorclass+1`). The derive that owns the consumers passes a
	// validator over the CLOSED-vocab targets; an unsupported one is kept inert AND surfaced as an
	// issue (content-health) instead of dropped. Returns true = the token was rejected + reported.
	private rejectTarget(kind: string, target: string, source: string, token: string): boolean {
		if (!this.isTargetSupported) return false;
		const check = this.isTargetSupported(kind, target);
		if (check.supported) return false;
		this.issues?.push({
			source,
			token,
			reason: `unknown target "${target}" for ${kind}${check.suggestion ?? ''}`
		});
		return true;
	}

	/** flat_bonus / set_override (→ numeric) + block_bonus + halve — the numeric-fold + bonus-block
	 *  kinds. Returns true iff `p.kind` was one of them. */
	private collectStatFact(p: ParsedEffect, eff: ActiveEffect, token: string): boolean {
		switch (p.kind) {
			case EFFECT_KIND.flatBonus:
			case EFFECT_KIND.setOverride:
				this.pushNumeric(p, eff, token);
				return true;
			case EFFECT_KIND.blockBonus:
				if (p.target && !this.rejectTarget(p.kind, p.target.trim(), eff.source, token))
					this.facts.blockedBonuses.push({ target: p.target.trim(), source: eff.source });
				return true;
			case EFFECT_KIND.halve:
				// G4: a ×½ multiply at the effect's layer. Folds through the pipeline's `mult` op
				// (one product per layer, then floors once — RAW round-down).
				if (p.target && !this.rejectTarget(p.kind, p.target.trim(), eff.source, token))
					this.facts.numeric.push({
						target: p.target.trim(),
						op: 'mult',
						amount: 0.5,
						layer: eff.layer,
						source: eff.source,
						token
					});
				return true;
			default:
				return false;
		}
	}

	private pushNumeric(p: ParsedEffect, eff: ActiveEffect, token: string): void {
		if (!p.target || this.rejectTarget(p.kind, p.target, eff.source, token)) return;
		const op: NumericFact['op'] =
			p.kind === EFFECT_KIND.flatBonus
				? 'add'
				: p.setMode === 'floor'
					? 'floor'
					: p.setMode === 'cap'
						? 'cap'
						: 'set';
		const v = resolveEffectValue(p, ctxOf(this.ctx, eff));
		const fact: NumericFact = { target: p.target, op, layer: eff.layer, source: eff.source, token };
		if (v.amount !== undefined) fact.amount = v.amount;
		else if (v.diceFormula && op === 'add') fact.diceFormula = v.diceFormula;
		else if (v.diceFormula) fact.error = 'an override cannot be a dice value';
		else fact.error = v.error ?? 'no value';
		this.facts.numeric.push(fact);
	}

	/** advantage / disadvantage / auto_fail / auto_succeed (→ FactRef) + reroll / min_die (→ RollMod)
	 *  — the roll-matched flag kinds. Returns true iff `p.kind` was one of them. */
	private collectRollFact(p: ParsedEffect, eff: ActiveEffect, token: string): boolean {
		switch (p.kind) {
			case EFFECT_KIND.advantage:
				return this.pushFlag(this.facts.advantage, p, eff, token);
			case EFFECT_KIND.disadvantage:
				return this.pushFlag(this.facts.disadvantage, p, eff, token);
			case EFFECT_KIND.autoFail:
				return this.pushFlag(this.facts.autoFail, p, eff, token);
			case EFFECT_KIND.autoSucceed:
				return this.pushFlag(this.facts.autoSucceed, p, eff, token);
			case EFFECT_KIND.reroll:
				return this.pushDieMod(this.facts.rerolls, p, eff, token);
			case EFFECT_KIND.minDie:
				return this.pushDieMod(this.facts.minDie, p, eff, token);
			default:
				return false;
		}
	}
	private pushFlag(list: FactRef[], p: ParsedEffect, eff: ActiveEffect, token: string): boolean {
		if (p.target && !this.rejectTarget(p.kind, p.target, eff.source, token))
			list.push({ target: p.target, source: eff.source });
		return true;
	}
	private pushDieMod(list: RollMod[], p: ParsedEffect, eff: ActiveEffect, token: string): boolean {
		if (
			p.target &&
			p.amount !== undefined &&
			!this.rejectTarget(p.kind, p.target, eff.source, token)
		)
			list.push({ target: p.target, value: p.amount });
		return true;
	}

	/** The remaining kinds: grant_proficiency / grant_roll / resist_immune / apply_condition /
	 *  grant_resource / plugin (resolved by the pre-pass) / unknown. */
	private collectOtherFact(p: ParsedEffect, eff: ActiveEffect, token: string): void {
		switch (p.kind) {
			case EFFECT_KIND.grantProficiency:
				if (p.target && !this.rejectTarget(p.kind, p.target.trim(), eff.source, token))
					this.facts.proficiencies.push({
						target: p.target.trim(),
						level: p.proficiency ?? 'proficient',
						source: eff.source
					});
				break;
			case EFFECT_KIND.grantRoll:
				this.pushRoll(p, eff, token);
				break;
			case EFFECT_KIND.resistImmune:
				if (p.target)
					this.facts.defenses.push({
						bucket: p.defense ?? 'resist',
						type: p.target.trim(),
						source: eff.source
					});
				break;
			case EFFECT_KIND.applyCondition:
				if (p.target) this.conditions.add(p.target.trim());
				break;
			case EFFECT_KIND.grantResource:
				this.pushResource(p, eff, token);
				break;
			case EFFECT_KIND.plugin:
				// resolved by the derive PRE-PASS (`expandPluginEffects`), not here — the pre-pass reports
				// every plugin token itself, so counting it as unknown too would double the panel entry.
				break;
			case 'unknown':
				this.facts.unknown.push({ source: eff.source, token });
				break;
		}
	}

	private pushRoll(p: ParsedEffect, eff: ActiveEffect, token: string): void {
		// resolve the expr to a dice formula (or a flat number = a constant roll) for a rollable chip;
		// dedupe by (id, source) like A11. An unresolvable expr → an issue (SPEC10), skipped.
		if (!p.target || !p.valueExpr) return;
		const rv = resolveEffectValue(p, ctxOf(this.ctx, eff));
		const formula = rv.diceFormula ?? (rv.amount !== undefined ? String(rv.amount) : undefined);
		if (formula === undefined) {
			this.issues?.push({ source: eff.source, token, reason: rv.error ?? 'roll has no value' });
			return;
		}
		if (!this.facts.rolls.some((r) => r.id === p.target && r.source === eff.source))
			this.facts.rolls.push({
				id: p.target,
				source: eff.source,
				label: titleCase(p.target),
				formula
			});
	}

	private pushResource(p: ParsedEffect, eff: ActiveEffect, token: string): void {
		if (!p.target) return;
		this.resourceIds.add(p.target);
		if (!p.resource) return;
		// max is either a literal or an L2 expression (`class_level.monk`); an unresolvable expression
		// means the pool count is unknown → skip the pool (a 0-pip render would be noise) but SURFACE it.
		let maxVal: number | undefined;
		if (p.resource.max !== undefined) maxVal = p.resource.max;
		else if (p.resource.maxExpr) {
			const c = ctxOf(this.ctx, eff);
			const r = c
				? evalExpression(p.resource.maxExpr, c)
				: ({ ok: false, error: 'expression needs a context' } as const);
			if (r.ok && r.value.type === 'number') maxVal = Math.floor(r.value.value);
			else
				this.issues?.push({
					source: eff.source,
					token,
					reason: r.ok ? 'resource max is not a number' : r.error
				});
		}
		// max ≤ 0 (a shared-pack `class_level.monk` on a non-monk, a step() below its first threshold) →
		// the pool is benignly ABSENT; the id above still registers so `resource.<id>` reads 0.
		if (maxVal === undefined || maxVal <= 0) return;
		const def: ResourceDef = {
			id: p.resource.id,
			// `inf` (Rage at barbarian 20 = Unlimited) passes the cost-cap: the cap bounds pip-render
			// WORK, and the ∞ render draws no pips at all.
			max: maxVal === Infinity ? Infinity : Math.max(0, Math.min(maxVal, MAX_RESOURCE_MAX)),
			recharge: p.resource.recharge,
			name: titleCase(p.resource.id),
			source: eff.source
		};
		const prev = this.pools.get(def.id);
		// a scaling feature re-granted at a higher tier: the largest max wins
		if (!prev || def.max > prev.max) this.pools.set(def.id, def);
	}
}

/**
 * One pass over the RESOLVED effect list → the typed-facts object (D7). Numeric values (incl. L2
 * expressions) are resolved HERE, once — resolution failures become `error` facts + `issues`
 * entries (SPEC10), never silent drops. Resource pools follow the largest-max-wins rule; condition
 * and resource ids are deduped (the same condition arriving twice applies once — AUDIT A11).
 */
export function collectFacts(
	effects: ActiveEffect[],
	ctx?: EffectCtx,
	issues?: EffectIssue[],
	isTargetSupported?: TargetValidator
): EffectFacts {
	return new FactsCollector(ctx, issues, isTargetSupported).collect(effects);
}

/**
 * Merge a SECOND `collectFacts` result into `base` (in place) — the plugin pre-pass path: returned
 * tokens become synthetic effects, collected separately, then merged. Arrays concatenate;
 * condition/resource ids dedupe; resource pools keep the largest max per id (the same rule
 * `collectFacts` itself applies within one pass).
 */
export function mergeFacts(base: EffectFacts, extra: EffectFacts): void {
	base.numeric.push(...extra.numeric);
	base.blockedBonuses.push(...extra.blockedBonuses);
	base.advantage.push(...extra.advantage);
	base.disadvantage.push(...extra.disadvantage);
	base.autoFail.push(...extra.autoFail);
	base.autoSucceed.push(...extra.autoSucceed);
	base.proficiencies.push(...extra.proficiencies);
	base.defenses.push(...extra.defenses);
	for (const r of extra.rolls)
		if (!base.rolls.some((b) => b.id === r.id && b.source === r.source)) base.rolls.push(r);
	base.rerolls.push(...extra.rerolls);
	base.minDie.push(...extra.minDie);
	base.unknown.push(...extra.unknown);
	base.pluginNotes.push(...extra.pluginNotes);
	base.conditions = [...new Set([...base.conditions, ...extra.conditions])];
	base.resourceIds = [...new Set([...base.resourceIds, ...extra.resourceIds])];
	for (const def of extra.resources) {
		const prev = base.resources.find((r) => r.id === def.id);
		if (!prev) base.resources.push(def);
		else if (def.max > prev.max) base.resources[base.resources.indexOf(prev)] = def;
	}
}

/**
 * The seam: compose effects onto a core-computed stat for `targetKey`. Returns a new
 * `Computed` with the matching numeric contributions folded in and non-numeric effects as
 * notes. With no effects, the value/trace are unchanged (the on/off invariant).
 *
 * Preferred input is the derive's ONE `EffectFacts` (built once via `collectFacts` — D7); a raw
 * `ActiveEffect[]` is also accepted (tests / one-off folds) and converted on the spot.
 */
/** The accumulator a single `applyEffects` fold writes into: the target being folded + the growing
 *  trace and note lists. Bundled so the fold helpers stay within the param budget. */
interface FoldCtx {
	targetKey: string;
	contribs: Contribution[];
	notes: Note[];
}

/** Fold one target-matched numeric fact into the trace (or a degrade note): honors the A9 bonus-block
 *  (effect-borne POSITIVE adds/dice dropped with a note, penalties kept), D12 layering (the fact's own
 *  layer, sets no longer forced to `override`), and the dice/error degrade-to-note paths. */
function foldNumericFact(f: NumericFact, block: FactRef | undefined, acc: FoldCtx): void {
	const { targetKey, contribs, notes } = acc;
	if (f.amount !== undefined) {
		if (block && f.op === 'add' && f.amount > 0)
			notes.push({
				text: `${block.source}: +${f.amount} to ${targetKey} blocked (${f.source})`,
				key: NOTE_KEY.bonusBlocked,
				params: { blocker: block.source, amount: f.amount, target: targetKey, source: f.source }
			});
		else
			contribs.push({
				source: f.source,
				layer: f.layer,
				op: f.op,
				amount: f.amount,
				note: f.token
			});
		return;
	}
	if (f.diceFormula) {
		const d = f.diceFormula;
		if (block && !d.startsWith('-'))
			notes.push({
				text: `${block.source}: +${d} to ${targetKey} blocked (${f.source})`,
				key: NOTE_KEY.bonusBlocked,
				params: { blocker: block.source, amount: d, target: targetKey, source: f.source }
			});
		// `amount` param carries its own sign — a positive dice bonus reads "+1d4", a penalty "-1d4"
		else
			notes.push({
				text: `${f.source}: ${d.startsWith('-') ? d : `+${d}`} to ${targetKey}`,
				key: NOTE_KEY.diceBonus,
				params: { source: f.source, amount: d.startsWith('-') ? d : `+${d}`, target: targetKey }
			});
		return;
	}
	if (f.error)
		notes.push({
			text: `${f.source}: unresolved "${f.token}" (${f.error})`,
			key: NOTE_KEY.unresolved,
			params: { source: f.source, token: f.token, error: f.error }
		});
}

/** Push a `<source>: <label> on <target>` note for each target-matched fact (adv/dis/auto-fail/-succeed
 *  all share this shape). */
function pushFlagNotes(list: FactRef[], label: string, key: string, acc: FoldCtx): void {
	for (const a of list)
		if (matchesTarget(a.target, acc.targetKey))
			acc.notes.push({
				text: `${a.source}: ${label} on ${acc.targetKey}`,
				key,
				params: { source: a.source, target: acc.targetKey }
			});
}

export function applyEffects(
	targetKey: string,
	base: Computed,
	effects: ActiveEffect[] | EffectFacts,
	ctx?: EffectCtx
): Computed {
	const facts = Array.isArray(effects) ? collectFacts(effects, ctx) : effects;
	const acc: FoldCtx = { targetKey, contribs: [...base.trace], notes: [...(base.notes ?? [])] };
	// A9 speed-bonus block: while a block_bonus matches this target, effect-borne POSITIVE bonuses
	// are dropped (RAW). Negative adds (penalties) survive; the BASE trace is never touched.
	const block = facts.blockedBonuses.find((b) => matchesTarget(b.target, targetKey));
	for (const f of facts.numeric)
		if (matchesTarget(f.target, targetKey)) foldNumericFact(f, block, acc);
	pushFlagNotes(facts.advantage, 'advantage', NOTE_KEY.advantage, acc);
	pushFlagNotes(facts.disadvantage, 'disadvantage', NOTE_KEY.disadvantage, acc);
	pushFlagNotes(facts.autoFail, 'auto-fail', NOTE_KEY.autoFail, acc);
	pushFlagNotes(facts.autoSucceed, 'auto-succeed', NOTE_KEY.autoSucceed, acc);
	// BUG-3: re-fold under the base's OWN clamp — a clamped base (speed `{min:0}`, maxHp `{min:1}`)
	// must keep its floor even when zero effects fold, or the on/off/deleted invariant breaks.
	return computed(acc.contribs, base.clamp, acc.notes.length ? acc.notes : undefined);
}

/** Authoring-slip warnings for one row's effect tokens (content-health): lints every L2 expression
 *  slot — guard, value, resource max — for the spec-promised soft warns (mixed-type `if()`,
 *  unusual die). Parse ERRORS are not reported here; they surface at derive as issues/inert notes. */
export function lintEffectTokens(tokens: string[]): string[] {
	const warns: string[] = [];
	for (const raw of tokens) {
		const g = splitGuard(raw);
		const exprs: string[] = [];
		if (g.guard !== undefined) exprs.push(g.guard);
		const p = parseToken(g.token);
		if (p.valueExpr) exprs.push(p.valueExpr);
		// a LITERAL dice bonus (`+1d7`) parses to `p.dice`, not `valueExpr` — lint it too, else the most
		// common author typo (an unusual die size in the fast-path form) would silently skip the warning
		if (p.dice) exprs.push(p.dice);
		if (p.resource?.maxExpr) exprs.push(p.resource.maxExpr);
		for (const e of exprs) for (const w of lintExpression(e)) warns.push(`${raw} — ${w}`);
	}
	return warns;
}
