/*
 * The ONE resolve stage, in DEPENDENCY order (closes AUDIT A10 + the DAG deferred from EXPR-3):
 * gather → order value-WRITING tokens by what other tokens' guards/values READ → evaluate guards
 * against the progressively-resolved state → expand `apply_condition` (one level, guard-checked) →
 * emit the guard-stripped effect list every consumer reads, plus the ability scores as traced,
 * clamped `Computed`s (A10: through the same fold/clamp pipeline as every other stat).
 *
 * The graph is over VALUE NODES (the six ability scores, hp_max, each condition id, each resource
 * id), not stats: a token that WRITES a node (`flat_bonus:str`, `apply_condition:rage`,
 * `grant_resource:ki`, `flat_bonus:hp_max`) resolves BEFORE tokens whose guard or value READS it
 * (`str_mod`, `is_raging`, `resource.ki`, `is_bloodied`). For real 5e/5.5e content the graph is
 * ~empty, so this collapses to a plain single pass (RAW stacking is commutative — order can't
 * change the number). A genuine CYCLE (an effect whose condition depends on its own output — "+10
 * max HP while below half HP") has no unique answer: it is a CONTENT BUG, detected here, surfaced
 * as a derive issue, and its writers degrade to inert notes — never an iterate-to-fixpoint loop
 * (PLUGINS.md §8.4, PLAN "State model").
 */
import { ABILITY_IDS, abilityModifier, ABILITY_SCORE_CLAMP, type Ability } from '../rules/core';
import { computed, type Computed, type Contribution } from '../rules/pipeline';
import { splitDottedName } from './expression-parser';
import { collectExprVariables, evalExpression, type ExprContext } from './expression-evaluator';
import {
	EFFECT_KIND,
	MAX_RESOURCE_MAX,
	parseToken,
	resolveEffectValue,
	splitGuard,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue,
	type ParsedEffect
} from './token-parser';

/** The condition id the `is_raging` L2 flag reads. A named seam, not scattered string compares —
 *  goes away when conditions-as-data lands a var→condition mapping (PLAN EXPR, AUDIT B2). */
export const RAGE_CONDITION_ID = 'rage';

/* ─────────────────────── value nodes (what effects can write AND expressions read) ─────────────────────── */

type DepKey = string; // 'ability:<ab>' | 'hp_max' | 'condition:<id>' | 'resource:<id>'
const HP_MAX_KEY = 'hp_max';
const abilityKey = (ab: string): DepKey => `ability:${ab}`;
const conditionKey = (id: string): DepKey => `condition:${id}`;
const resourceKey = (id: string): DepKey => `resource:${id}`;
const ABILITY_KEYSET: ReadonlySet<string> = new Set(ABILITY_IDS);

/** Value nodes an expression VARIABLE depends on ([] = static: no effect can write it).
 *  `spellcasting_mod` conservatively depends on all six scores (which ability it reads is per-class). */
function varDepKeys(name: string): DepKey[] {
	const d = splitDottedName(name);
	if (d) {
		if (d.prefix === 'has_condition') return [conditionKey(d.id)];
		if (d.prefix === 'resource' || d.prefix === 'resource_max') return [resourceKey(d.id)];
		return [];
	}
	const abil = /^([a-z]{3})_(?:mod|score)$/.exec(name);
	if (abil?.[1] !== undefined && ABILITY_KEYSET.has(abil[1])) return [abilityKey(abil[1])];
	if (name === 'spellcasting_mod') return ABILITY_IDS.map(abilityKey);
	if (name === 'hp_max' || name === 'hp_percent' || name === 'is_bloodied') return [HP_MAX_KEY];
	if (name === 'is_raging') return [conditionKey(RAGE_CONDITION_ID)];
	return [];
}

/** The value node a token WRITES (null = plain stat token — nothing downstream can read it). */
function writeKeyOf(p: ParsedEffect): DepKey | null {
	if (p.target === undefined) return null;
	const t = p.target.trim();
	if (p.kind === EFFECT_KIND.flatBonus || p.kind === EFFECT_KIND.setOverride) {
		if (ABILITY_KEYSET.has(t)) return abilityKey(t);
		if (t === 'hp_max') return HP_MAX_KEY;
		return null;
	}
	if (p.kind === EFFECT_KIND.applyCondition) return conditionKey(t);
	if (p.kind === EFFECT_KIND.grantResource && p.resource) return resourceKey(t);
	return null;
}

/* ─────────────────────── the resolve contract ─────────────────────── */

/** The mutable dependency-resolve state. The caller's ctx (see `ResolveArgs.makeCtx`) reads it
 *  LIVE (records/Set are stable references mutated in place; use getters for scalar snapshots),
 *  so a guard evaluated mid-resolve sees exactly the values already resolved. */
export interface ResolveState {
	/** Effective ability scores/mods, updated as each ability node folds (SPEC2). */
	scores: Record<Ability, number>;
	mods: Record<Ability, number>;
	/** Folded max HP including hp_max-writing effects (what `is_bloodied`/`hp_percent` guards read). */
	hpMax: { value: number };
	/** Condition ids applied by surviving `apply_condition` tokens. */
	conditions: Set<string>;
	/** Remaining / max resource pools from surviving `grant_resource` tokens. */
	resources: Record<string, number>;
	resourceMax: Record<string, number>;
}

export interface ResolveArgs {
	active: ActiveEffect[];
	/** Build the ctx guards/values evaluate against, over the LIVE resolve state. Called once.
	 *  A static resolve (tests / fixed snapshots) may ignore `state` and return a fixed ctx. */
	makeCtx: (state: ResolveState) => EffectCtx;
	/** A condition id → its content row's tokens (the graph lives in the caller). */
	expandCondition: (condId: string) => { source: string; tokens: string[] } | undefined;
	/** A10 seeds: base + allocated-boost contributions per ability (the score fold starts here). */
	abilityBase?: Partial<Record<Ability, Contribution[]>>;
	/** hp_max base contributions, computed once CON is final (the structural con→hp_max edge). */
	hpMaxBase?: (conScore: number) => Contribution[];
	/** Spent counts per resource id (remaining = max − spent). */
	resourcesSpent?: Readonly<Record<string, number>>;
}

export interface DependencyResolved {
	/** The guard-stripped survivors + condition expansions — what every consumer reads (B21). */
	effects: ActiveEffect[];
	issues: EffectIssue[];
	/** A10: effective ability scores as `Computed` (traced, clamped 0..30). */
	abilities: Record<Ability, Computed>;
	/** hp_max base (pre-effect) folded at the final CON — the seed the sheet's hp_max stat folds from. */
	hpMaxBase: Computed;
	/** The ctx used for the resolve — hand it to `applyEffects` so downstream folds see the same state. */
	ctx: EffectCtx;
	state: ResolveState;
}

/* ─────────────────────── internals ─────────────────────── */

/** One token occurrence: the carrying effect + guard split + parse + its graph reads/write. */
interface Inst {
	eff: ActiveEffect;
	/** Original token (guard included) — what an inert keep re-emits. */
	raw: string;
	guard?: string;
	/** Guard-stripped token body — what an applied keep emits. */
	body: string;
	parsed: ParsedEffect;
	writeKey: DepKey | null;
	reads: DepKey[];
	/** Expansion child: the condition id it came from + the condition row's label. Children exist
	 *  ONCE per condition id (A11: the same condition from two sources applies once); they apply
	 *  iff the id made it into `state.conditions` (any applier survived its guard). */
	condId?: string;
	condLabel?: string;
	disposition: 'pending' | 'applied' | 'dropped' | 'inert';
}

const readsOf = (guard: string | undefined, parsed: ParsedEffect, condId?: string): DepKey[] => {
	const names: string[] = [];
	if (guard !== undefined) names.push(...collectExprVariables(guard));
	if (parsed.valueExpr !== undefined) names.push(...collectExprVariables(parsed.valueExpr));
	if (parsed.resource?.maxExpr !== undefined)
		names.push(...collectExprVariables(parsed.resource.maxExpr));
	const keys = new Set<DepKey>();
	for (const n of names) for (const k of varDepKeys(n)) keys.add(k);
	if (condId !== undefined) keys.add(conditionKey(condId));
	return [...keys];
};

/** Tarjan SCCs (iteratively small graphs — recursion depth is the node count, ≤ a few dozen).
 *  Components are emitted sinks-first (reverse topological order of the condensation). */
function stronglyConnected(n: number, adj: ReadonlyArray<ReadonlySet<number>>): number[][] {
	const index = new Array<number>(n).fill(-1);
	const low = new Array<number>(n).fill(0);
	const onStack = new Array<boolean>(n).fill(false);
	const stack: number[] = [];
	const comps: number[][] = [];
	let counter = 0;
	const visit = (v: number): void => {
		index[v] = low[v] = counter++;
		stack.push(v);
		onStack[v] = true;
		for (const w of adj[v] ?? []) {
			if (index[w] === -1) {
				visit(w);
				low[v] = Math.min(low[v] ?? 0, low[w] ?? 0);
			} else if (onStack[w]) {
				low[v] = Math.min(low[v] ?? 0, index[w] ?? 0);
			}
		}
		if (low[v] === index[v]) {
			const comp: number[] = [];
			for (;;) {
				const w = stack.pop();
				if (w === undefined) break;
				onStack[w] = false;
				comp.push(w);
				if (w === v) break;
			}
			comps.push(comp);
		}
	};
	for (let v = 0; v < n; v++) if (index[v] === -1) visit(v);
	return comps;
}

/* ─────────────────────── the resolve stage ─────────────────────── */

export function resolveActiveEffects(args: ResolveArgs): DependencyResolved {
	const issues: EffectIssue[] = [];
	const zeroAbilities = (): Record<Ability, number> => {
		const r = {} as Record<Ability, number>;
		for (const ab of ABILITY_IDS) r[ab] = 0;
		return r;
	};
	const state: ResolveState = {
		scores: zeroAbilities(),
		mods: zeroAbilities(),
		hpMax: { value: 0 },
		conditions: new Set(),
		resources: {},
		resourceMax: {}
	};
	const ctx = args.makeCtx(state);
	const ctxFor = (eff: ActiveEffect): ExprContext => (typeof ctx === 'function' ? ctx(eff) : ctx);
	const sourceOf = (inst: Inst): string =>
		inst.condLabel !== undefined ? `${inst.eff.source} → ${inst.condLabel}` : inst.eff.source;

	// ---- token instances + one-level condition expansions (ONE child set per condition id: the
	// ---- same condition applied from two sources expands/folds once — AUDIT A11) ----
	const insts: Inst[] = [];
	// A11 (D&D "Combining Game Effects"): the SAME named runtime effect applied twice (two Bless
	// casts) applies once. Dedupe by (source label + token list) on the runtime/'condition' layer
	// only — build-time layers stay per-instance (a repeatable feat legitimately applies each time).
	const seenRuntime = new Set<string>();
	const active = args.active.filter((eff) => {
		if (eff.layer !== 'condition') return true;
		const k = `${eff.source}|${eff.tokens.join(';')}`;
		if (seenRuntime.has(k)) return false;
		seenRuntime.add(k);
		return true;
	});
	const expansions = new Map<string, { label: string; children: Inst[]; appliers: Inst[] }>();
	const makeInst = (eff: ActiveEffect, raw: string, condId?: string, condLabel?: string): Inst => {
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
	};
	for (const eff of active) {
		for (const raw of eff.tokens) {
			const inst = makeInst(eff, raw);
			insts.push(inst);
			if (inst.parsed.kind === EFFECT_KIND.applyCondition && inst.parsed.target !== undefined) {
				const id = inst.parsed.target.trim();
				let ex = expansions.get(id);
				if (!ex) {
					const c = args.expandCondition(id);
					if (!c) continue;
					ex = {
						label: c.source,
						children: c.tokens.map((t) => makeInst(eff, t, id, c.source)),
						appliers: []
					};
					expansions.set(id, ex);
					insts.push(...ex.children);
				}
				ex.appliers.push(inst);
			}
		}
	}

	// ---- value-node graph: dep → dependent edges from each writer's reads ----
	const nodeIds: DepKey[] = [...ABILITY_IDS.map(abilityKey), HP_MAX_KEY];
	const nodeIndex = new Map<DepKey, number>(nodeIds.map((k, i) => [k, i]));
	const ensureNode = (k: DepKey): number => {
		let i = nodeIndex.get(k);
		if (i === undefined) {
			i = nodeIds.length;
			nodeIds.push(k);
			nodeIndex.set(k, i);
		}
		return i;
	};
	for (const inst of insts) {
		if (inst.writeKey !== null) ensureNode(inst.writeKey);
		for (const r of inst.reads) ensureNode(r);
	}
	const adj: Set<number>[] = nodeIds.map(() => new Set<number>());
	for (const inst of insts) {
		if (inst.writeKey === null) continue;
		const w = ensureNode(inst.writeKey);
		for (const r of inst.reads) adj[ensureNode(r)]?.add(w);
	}
	// structural: the hp_max BASE (hit dice + CON × level) reads the final CON score
	adj[ensureNode(abilityKey('con'))]?.add(ensureNode(HP_MAX_KEY));

	// ---- order: SCC condensation topo (sources first); nontrivial SCCs / self-loops are cycles ----
	const comps = stronglyConnected(nodeIds.length, adj);
	const cyclic = new Set<number>();
	for (const comp of comps) {
		const selfLoop = comp.length === 1 && adj[comp[0] ?? -1]?.has(comp[0] ?? -1) === true;
		if (comp.length > 1 || selfLoop) for (const v of comp) cyclic.add(v);
	}
	const order: number[] = [];
	for (let i = comps.length - 1; i >= 0; i--) {
		const comp = comps[i];
		if (comp) order.push(...[...comp].sort((a, b) => a - b));
	}

	// condemn writers of cyclic nodes BEFORE processing: no fixpoint iteration, ever — the token
	// stays visible as an inert note and the cycle is named in content-health (SPEC10 channel)
	for (const inst of insts) {
		if (inst.writeKey === null) continue;
		const ni = nodeIndex.get(inst.writeKey);
		if (ni !== undefined && cyclic.has(ni)) {
			inst.disposition = 'inert';
			issues.push({
				source: sourceOf(inst),
				token: inst.raw,
				reason: `dependency cycle on ${inst.writeKey}: this effect's condition or value depends on its own output — not applied`
			});
		}
	}

	/** Decide a token's guard (writers at their node's turn; plain tokens at the end). */
	const decide = (inst: Inst): boolean => {
		// an expansion child applies iff its condition came active (any applier survived its guard) —
		// the condition NODE is dependency-ordered before every child, so the Set is authoritative here
		if (inst.condId !== undefined && !state.conditions.has(inst.condId)) {
			inst.disposition = 'dropped'; // its condition never came active
			return false;
		}
		if (inst.guard === undefined) {
			inst.disposition = 'applied';
			return true;
		}
		const r = evalExpression(inst.guard, ctxFor(inst.eff));
		if (!r.ok || r.value.type !== 'number') {
			issues.push({
				source: sourceOf(inst),
				token: inst.raw,
				reason: r.ok ? `guard "${inst.guard}" is not a condition` : `bad guard: ${r.error}`
			});
			inst.disposition = 'inert'; // kept verbatim: parses as unknown → visible, never silent
			return false;
		}
		inst.disposition = r.value.value === 0 ? 'dropped' : 'applied';
		return inst.disposition === 'applied';
	};

	const writersByNode = new Map<number, Inst[]>();
	for (const inst of insts) {
		if (inst.writeKey === null) continue;
		const ni = nodeIndex.get(inst.writeKey);
		if (ni === undefined) continue;
		const list = writersByNode.get(ni);
		if (list) list.push(inst);
		else writersByNode.set(ni, [inst]);
	}

	/** Numeric contribution from a writer, or undefined with the right surfacing. `abilityTarget`
	 *  writers have NO downstream stat fold, so their failures must become issues HERE. */
	const contributionOf = (w: Inst, abilityTarget: boolean): Contribution | undefined => {
		const v = resolveEffectValue(w.parsed, ctxFor(w.eff));
		if (v.amount === undefined) {
			if (abilityTarget) {
				w.disposition = 'inert';
				issues.push({
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
	};

	// ---- process nodes in dependency order ----
	const abilities = {} as Record<Ability, Computed>;
	let hpMaxBaseComputed: Computed = computed(args.hpMaxBase?.(0) ?? [], { min: 1 });
	for (const ni of order) {
		const key = nodeIds[ni] ?? '';
		const writers = (writersByNode.get(ni) ?? []).filter((w) => w.disposition === 'pending');
		const ab = ABILITY_IDS.find((a) => key === abilityKey(a));
		if (ab !== undefined) {
			const contribs: Contribution[] = [...(args.abilityBase?.[ab] ?? [])];
			for (const w of writers) {
				if (!decide(w)) continue;
				const c = contributionOf(w, true);
				if (c) contribs.push(c);
			}
			const folded = computed(contribs, ABILITY_SCORE_CLAMP);
			abilities[ab] = folded;
			state.scores[ab] = folded.value;
			state.mods[ab] = abilityModifier(folded.value);
		} else if (key === HP_MAX_KEY) {
			const base = args.hpMaxBase?.(state.scores.con) ?? [];
			hpMaxBaseComputed = computed(base, { min: 1 });
			const contribs = [...base];
			for (const w of writers) {
				if (!decide(w)) continue;
				const c = contributionOf(w, false);
				if (c) contribs.push(c);
			}
			state.hpMax.value = computed(contribs, { min: 1 }).value;
		} else if (key.startsWith('condition:')) {
			const id = key.slice('condition:'.length);
			for (const w of writers) if (decide(w)) state.conditions.add(id);
		} else if (key.startsWith('resource:')) {
			const id = key.slice('resource:'.length);
			for (const w of writers) {
				if (!decide(w)) continue;
				const res = w.parsed.resource;
				if (!res) continue;
				let max: number | undefined = res.max;
				if (max === undefined && res.maxExpr !== undefined) {
					const r = evalExpression(res.maxExpr, ctxFor(w.eff));
					if (r.ok && r.value.type === 'number') max = Math.floor(r.value.value);
					// an unresolvable max is reported by collectResources (the sheet's pool builder)
				}
				if (max === undefined) continue;
				const clamped = Math.max(0, Math.min(max, MAX_RESOURCE_MAX));
				if (!Object.hasOwn(state.resourceMax, id) || clamped > (state.resourceMax[id] ?? 0)) {
					state.resourceMax[id] = clamped;
					state.resources[id] = Math.max(0, clamped - (args.resourcesSpent?.[id] ?? 0));
				}
			}
		}
	}

	// ---- plain (non-writing) tokens: guards read the FINAL state ----
	for (const inst of insts) if (inst.disposition === 'pending') decide(inst);

	// ---- assemble the resolved list (base effects first, expansions after — the B21 contract;
	// ---- ONE expansion per condition id, attributed to the first applier that survived — A11) ----
	const keptTokens = (list: Inst[]): string[] => {
		const kept: string[] = [];
		for (const inst of list) {
			if (inst.disposition === 'applied') kept.push(inst.body);
			else if (inst.disposition === 'inert') kept.push(inst.raw);
		}
		return kept;
	};
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
			out.push({
				source: `${applier.eff.source} → ${ex.label}`,
				layer: 'condition',
				tokens: kept
			});
	}

	return { effects: out, issues, abilities, hpMaxBase: hpMaxBaseComputed, ctx, state };
}
