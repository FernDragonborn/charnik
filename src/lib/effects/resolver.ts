/*
 * The ONE resolve stage, in DEPENDENCY order (closes AUDIT A10 + the DAG deferred from EXPR-3):
 * gather → order value-WRITING tokens by what other tokens' guards/values READ (the graph +
 * ordering live in ./dependency-graph) → evaluate guards against the progressively-resolved state →
 * expand `apply_condition` (one level, guard-checked) → emit the guard-stripped effect list every
 * consumer reads, plus the ability scores as traced, clamped `Computed`s (A10: through the same
 * fold/clamp pipeline as every other stat).
 *
 * A genuine CYCLE (an effect whose condition depends on its own output — "+10 max HP while below
 * half HP") has no unique answer: it is a CONTENT BUG, detected in the graph order, surfaced as a
 * derive issue, and its writers degrade to inert notes — never an iterate-to-fixpoint loop
 * (PLUGINS.md §8.4, PLAN "State model").
 */
import { ABILITY_IDS, abilityModifier, ABILITY_SCORE_CLAMP, type Ability } from '../rules/core';
import { computed, type Computed, type Contribution } from '../rules/pipeline';
import { evalExpression, type ExprContext } from './expression-evaluator';
import {
	EFFECT_KIND,
	MAX_RESOURCE_MAX,
	parseToken,
	resolveEffectValue,
	splitGuard,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue
} from './token-parser';
import {
	abilityKey,
	buildDependencyOrder,
	HP_MAX_KEY,
	readsOf,
	writeKeyOf,
	type DepKey,
	type DependencyResolved,
	type Inst,
	type ResolveArgs,
	type ResolveState
} from './dependency-graph';

/** A one-level `apply_condition` expansion: the condition row's label + its token instances +
 *  every applier instance (A11: ONE child set per condition id, applies iff any applier survives). */
type Expansion = { label: string; children: Inst[]; appliers: Inst[] };

/** One token occurrence → an Inst (guard split + parse + its graph reads/write). Pure. */
function makeInst(eff: ActiveEffect, raw: string, condId?: string, condLabel?: string): Inst {
	const g = splitGuard(raw);
	const parsed = parseToken(g.token);
	return {
		eff,
		raw,
		...(g.guard !== undefined ? { guard: g.guard } : {}),
		body: g.token,
		parsed,
		writeKey: writeKeyOf(parsed),
		reads: readsOf(g.guard, parsed, condId),
		...(condId !== undefined ? { condId } : {}),
		...(condLabel !== undefined ? { condLabel } : {}),
		disposition: 'pending'
	};
}

/** Human label for an instance's source (a condition child appends "→ <condition>"). */
function sourceOf(inst: Inst): string {
	return inst.condLabel !== undefined ? `${inst.eff.source} → ${inst.condLabel}` : inst.eff.source;
}

/** Kept token strings from a list: applied → body (guard-stripped), inert → raw (kept verbatim). */
function keptTokens(list: Inst[]): string[] {
	const kept: string[] = [];
	for (const inst of list) {
		if (inst.disposition === 'applied') kept.push(inst.body);
		else if (inst.disposition === 'inert') kept.push(inst.raw);
	}
	return kept;
}

/** The resolved effect list (base effects first, expansions after — the B21 contract; ONE expansion
 *  per condition id, attributed to the first applier that survived — A11). */
function assembleResolved(
	active: ActiveEffect[],
	insts: Inst[],
	expansions: Map<string, Expansion>
): ActiveEffect[] {
	const out: ActiveEffect[] = [];
	for (const eff of active) {
		const kept = keptTokens(insts.filter((i) => i.eff === eff && i.condId === undefined));
		if (kept.length) out.push({ ...eff, tokens: kept });
	}
	for (const ex of expansions.values()) {
		const applier = ex.appliers.find((a) => a.disposition === 'applied');
		if (!applier) continue;
		const kept = keptTokens(ex.children);
		if (kept.length)
			out.push({ source: `${applier.eff.source} → ${ex.label}`, layer: 'condition', tokens: kept });
	}
	return out;
}

/** Zeroed ability record — the resolve state's score/mod seed. */
function zeroAbilities(): Record<Ability, number> {
	const r = {} as Record<Ability, number>;
	for (const ab of ABILITY_IDS) r[ab] = 0;
	return r;
}

/** A11 (D&D "Combining Game Effects"): the SAME named runtime effect applied twice (two Bless casts)
 *  applies once. Dedupe by (source label + token list) on the 'condition' layer only — build-time
 *  layers stay per-instance (a repeatable feat legitimately applies each time). */
function dedupeRuntimeEffects(active: ActiveEffect[]): ActiveEffect[] {
	const seen = new Set<string>();
	return active.filter((eff) => {
		if (eff.layer !== 'condition') return true;
		const k = `${eff.source}|${eff.tokens.join(';')}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

/**
 * The dependency resolver: the shared resolve state lives in FIELDS and each pipeline stage is a
 * small method (gather instances → order value nodes → condemn cycles → fold nodes in dependency
 * order → decide plain-token guards → assemble). Was one closure-heavy function; the fields simply
 * replace what were closure captures, so every method reads/writes the one live state.
 */
class Resolver {
	private readonly issues: EffectIssue[] = [];
	private readonly state: ResolveState;
	private readonly ctx: EffectCtx;
	private readonly active: ActiveEffect[];
	private readonly insts: Inst[] = [];
	private readonly expansions = new Map<string, Expansion>();
	private nodeIds: DepKey[] = [];
	private nodeIndex = new Map<DepKey, number>();
	private order: number[] = [];
	private cyclic = new Set<number>();
	private readonly abilities = {} as Record<Ability, Computed>;
	/** hp_max base (pre-effect) folded at the final CON — reassigned when the hp_max node folds. */
	private hpMaxBase: Computed;

	constructor(private readonly args: ResolveArgs) {
		this.state = {
			scores: zeroAbilities(),
			mods: zeroAbilities(),
			hpMax: { value: 0 },
			conditions: new Set(),
			resources: {},
			resourceMax: {}
		};
		this.ctx = args.makeCtx(this.state);
		this.hpMaxBase = computed(args.hpMaxBase?.(0) ?? [], { min: 1 });
		this.active = dedupeRuntimeEffects(args.active);
	}

	run(): DependencyResolved {
		this.gatherInstances();
		({
			nodeIds: this.nodeIds,
			nodeIndex: this.nodeIndex,
			order: this.order,
			cyclic: this.cyclic
		} = buildDependencyOrder(this.insts));
		this.condemnCyclicWriters();
		const writersByNode = this.groupWritersByNode();
		this.foldNodesInOrder(writersByNode);
		// plain (non-writing) tokens: guards read the FINAL state
		for (const inst of this.insts) if (inst.disposition === 'pending') this.decide(inst);
		return {
			effects: assembleResolved(this.active, this.insts, this.expansions),
			issues: this.issues,
			abilities: this.abilities,
			hpMaxBase: this.hpMaxBase,
			ctx: this.ctx,
			state: this.state
		};
	}

	private ctxFor(eff: ActiveEffect): ExprContext {
		return typeof this.ctx === 'function' ? this.ctx(eff) : this.ctx;
	}

	/** Get (or first-time build + register) the expansion child set for a condition id — the makeInst
	 *  of the condition row's tokens happens ONCE per id (A11), appending the children to `insts`. */
	private ensureExpansion(eff: ActiveEffect, id: string): Expansion | undefined {
		const existing = this.expansions.get(id);
		if (existing) return existing;
		const c = this.args.expandCondition(id);
		if (!c) return undefined;
		const ex: Expansion = {
			label: c.source,
			children: c.tokens.map((t) => makeInst(eff, t, id, c.source)),
			appliers: []
		};
		this.expansions.set(id, ex);
		this.insts.push(...ex.children);
		return ex;
	}

	/** Token instances + one-level condition expansions (ONE child set per condition id — A11). */
	private gatherInstances(): void {
		for (const eff of this.active) {
			for (const raw of eff.tokens) {
				const inst = makeInst(eff, raw);
				this.insts.push(inst);
				if (inst.parsed.kind !== EFFECT_KIND.applyCondition || inst.parsed.target === undefined)
					continue;
				this.ensureExpansion(eff, inst.parsed.target.trim())?.appliers.push(inst);
			}
		}
	}

	/** Condemn writers of cyclic nodes BEFORE processing: no fixpoint iteration, ever — the token
	 *  stays visible as an inert note and the cycle is named in content-health (SPEC10 channel). */
	private condemnCyclicWriters(): void {
		for (const inst of this.insts) {
			if (inst.writeKey === null) continue;
			const ni = this.nodeIndex.get(inst.writeKey);
			if (ni === undefined || !this.cyclic.has(ni)) continue;
			inst.disposition = 'inert';
			this.issues.push({
				source: sourceOf(inst),
				token: inst.raw,
				reason: `dependency cycle on ${inst.writeKey}: this effect's condition or value depends on its own output — not applied`
			});
		}
	}

	private groupWritersByNode(): Map<number, Inst[]> {
		const byNode = new Map<number, Inst[]>();
		for (const inst of this.insts) {
			if (inst.writeKey === null) continue;
			const ni = this.nodeIndex.get(inst.writeKey);
			if (ni === undefined) continue;
			const list = byNode.get(ni);
			if (list) list.push(inst);
			else byNode.set(ni, [inst]);
		}
		return byNode;
	}

	/** Decide a token's guard (writers at their node's turn; plain tokens at the end). */
	private decide(inst: Inst): boolean {
		// an expansion child applies iff its condition came active (any applier survived its guard) —
		// the condition NODE is dependency-ordered before every child, so the Set is authoritative here
		if (inst.condId !== undefined && !this.state.conditions.has(inst.condId)) {
			inst.disposition = 'dropped'; // its condition never came active
			return false;
		}
		if (inst.guard === undefined) {
			inst.disposition = 'applied';
			return true;
		}
		const r = evalExpression(inst.guard, this.ctxFor(inst.eff));
		if (!r.ok || r.value.type !== 'number') {
			this.issues.push({
				source: sourceOf(inst),
				token: inst.raw,
				reason: r.ok ? `guard "${inst.guard}" is not a condition` : `bad guard: ${r.error}`
			});
			inst.disposition = 'inert'; // kept verbatim: parses as unknown → visible, never silent
			return false;
		}
		inst.disposition = r.value.value === 0 ? 'dropped' : 'applied';
		return inst.disposition === 'applied';
	}

	/** Numeric contribution from a writer, or undefined with the right surfacing. `abilityTarget`
	 *  writers have NO downstream stat fold, so their failures must become issues HERE. */
	private contributionOf(w: Inst, abilityTarget: boolean): Contribution | undefined {
		const v = resolveEffectValue(w.parsed, this.ctxFor(w.eff));
		if (v.amount === undefined) {
			if (abilityTarget) {
				w.disposition = 'inert';
				this.issues.push({
					source: sourceOf(w),
					token: w.raw,
					reason:
						v.diceFormula !== undefined
							? 'a dice value cannot modify an ability score'
							: `unresolved ability value: ${v.error ?? 'no value'}`
				});
			}
			// hp_max: keep applied — applyEffects('hp_max') re-resolves and notes the failure
			return undefined;
		}
		const isSet = w.parsed.kind === EFFECT_KIND.setOverride;
		// A9: a set_override's mode slot chooses floor/cap (Headband INT ≥ 19 resolves HERE — the
		// ability DAG, not applyEffects). D12: honor the carried layer for sets too (only the
		// condId → 'condition' refinement remains), so a floor lands at the item layer it belongs to.
		const op = isSet
			? w.parsed.setMode === 'floor'
				? 'floor'
				: w.parsed.setMode === 'cap'
					? 'cap'
					: 'set'
			: 'add';
		return {
			source: sourceOf(w),
			layer: w.condId !== undefined ? 'condition' : w.eff.layer,
			op,
			amount: v.amount,
			note: w.body
		};
	}

	/** Fold each value node's surviving writers into the resolve state, in dependency order. A thin
	 *  dispatch on the node's key type — each per-type fold is its own method below. */
	private foldNodesInOrder(writersByNode: Map<number, Inst[]>): void {
		for (const ni of this.order) {
			const key = this.nodeIds[ni] ?? '';
			const writers = (writersByNode.get(ni) ?? []).filter((w) => w.disposition === 'pending');
			const ab = ABILITY_IDS.find((a) => key === abilityKey(a));
			if (ab !== undefined) this.foldAbilityNode(ab, writers);
			else if (key === HP_MAX_KEY) this.foldHpMaxNode(writers);
			else if (key.startsWith('condition:'))
				this.foldConditionNode(key.slice('condition:'.length), writers);
			else if (key.startsWith('resource:'))
				this.foldResourceNode(key.slice('resource:'.length), writers);
		}
	}
	private foldAbilityNode(ab: Ability, writers: Inst[]): void {
		const contribs: Contribution[] = [...(this.args.abilityBase?.[ab] ?? [])];
		for (const w of writers) {
			if (!this.decide(w)) continue;
			const c = this.contributionOf(w, true);
			if (c) contribs.push(c);
		}
		const folded = computed(contribs, ABILITY_SCORE_CLAMP);
		this.abilities[ab] = folded;
		this.state.scores[ab] = folded.value;
		this.state.mods[ab] = abilityModifier(folded.value);
	}
	private foldHpMaxNode(writers: Inst[]): void {
		const base = this.args.hpMaxBase?.(this.state.scores.con) ?? [];
		this.hpMaxBase = computed(base, { min: 1 });
		const contribs = [...base];
		for (const w of writers) {
			if (!this.decide(w)) continue;
			const c = this.contributionOf(w, false);
			if (c) contribs.push(c);
		}
		this.state.hpMax.value = computed(contribs, { min: 1 }).value;
	}
	private foldConditionNode(id: string, writers: Inst[]): void {
		for (const w of writers) if (this.decide(w)) this.state.conditions.add(id);
	}
	private foldResourceNode(id: string, writers: Inst[]): void {
		for (const w of writers) {
			if (!this.decide(w)) continue;
			const res = w.parsed.resource;
			if (!res) continue;
			let max: number | undefined = res.max;
			if (max === undefined && res.maxExpr !== undefined) {
				const r = evalExpression(res.maxExpr, this.ctxFor(w.eff));
				if (r.ok && r.value.type === 'number') max = Math.floor(r.value.value);
				// an unresolvable max is reported by collectResources (the sheet's pool builder)
			}
			if (max === undefined) continue;
			const clamped = Math.max(0, Math.min(max, MAX_RESOURCE_MAX));
			if (
				!Object.hasOwn(this.state.resourceMax, id) ||
				clamped > (this.state.resourceMax[id] ?? 0)
			) {
				this.state.resourceMax[id] = clamped;
				this.state.resources[id] = Math.max(0, clamped - (this.args.resourcesSpent?.[id] ?? 0));
			}
		}
	}
}

/** Resolve every active effect in dependency order (see `Resolver`). */
export function resolveActiveEffects(args: ResolveArgs): DependencyResolved {
	return new Resolver(args).run();
}
