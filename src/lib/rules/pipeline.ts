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
/** The two supported rule systems — the ONE owner (AUDIT F7/D2). character/content schemas and the
 *  app store all derive their system union from here, so there's a single source of truth. */
export const SYSTEMS = ['5e', '5.5e'] as const;
export type System = (typeof SYSTEMS)[number];

/** Where a stat's math comes from, in pipeline order. */
export type Layer =
	'base' | 'ability' | 'proficiency' | 'item' | 'feature' | 'condition' | 'override';

// `floor`/`cap` = RAW's per-effect set directions (A9): `floor` = "value becomes N unless already
// higher" (Headband of Intellect → INT ≥ 19); `cap` = "unless already lower". `set` = plain absolute.
type Op = 'add' | 'set' | 'mult' | 'floor' | 'cap';

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
 * Within a layer the ops fold in a fixed sub-order — set → floor → cap → mult → add (A9):
 * `set` follows D&D's "Combining Game Effects" rule (same-target effects don't stack — the most
 * potent, i.e. HIGHEST, applies; identical in 5e and 5.5e); `floor` raises the running value to at
 * least its amount ("INT is 19 unless already higher" — Headband, fold = max); `cap` lowers it to
 * at most its amount (fold = min); floor-before-cap is fixed (a floor+cap conflict is pathological
 * content); `mult` folds as one product then floors once; `add` accumulates. Across layers the
 * fixed base→…→override order still holds, so an override-layer `set` beats an item-layer one.
 *
 * `ineffectiveNotes` (if given) collects an explanation for any floor/cap that did NOT change the
 * value ("already ≥ N") — the explainability invariant: nothing folds silently.
 */
function fold(contribs: Contribution[], clamp?: Clamp, ineffectiveNotes?: string[]): number {
	let value = 0;
	for (const layer of LAYER_SEQUENCE) {
		const here = contribs.filter((c) => c.layer === layer);
		if (here.length === 0) continue;
		const sets = here.filter((c) => c.op === 'set');
		if (sets.length) value = Math.max(...sets.map((c) => c.amount));
		// floors raise (max), highest-first so the winner lands and the rest are noted "already ≥"
		for (const f of here.filter((c) => c.op === 'floor').sort((a, b) => b.amount - a.amount)) {
			if (f.amount > value) value = f.amount;
			else ineffectiveNotes?.push(`${f.source}: already ≥ ${f.amount}`);
		}
		// caps lower (min), lowest-first
		for (const c of here.filter((c) => c.op === 'cap').sort((a, b) => a.amount - b.amount)) {
			if (c.amount < value) value = c.amount;
			else ineffectiveNotes?.push(`${c.source}: already ≤ ${c.amount}`);
		}
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
	const ineffective: string[] = [];
	const value = fold(contribs, clamp, ineffective);
	const allNotes = [...(notes ?? []), ...overriddenSetNotes(contribs), ...ineffective];
	const result: Computed = { value, trace: contribs };
	if (allNotes.length) result.notes = allNotes;
	return result;
}
