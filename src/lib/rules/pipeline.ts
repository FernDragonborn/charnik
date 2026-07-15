/*
 * The core value contract: every computed stat returns a VALUE plus a provenance TRACE,
 * never a bare number — so the UI can explain any stat on hover ("why is my save +5?").
 *
 * Contributions fold in the fixed stacking order (base → ability mod → proficiency → item
 * → feature → condition → override), clamped to caps. The pure rules core only ever emits
 * the first layers (base / ability mod / proficiency); the optional effects module adds the
 * item/feature/condition/override layers via `applyEffects` WITHOUT this file importing it —
 * the `{value, trace, notes}` shape is identical whether effects are on, off, or deleted.
 */
export type System = '5e' | '5.5e';

/** Where a stat's math comes from, in pipeline order. */
export type Layer =
	'base' | 'ability' | 'proficiency' | 'item' | 'feature' | 'condition' | 'override';

type Op = 'add' | 'set' | 'mult';

export interface Contribution {
	/** Human label, e.g. "DEX mod", "Proficiency", "Ring of Protection". */
	source: string;
	layer: Layer;
	op: Op;
	amount: number;
	/** Optional extra detail for the tooltip, e.g. "DEX 16". */
	note?: string;
}

export interface Computed {
	value: number;
	trace: Contribution[];
	/** Rule notes / blocks (not numeric), e.g. "Spellcasting blocked: non-proficient armor". */
	notes?: string[];
}

export interface Clamp {
	min?: number;
	max?: number;
}

const LAYER_ORDER: Record<Layer, number> = {
	base: 0,
	ability: 1,
	proficiency: 2,
	item: 3,
	feature: 4,
	condition: 5,
	override: 6
};

/** Fold contributions into a final value in pipeline order. `set` overrides, `mult` scales
 *  (floored), `add` accumulates. A later `override`-layer `set` wins over earlier layers. */
function fold(contribs: Contribution[], clamp?: Clamp): number {
	const ordered = [...contribs].sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
	let value = 0;
	for (const c of ordered) {
		if (c.op === 'set') value = c.amount;
		else if (c.op === 'mult') value = Math.floor(value * c.amount);
		else value += c.amount;
	}
	if (clamp) {
		if (clamp.min !== undefined) value = Math.max(clamp.min, value);
		if (clamp.max !== undefined) value = Math.min(clamp.max, value);
	}
	return value;
}

/** Build a `Computed` from contributions (+ optional clamp/notes). */
export function computed(contribs: Contribution[], clamp?: Clamp, notes?: string[]): Computed {
	const result: Computed = { value: fold(contribs, clamp), trace: contribs };
	if (notes) result.notes = notes;
	return result;
}
