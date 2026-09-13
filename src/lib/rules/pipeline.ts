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

/** What a system is CALLED to a user — never the raw id in prose (AGENTS.md ▸ A small glossary (source)). It
 *  lives beside the id list so a third system is one row here and every picker follows, instead of
 *  the four hardcoded `['5e','5.5e']` literals this replaced (`docs/internals/compatibility.md` §🟠). Distinct
 *  from `sourceLabel()` in `content/detail.ts`, which names a SOURCE TAG (`SRD 5.1`), not a system. */
export const SYSTEM_LABELS: Record<System, string> = {
	'5e': 'D&D 5e (2014)',
	'5.5e': 'D&D 5.5e (2024)',
};

/** The same name where the full one will not fit — a roster badge, a segmented switch. It is a ROW
 *  here rather than a raw id read at the call site, which is the state that had four screens giving
 *  four different answers to "which edition is this". */
export const SYSTEM_SHORT_LABELS: Record<System, string> = {
	'5e': 'D&D 5e',
	'5.5e': 'D&D 5.5e',
};

/** …for the callers holding a plain `string`: a draft summary reads its system out of a file the
 *  user can edit, so an unknown id prints itself rather than nothing. */
export function systemShortLabel(system: string): string {
	const known = SYSTEMS.find((s) => s === system);
	return known ? SYSTEM_SHORT_LABELS[known] : system;
}

/** The system a NEW character/draft starts in when nothing says otherwise. Named so the choice is
 *  in one place rather than as a `?? '5.5e'` in whichever file needed a default that day. */
export const DEFAULT_SYSTEM: System = '5.5e';

/** Where a stat's math comes from, in pipeline order. */
export type Layer =
	'base' | 'ability' | 'proficiency' | 'item' | 'feature' | 'condition' | 'override';

// `floor`/`cap` = RAW's per-effect set directions (A9): `floor` = "value becomes N unless already
// higher" (Headband of Intellect → INT ≥ 19); `cap` = "unless already lower". `set` = plain absolute.
type Op = 'add' | 'set' | 'mult' | 'floor' | 'cap';

export interface Contribution {
	/** Human label, e.g. "DEX mod", "Proficiency", "Ring of Protection". Always the English, so a
	 *  caller with no translator — a node test, a core path — reads a sentence rather than a key. */
	source: string;
	layer: Layer;
	op: Op;
	amount: number;
	/** Optional extra detail for the tooltip, e.g. "DEX 16". */
	note?: string;
	/** i18n keys for a contribution the ENGINE wrote, with the values both of them read. A
	 *  contribution whose source is a content row's own name — a species, a magic item — carries
	 *  neither: that word is DATA and passes through untranslated. Rendered by `sourceText` /
	 *  `sourceNoteText`, the same split `formatNote` makes for a rule note. */
	key?: string;
	noteKey?: string;
	params?: Record<string, string | number>;
}

/**
 * A rule note / block attached to a `Computed` (not numeric), e.g. "advantage on save.str",
 * "already ≥ 19". `text` is the English fallback / content string and is ALWAYS present, so every
 * pure and core path reads `.text` unchanged (the on/off/deleted `{value, trace, notes}` shape is
 * identical). System (engine-generated) notes ALSO carry `{key, params}` so the UI can localize
 * them at render (B18); free-text / content notes carry only `text`. Localize via `formatNote`.
 */
export interface Note {
	text: string;
	/** i18n message key for system notes; absent on free-text/content notes. */
	key?: string;
	params?: Record<string, string | number>;
}

/** Render a note to a string: localized when a `translate` fn + a `key` are present, else the EN
 *  `text` verbatim. PURE — the `translate` fn is injected by the UI (`svelte-i18n`), so core/rules
 *  code (which never passes one) stays i18n-runtime-free and every note reproduces its EN text. */
/**
 * svelte-i18n's `$format`, taken as a parameter so the rules core and every pure view helper stay
 * locale-free — the caller hands its own translator over. Without one, a label renders its English
 * text verbatim, which is what a node test sees.
 */
export type Translate = (
	key: string,
	options?: { values?: Record<string, string | number>; default?: string },
) => string;

export function formatNote(note: Note, translate?: Translate): string {
	if (!translate || !note.key) return note.text;
	return translate(note.key, note.params ? { values: note.params } : {});
}

/** A contribution's SOURCE as a person reads it. */
export const sourceText = (c: Contribution, translate?: Translate): string =>
	formatNote(asNote(c.source, c.key, c.params), translate);

/** A contribution's extra detail ("DEX 16"), or '' when it carries none. */
export const sourceNoteText = (c: Contribution, translate?: Translate): string =>
	c.note ? formatNote(asNote(c.note, c.noteKey, c.params), translate) : '';

const asNote = (
	text: string,
	key: string | undefined,
	params: Record<string, string | number> | undefined,
): Note => ({ text, ...(key ? { key } : {}), ...(params ? { params } : {}) });

/** i18n keys for the labels the ENGINE writes into a trace — the ONE owner, like `NOTE_KEY` for its
 *  rule notes. Per-ability families are flat (`abilityMod.str`), because "мод. СИЛ" is a phrase a
 *  translator has to see whole rather than an ability substituted into an English frame
 *  (docs/internals/ui.md ▸ Strings live in the catalogs). */
export const SOURCE_KEY = {
	abilityMod: (ability: string) => `provenance.source.abilityMod.${ability}`,
	abilityScore: (ability: string) => `provenance.source.abilityScore.${ability}`,
	base: 'provenance.source.base',
	baseScore: 'provenance.source.baseScore',
	abilityBoosts: 'provenance.source.abilityBoosts',
	proficiency: 'provenance.source.proficiency',
	expertise: 'provenance.source.expertise',
	jackOfAllTrades: 'provenance.source.jackOfAllTrades',
	passiveBase: 'provenance.source.passiveBase',
	skillBonus: 'provenance.source.skillBonus',
	armor: 'provenance.source.armor',
	shield: 'provenance.source.shield',
	dexUnderArmor: 'provenance.source.dexUnderArmor',
	dexIgnored: 'provenance.source.dexIgnored',
	dexCapped: 'provenance.source.dexCapped',
	hitDieFirst: 'provenance.source.hitDieFirst',
	hitDieAverage: 'provenance.source.hitDieAverage',
	conPerLevel: 'provenance.source.conPerLevel',
	carryCapacity: 'provenance.source.carryCapacity',
	speciesDefault: 'provenance.source.speciesDefault',
	armorTooHeavy: 'provenance.source.armorTooHeavy',
	armorStrShort: 'provenance.source.armorStrShort',
	advantage: 'provenance.source.advantage',
	disadvantage: 'provenance.source.disadvantage',
} as const;

/** i18n keys for the engine-generated (system) notes — the ONE owner, so producers in pipeline /
 *  apply / core and the message catalogs never drift on a bare string (AGENTS.md ▸ Taste (one name per fact)). */
export const NOTE_KEY = {
	alreadyAtLeast: 'provenance.alreadyAtLeast',
	alreadyAtMost: 'provenance.alreadyAtMost',
	overriddenSet: 'provenance.overriddenSet',
	bonusBlocked: 'provenance.bonusBlocked',
	diceBonus: 'provenance.diceBonus',
	unresolved: 'provenance.unresolved',
	advantage: 'provenance.advantage',
	disadvantage: 'provenance.disadvantage',
	autoFail: 'provenance.autoFail',
	autoSucceed: 'provenance.autoSucceed',
	encumbered: 'provenance.encumbered',
	heavilyEncumbered: 'provenance.heavilyEncumbered',
	overCapacity: 'provenance.overCapacity',
} as const;

export interface Computed {
	value: number;
	trace: Contribution[];
	/** Rule notes / blocks (not numeric), e.g. "Spellcasting blocked: non-proficient armor". */
	notes?: Note[];
	/** The clamp this value was folded under, carried so `applyEffects` can re-fold the trace under
	 *  the SAME bound (else a clamped base — speed `{min:0}`, maxHp `{min:1}` — loses its floor when
	 *  effects re-fold, breaking the on/off/deleted invariant). Absent = no clamp. */
	clamp?: Clamp;
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
	'override',
];

/**
 * Fold contributions into a final value in pipeline order AND independent of the order the
 * contributions were gathered — so two effects that both `set` the same key (two items, or two
 * community plugins) can never get a different result from file-scan / namespace-sort luck.
 *
 * Within a layer the ops fold in a fixed sub-order — set → floor → mult → add (A9):
 * `set` follows D&D's "Combining Game Effects" rule (same-target effects don't stack — the most
 * potent, i.e. HIGHEST, applies; identical in 5e and 5.5e); `floor` raises the running value to at
 * least its amount ("INT is 19 unless already higher" — Headband, fold = max); `mult` folds as one
 * product then floors once; `add` accumulates. Across layers the fixed base→…→override order still
 * holds, so an override-layer `set` beats an item-layer one.
 *
 * `cap` is the exception and folds LAST, across every layer and after every add, because RAW's caps
 * are ceilings on the finished value rather than on a running total: "your Constitution increases by
 * 2, to a maximum of 20" (Belt of Dwarvenkind) is +2 and THEN a ceiling. A cap inside its own layer
 * could only clamp what happened to be counted so far, which no rule ever means. `floor` stays in
 * the layer because it is the opposite kind of statement — "this source sets it to at least N" —
 * and competes with the other sources at its own layer.
 *
 * `ineffectiveNotes` (if given) collects an explanation for any floor/cap that did NOT change the
 * value ("already ≥ N") — the explainability invariant: nothing folds silently.
 */
function fold(contribs: Contribution[], clamp?: Clamp, ineffectiveNotes?: Note[]): number {
	let value = 0;
	for (const layer of LAYER_SEQUENCE) {
		const here = contribs.filter((c) => c.layer === layer);
		if (here.length === 0) continue;
		const sets = here.filter((c) => c.op === 'set');
		if (sets.length) value = Math.max(...sets.map((c) => c.amount));
		// floors raise (max), highest-first so the winner lands and the rest are noted "already ≥"
		for (const f of here.filter((c) => c.op === 'floor').sort((a, b) => b.amount - a.amount)) {
			if (f.amount > value) value = f.amount;
			else
				ineffectiveNotes?.push({
					text: `${f.source}: already ≥ ${f.amount}`,
					key: NOTE_KEY.alreadyAtLeast,
					params: { source: f.source, amount: f.amount },
				});
		}
		const product = here.filter((c) => c.op === 'mult').reduce((p, c) => p * c.amount, 1);
		if (product !== 1) value = Math.floor(value * product);
		value += here.filter((c) => c.op === 'add').reduce((sum, c) => sum + c.amount, 0);
	}
	// caps last, across ALL layers and after every add — a cap is a CEILING on the finished value
	// ("to a maximum of 20"), not a clamp on whatever the running total happened to be at its own
	// layer. Lowest-first, so the tightest wins and the rest are noted "already ≤".
	for (const c of contribs.filter((c) => c.op === 'cap').sort((a, b) => a.amount - b.amount)) {
		if (c.amount < value) value = c.amount;
		else
			ineffectiveNotes?.push({
				text: `${c.source}: already ≤ ${c.amount}`,
				key: NOTE_KEY.alreadyAtMost,
				params: { source: c.source, amount: c.amount },
			});
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
function overriddenSetNotes(contribs: Contribution[]): Note[] {
	const out: Note[] = [];
	for (const layer of LAYER_SEQUENCE) {
		const sets = contribs.filter((c) => c.layer === layer && c.op === 'set');
		if (sets.length < 2) continue;
		const winner = Math.max(...sets.map((c) => c.amount));
		for (const s of sets)
			if (s.amount < winner)
				out.push({
					text: `${s.source}: set ${s.amount} — overridden by ${winner}`,
					key: NOTE_KEY.overriddenSet,
					params: { source: s.source, amount: s.amount, winner },
				});
	}
	return out;
}

/** Build a `Computed` from contributions (+ optional clamp/notes). */
export function computed(contribs: Contribution[], clamp?: Clamp, notes?: Note[]): Computed {
	const ineffective: Note[] = [];
	const value = fold(contribs, clamp, ineffective);
	const allNotes = [...(notes ?? []), ...overriddenSetNotes(contribs), ...ineffective];
	const result: Computed = { value, trace: contribs };
	if (allNotes.length) result.notes = allNotes;
	if (clamp) result.clamp = clamp;
	return result;
}
