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

/** Pipeline layer order (base → … → override). A later layer's `set` still beats an earlier
 *  layer's, but WITHIN a layer the result is order-independent (see `fold`). */
const LAYER_SEQUENCE: Layer[] = [
	'base',
	'ability',
	'proficiency',
	'item',
	'feature',
	'condition',
	'override'
];

/**
 * Fold contributions into a final value in pipeline order AND independent of the order the
 * contributions were gathered — so two effects that both `set` the same key (two items, or two
 * community plugins) can never get a different result from file-scan / namespace-sort luck.
 *
 * Within a layer the ops fold commutatively: `set` follows D&D's "Combining Game Effects" rule
 * (same-target effects don't stack — the most potent, i.e. HIGHEST, applies; identical in 5e and
 * 5.5e); `mult` folds as one product then floors once; `add` accumulates. Across layers the fixed
 * base→…→override order still holds, so an override-layer `set` beats an item-layer one.
 */
function fold(contribs: Contribution[], clamp?: Clamp): number {
	let value = 0;
	for (const layer of LAYER_SEQUENCE) {
		const here = contribs.filter((c) => c.layer === layer);
		if (here.length === 0) continue;
		const sets = here.filter((c) => c.op === 'set');
		if (sets.length) value = Math.max(...sets.map((c) => c.amount));
		const product = here.filter((c) => c.op === 'mult').reduce((p, c) => p * c.amount, 1);
		if (product !== 1) value = Math.floor(value * product);
		value += here.filter((c) => c.op === 'add').reduce((sum, c) => sum + c.amount, 0);
	}
	if (clamp) {
		if (clamp.min !== undefined) value = Math.max(clamp.min, value);
		if (clamp.max !== undefined) value = Math.min(clamp.max, value);
	}
	return value;
}

/** When >1 `set` competes within a layer, only the most potent applies — surface each superseded
 *  one as a note so a stomped override is EXPLAINED, never silently dropped (the explainability
 *  invariant). Fires only on a genuine collision (≥2 differing sets in a layer). */
function overriddenSetNotes(contribs: Contribution[]): string[] {
	const out: string[] = [];
	for (const layer of LAYER_SEQUENCE) {
		const sets = contribs.filter((c) => c.layer === layer && c.op === 'set');
		if (sets.length < 2) continue;
		const winner = Math.max(...sets.map((c) => c.amount));
		for (const s of sets)
			if (s.amount < winner) out.push(`${s.source}: set ${s.amount} — overridden by ${winner}`);
	}
	return out;
}

/** Build a `Computed` from contributions (+ optional clamp/notes). */
export function computed(contribs: Contribution[], clamp?: Clamp, notes?: string[]): Computed {
	const allNotes = [...(notes ?? []), ...overriddenSetNotes(contribs)];
	const result: Computed = { value: fold(contribs, clamp), trace: contribs };
	if (allNotes.length) result.notes = allNotes;
	return result;
}
