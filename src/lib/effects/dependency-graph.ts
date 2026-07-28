/*
 * The value-node dependency GRAPH that the resolver (./resolver.ts) orders its work by.
 *
 * The graph is over VALUE NODES (the six ability scores, hp_max, each condition id, each resource
 * id), not stats: a token that WRITES a node (`flat_bonus:str`, `apply_condition:rage`,
 * `grant_resource:ki`, `flat_bonus:hp_max`) must resolve BEFORE tokens whose guard or value READS it
 * (`str_mod`, `is_raging`, `resource.ki`, `is_bloodied`). This file owns: which node a variable
 * READS (`varDepKeys`) and a token WRITES (`writeKeyOf`), the per-token `Inst` + its reads
 * (`readsOf`), Tarjan SCCs, and `buildDependencyOrder` (edges → sources-first order + the cyclic set).
 * For real 5e/5.5e content the graph is ~empty, so the order collapses to a plain single pass (RAW
 * stacking is commutative — order can't change the number). The resolve CONTRACT lives here too
 * (`ResolveState`/`ResolveArgs`/`DependencyResolved`) since both files speak it.
 */
import { ABILITY_IDS, type Ability } from '../rules/core';
import { type Computed, type Contribution } from '../rules/pipeline';
import { splitDottedName } from './expression-parser';
import { collectExprVariables } from './expression-evaluator';
import {
	EFFECT_KIND,
	type ActiveEffect,
	type EffectCtx,
	type EffectIssue,
	type ParsedEffect
} from './token-parser';

/** The condition id the `is_raging` L2 flag reads. A named seam, not scattered string compares —
 *  goes away when conditions-as-data lands a var→condition mapping (PLAN EXPR, AUDIT B2). */
export const RAGE_CONDITION_ID = 'rage';

/* ─────────────────────── value nodes (what effects can write AND expressions read) ─────────────────────── */

export type DepKey = string; // 'ability:<ab>' | 'hp_max' | 'condition:<id>' | 'resource:<id>'
export const HP_MAX_KEY = 'hp_max';
export const abilityKey = (ab: string): DepKey => `ability:${ab}`;
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
export function writeKeyOf(p: ParsedEffect): DepKey | null {
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
export interface Inst {
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

export const readsOf = (
	guard: string | undefined,
	parsed: ParsedEffect,
	condId?: string
): DepKey[] => {
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

/* ─────────────────────── graph construction + ordering ─────────────────────── */

/** Build the value-node graph (dep → dependent edges from each writer's reads), order it by SCC
 *  condensation topo (sources first), and flag the nodes caught in a cycle (their writers get
 *  condemned — no fixpoint iteration, ever). */
export function buildDependencyOrder(insts: Inst[]): {
	nodeIds: DepKey[];
	nodeIndex: Map<DepKey, number>;
	order: number[];
	cyclic: Set<number>;
} {
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
	return { nodeIds, nodeIndex, order, cyclic };
}
