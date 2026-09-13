/*
 * Roll-time helpers for the Combat view: what an effect contributes to a roll, forced outcomes,
 * advantage math, pip click-to-set, and the small roll-UI constants. Pure — the caller gates on
 * the effects-auto toggle. Split out of the old combat/helpers.ts junk-drawer.
 */
import {
	droppedD20s,
	type AdvantageMode,
	parseDiceTerm,
	parseFormula,
	rehydrateRoll,
	rollPool,
	type BonusDie,
	type CritMethod,
	type DieMods,
	type FlatPart,
	type Rng,
	type Rolled,
	type StoredRoll,
} from '$lib/rules/dice';
import { matchesTarget, type EffectFacts } from '$lib/effects/apply';
import { sayText, type Said, type SaidText, type SaidValue } from '$lib/util/say';
import type { Translate } from '$lib/i18n';
import type { RollMod } from '$lib/effects/facts';
import type { CharacterSheet, SkillId } from '$lib/character/derive';

/** A rolled damage slice carrying its damage type ("slashing", "radiant"). A single-type hit is one
 *  of these; a multi-type weapon rolls several, each shown separately with its own total (BUG-DMG-1). */
export type TypedRoll = Rolled & { type: string };

/** One damage part to roll: its dice pool + flat mod + type, plus any effect bonus dice / mods that
 *  ride it (folded onto the primary part by the caller). Fed to `rollDamageParts`. */
export interface DamagePartSpec {
	dice: Record<number, number>;
	mod: number;
	/** What `mod` was made of, when the roll site knew — an effect's named `+2` beside a typed one.
	 *  Absent means nobody recorded a source, not that there was no modifier. */
	modParts?: FlatPart[];
	type: string;
	bonusDice?: BonusDie[];
	mods?: DieMods;
	/** Set → this part crit, by that method. Per PART rather than per roll because a crit doubles
	 *  DICE, and each part has its own; the flat modifier it carries is untouched either way. */
	crit?: CritMethod;
}

/** Does this set of parts actually deal damage? "Has a part" is NOT the question: `parseDamageParts`
 *  always yields at least one, falling back to an empty `{pool:{}, mod:0, type:''}` placeholder for a
 *  weapon with no damage line. Nor is "has dice" — Unarmed Strike's "1 + STR mod" is entirely FLAT,
 *  and gating on dice alone dropped it from the roll and the toast altogether. Dice, a flat value, or
 *  EFFECT dice: it is asked after the effects fold in, so a `+1d6` rider on a weapon whose own damage
 *  folds to zero is damage exactly as a flat `+1` from the same place is. */
export const dealsDamage = (parts: DamagePartSpec[]): boolean =>
	parts.some(
		(p) => Object.keys(p.dice).length > 0 || p.mod !== 0 || (p.bonusDice?.length ?? 0) > 0,
	);

/** Roll each damage part into a `TypedRoll`, preserving order (primary part first). Pure — the rng is
 *  injectable for tests; each part carries its own type through so the tray can show the breakdown. */
export function rollDamageParts(parts: DamagePartSpec[], rng?: () => number): TypedRoll[] {
	return parts.map((p) => ({
		...rollPool(p.dice, {
			...(p.mods ?? {}),
			...(rng ? { rng } : {}),
			// one or the other, never both: `modParts` IS the modifier, told with its provenance
			...(p.modParts ? { modParts: p.modParts } : { mod: p.mod }),
			...(p.bonusDice ? { bonusDice: p.bonusDice } : {}),
			...(p.crit ? { crit: p.crit } : {}),
		}),
		type: p.type,
	}));
}

/** What a roll is CALLED: the English text, and the catalog key for it when the roll's name comes
 *  from a closed vocabulary (a skill, an ability check or save, initiative). One object because they
 *  are one fact and always travel together — a roll site that knows the key knows the text.
 *
 *  A roll whose name is DATA — a spell, a homebrew action, whatever the player typed — carries text
 *  alone, which is correct: no UI catalog can know what someone's own pack calls its rows. */
export interface RollName {
	text: string;
	key?: string;
	/** ICU values for `key`. A symbol, a number — a die size, a count — or a `{catalog, id}` word the
	 *  READER's catalog resolves, which is how a numbered strike keeps its name a key ("Unarmed Strike
	 *  1/2"). Never a translated NOUN in a frame: interpolating one is what breaks in an inflected
	 *  language, where "Перевірка СИЛ" is not "{ability} перевірка", so a phrase that inflects gets a
	 *  whole key of its own. */
	values?: Record<string, SaidValue>;
}

/**
 * What a roll is CALLED, in the language it is being READ in: the catalog key when it has one, its
 * recorded text otherwise — and a value that is itself a catalog word (a numbered Unarmed Strike)
 * resolves too, which is the whole reason `labelValues` is not just strings.
 *
 * One implementation because three surfaces say the same name — the log row, the toast card, and the
 * forced-outcome notice — and three copies of "key or text" drift the moment one of them learns
 * something the others do not.
 */
export const sayRollName = (name: RollName, translate?: Translate): string =>
	name.key
		? sayText(
				{ key: name.key, ...(name.values ? { values: name.values } : {}), fallback: name.text },
				translate,
			)
		: name.text;

/** A roll NAME as the fields a spec or a record carries — {@link rollNameOf}'s inverse, so the two
 *  shapes convert in one place instead of at every roll site. */
export const nameFields = (
	name: RollName,
): { label: string; labelKey?: string; labelValues?: Record<string, SaidValue> } => ({
	label: name.text,
	...(name.key ? { labelKey: name.key } : {}),
	...(name.values ? { labelValues: name.values } : {}),
});

/** A recorded row read back as a roll NAME, so a stored line says itself the same way a live one does. */
export const rollNameOf = (row: {
	label: string;
	labelKey?: string;
	labelValues?: Record<string, SaidValue>;
}): RollName => ({
	text: row.label,
	...(row.labelKey ? { key: row.labelKey } : {}),
	...(row.labelValues ? { values: row.labelValues } : {}),
});

/** A roll-log row: a completed roll (the primary/to-hit) plus what it was for, and — for an attack —
 *  the per-type damage rolls that follow it. Rendered as the roll, the dropped adv die, then one line
 *  per damage type plus a combined total. `note` is an optional provenance line (item 4): an upcast
 *  cast records "Xd base + Yd @ slot N" so the boosted dice are explained (value + provenance), not a
 *  bare bigger total. */
export type RollLogEntry = Rolled & {
	label: string;
	/** The CATALOG KEY for `label`, when the roll's name is a closed vocabulary — a skill, an ability
	 *  check or save, initiative, AC. The record keeps the key and the view makes the word, for the
	 *  same reason an amendment is facts: a localized sentence written into `log.jsonl` freezes that
	 *  roll in whatever language it happened to be made in, and switching the UI afterwards cannot
	 *  reach it. `label` stays beside it as the English fallback, which is also all a custom roll or
	 *  a homebrew spell name ever has. */
	labelKey?: string;
	/** ICU values for `labelKey` — see `RollName.values`. */
	labelValues?: Record<string, SaidValue>;
	damage?: TypedRoll[];
	/** The PLAYER's own words for this roll — what they typed into a `note` pill. Data: it is their
	 *  sentence and passes through untranslated, and no catalog knows it.
	 *
	 *  A row written before 2026-09-05 also carries the APP's provenance here as English prose; that
	 *  is the legacy seam and still renders, but nothing writes it any more. */
	note?: string;
	/** The app's own provenance, as facts rather than as a sentence — an upcast's extra dice, a
	 *  formula fragment the parser could not account for. Said by `rollToastModel`, for the same
	 *  reason an amendment is facts: prose written into `log.jsonl` freezes that roll in whatever
	 *  language it was made in, and switching the UI afterwards cannot reach it. */
	noteParts?: SaidText[];
	/** When it was rolled (epoch ms), stamped by `pushRoll` — so it belongs to the ROLL rather than to
	 *  how it happens to be stored. The persisted line used to invent its own timestamp at write time,
	 *  which is part of how the two records drifted apart; it is also what an amendment matches on to
	 *  rewrite its own line. Absent only on a view-model literal that is toasted but never logged. */
	at?: number;
	/** What was changed about this roll after it landed, as facts rather than as a sentence. */
	amendments?: RollAmendment[];
	/** A condition decided this one instead of the die (paralyzed → auto-fail its STR/DEX save), so no
	 *  die was thrown. A FACT beside the roll's name rather than a word inside it: the name is already
	 *  a catalog key, an entry holds one, and "Save — auto-fail" written into `log.jsonl` would freeze
	 *  the line in the language it happened in. `RollRow` says it. */
	outcome?: AutoOutcome;
	/** The ACTION this roll belonged to, when one action fired several — a volley's beams, Extra
	 *  Attack's strikes. A GUID rather than a counter (AGENTS.md ▸ Taste): the lines are written
	 *  independently and each may be rewritten by an amendment, so nothing may depend on their order
	 *  or on how many were written. Absent on a lone roll: one instance is fully described by being
	 *  one line, and the roll log is a capped file that pays for every field on every roll.
	 *
	 *  Without it "one action fires N instances" — the thing the two-level model exists to state —
	 *  survived only until the page reloaded, and three Eldritch Blast beams came back as three
	 *  unrelated rolls. */
	group?: string;
};

/** A log row as it may come BACK off disk: a line written before `Rolled` carried its dice has only
 *  the rendered `expr`, and so does every damage part under it. */
export type StoredRollLogEntry = StoredRoll & {
	label: string;
	labelKey?: string;
	labelValues?: Record<string, SaidValue>;
	note?: string;
	noteParts?: SaidText[];
	at?: number;
	group?: string;
	amendments?: RollAmendment[];
	outcome?: AutoOutcome;
	damage?: (StoredRoll & { type: string })[];
};

/** A stored row → a row with dice, damage parts included. `rehydrateRoll` covers ONE roll; an attack
 *  is a roll plus N damage rolls, and rehydrating only the top one would give the row back its d20
 *  while its damage chips stayed empty. The seam is here rather than in the roller because `damage`
 *  is a combat-layer fact and `rules/dice` must not learn about it.
 *
 *  The row's own fields are listed rather than spread: `rehydrateRoll` DROPS the legacy fields it
 *  consumes, and a spread of the original would carry them (a stale advantage pair, a stale
 *  `natural`) back onto the row and from there back to disk. */
export const rehydrateLogEntry = (e: StoredRollLogEntry): RollLogEntry => ({
	...rehydrateRoll(e),
	label: e.label,
	...(e.labelKey !== undefined ? { labelKey: e.labelKey } : {}),
	...(e.labelValues !== undefined ? { labelValues: e.labelValues } : {}),
	...(e.note !== undefined ? { note: e.note } : {}),
	...(e.noteParts !== undefined ? { noteParts: e.noteParts } : {}),
	...(e.at !== undefined ? { at: e.at } : {}),
	...(e.group !== undefined ? { group: e.group } : {}),
	...(e.amendments ? { amendments: e.amendments } : {}),
	...(e.outcome ? { outcome: e.outcome } : {}),
	...(e.damage ? { damage: e.damage.map((d) => ({ ...rehydrateRoll(d), type: d.type })) } : {}),
});

/** The roll log as the ACTIONS it recorded: consecutive entries sharing a `group` are one action's
 *  throws, and everything else is an action of one. Consecutive is the whole rule — the log is
 *  written in order and an amendment rewrites a line in place, so an action's throws are never
 *  separated by another roll.
 *
 *  Pure and exported because the fact belongs to the record, not to the one menu that draws it. */
export function actionRuns(entries: RollLogEntry[]): RollLogEntry[][] {
	const runs: RollLogEntry[][] = [];
	for (const e of entries) {
		const last = runs.at(-1);
		if (last && e.group !== undefined && last[0]?.group === e.group) last.push(e);
		else runs.push([e]);
	}
	return runs;
}

/** The catalog keys a roll's own provenance is recorded under — compared against a named constant
 *  rather than a bare string, so a new note kind has one home (AGENTS.md ▸ Taste). */
export const NOTE_KEY = {
	/** A fragment of the typed formula that is neither dice nor a modifier, so it rolled nothing. */
	formulaUnread: 'roller.note.formulaUnread',
	/** What an upcast added on top of the spell's base dice, and out of which slot. */
	upcast: 'roller.note.upcast',
	/** A fragment of a spell's damage column the parser could not account for. */
	damageUnread: 'roller.note.damageUnread',
	/** What the slot above the spell's own level scales, beyond its dice — area, count, duration. */
	upcastPreview: 'roller.note.upcastPreview',
} as const;

/** What KIND of change was made to a roll after it landed. A named member, so a third kind has to be
 *  handled everywhere rather than falling through as an unrecognised string. */
export const AMENDMENT_KIND = {
	/** How the roll's d20 were read, changed after it landed (UX-3). */
	advantage: 'advantage',
	/** A damage part rolled again with the better kept (Savage Attacker). */
	damageReroll: 'damageReroll',
	/** The deciding d20 thrown again with the NEW one kept. Nothing PRODUCES this any more — the
	 *  Heroic Inspiration control that did is gone — but a `log.jsonl` written before that still
	 *  carries it, and a log must stay readable. */
	d20Reroll: 'd20Reroll',
} as const;
export type AmendmentKind = (typeof AMENDMENT_KIND)[keyof typeof AMENDMENT_KIND];

/**
 * One change made to a roll after it landed, as FACTS. It used to be an English sentence composed
 * into `note` and matched back out with a regex — which ate an upcast's provenance once and grew the
 * note a lap. Prose already written into `log.jsonl` also cannot be localised afterwards, so the
 * record keeps what happened and exactly one place (`describeAmendments`) turns it into words.
 *
 * Only what cannot be derived is stored: an advantage amendment does not carry the dice, because the
 * roll's own `d20s` are the record of those and a second copy could disagree with them.
 */
export type RollAmendment =
	| { kind: typeof AMENDMENT_KIND.advantage; from: AdvantageMode; to: AdvantageMode }
	| { kind: typeof AMENDMENT_KIND.damageReroll; source: Said; from: number; to: number }
	/** `source` is a `Said`: a feature's NAME is data and passes through, while the app's own word
	 *  (Heroic Inspiration) is a key, so a log line written under one language reads under another. */
	| { kind: typeof AMENDMENT_KIND.d20Reroll; source: Said; from: number; to: number };

/** The amendments a roll carries once it has been re-read at a different advantage. The advantage
 *  amendment is REPLACED rather than stacked — a roll was decided one way however many times the
 *  control was tapped — and `from` stays the mode the roll was ORIGINALLY made at, so a whole lap
 *  round the cycle cannot drift. Every other kind is kept untouched.
 *
 *  `original` is the roll as it stands BEFORE this amendment, which is the only place that mode can
 *  come from: a roll made under Bless starts at `advantage`, and defaulting to `neither` would both
 *  record a false `from` and then drop the amendment entirely the moment the player cycled back to
 *  the mode it never had.
 *
 *  Nothing is recorded when the roll is back at the mode it was made at: the second d20 is still in
 *  `d20s` and still drawn struck through, which says everything a sentence would. */
export function amendedAdvantage(
	original: Pick<RollLogEntry, 'advantage' | 'amendments'>,
	revised: Rolled,
): RollAmendment[] {
	const prior = original.amendments ?? [];
	const others = prior.filter((a) => a.kind !== AMENDMENT_KIND.advantage);
	const was = prior.find((a) => a.kind === AMENDMENT_KIND.advantage);
	const from = was?.kind === AMENDMENT_KIND.advantage ? was.from : original.advantage;
	if (!droppedD20s(revised).length || from === revised.advantage) return others;
	return [...others, { kind: AMENDMENT_KIND.advantage, from, to: revised.advantage }];
}

/** An amendment sentence a note written before amendments were structured still carries. LEGACY
 *  ONLY, the same seam `parseLegacyExpr` is for `expr`: it strips the old sentence the first time
 *  such a roll is amended, so the structured amendment does not land beside a prose copy of itself.
 *  Delete it once logs from before 2026-09-04 have rotated out. */
const AMEND_NOTE = /(?:^\s*|\s·\s)(?:(?:dis)?advantage after the roll|advantage cleared)[^·]*/;

/** A roll's own note with any legacy amendment sentence removed — never the note itself, which is
 *  provenance the roll had before anyone amended it (an upcast's "8d6 base + 1d6 @ slot 4"). */
export const withoutLegacyAmendment = (note: string | undefined): string =>
	(note ?? '').replace(AMEND_NOTE, '').trim();

/**
 * A formula that came from CONTENT (a monster's HP, a spell's damage) → the entry that rolls it,
 * carrying anything the parse could not account for as its own note. Every instant-roll affordance
 * goes through here, so an unread fragment surfaces the same way wherever it is rolled instead of
 * making the total quietly smaller (docs/internals/roller.md ▸ Conventions).
 */
export function rollFormulaEntry(label: string, formula: string, rng?: Rng): RollLogEntry {
	const { dice, mod, bonusDice, issues } = parseFormula(formula);
	return {
		label,
		...rollPool(dice, {
			mod,
			...(bonusDice.length ? { bonusDice } : {}),
			...(rng ? { rng } : {}),
		}),
		...(issues.length
			? { noteParts: [{ key: NOTE_KEY.formulaUnread, values: { fragments: { list: issues } } }] }
			: {}),
	};
}

/** Combined total across every typed damage part. */
export const damageTotal = (parts: TypedRoll[]): number => parts.reduce((n, p) => n + p.total, 0);

/** The three action-economy slots a turn tracks. */
export type ActionSlot = 'action' | 'bonus' | 'reaction';

/** What a slot is called in a sentence — "bonus" alone is not the name of anything at the table.
 *  Catalog KEYS, not words: these land inside sentences the user reads, and this module has no
 *  locale. Every consumer already has a `$_` or `t()` to spend on them. */
export const ACTION_SLOT_LABEL: Record<ActionSlot, string> = {
	action: 'combat.slot.action',
	bonus: 'combat.slot.bonus',
	reaction: 'combat.slot.reaction',
};

/** The dice sizes offered in the roll tray. */
export const DICE = [4, 6, 8, 10, 12, 20, 100];

/** `[0, 1, …, n-1]` — for rendering N pips/dots. */
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** A normal tap rolls instantly; Shift-click opens the prefilled roll tray. */
export const wantsTray = (e: Event) => (e as MouseEvent).shiftKey;

/**
 * Click-to-set for every pip tracker (action economy, spell slots, resources) — ONE model:
 * available pips on the LEFT, spent pips accumulate on the RIGHT. Clicking an available pip spends
 * from it rightward; clicking a spent pip restores from it leftward. Returns the new spent count,
 * always in [0, total]. Pure so it's the single source shared by every tracker and unit-testable.
 */
export function pipClick(currentSpent: number, index: number, total: number): number {
	const remaining = total - currentSpent; // pips 0..remaining-1 are available (left), rest spent
	return index < remaining ? total - index : total - index - 1;
}

/** What a roll target (e.g. "save.dex", "skill.stealth", "attack", "damage") picks up from active
 *  effects: advantage/disadvantage, signed bonus/penalty dice (Bless +1d4 / Bane −1d4), the summed
 *  FLAT bonus, and the roll-manipulation facts (`reroll`/`min_die`). NB `flat` is for keys the
 *  sheet does NOT already fold (attack/damage) — for save/skill keys the flat part is already
 *  inside the sheet value, so callers must ignore it there or it double-counts. Pure — the caller
 *  gates it on the effects-auto toggle.
 *
 *  Reads the sheet's typed-facts object (D7) — the resolve stage already evaluated guards,
 *  expanded conditions and resolved L2 expression values, so an expression bonus
 *  (`is_raging ? flat_bonus:damage+cha_mod`) arrives here as a plain number. */
export interface RollEffects extends DieMods {
	advantage: boolean;
	disadvantage: boolean;
	flat: number;
	bonusDice: BonusDie[];
}
export const NO_ROLL_EFFECTS: RollEffects = {
	advantage: false,
	disadvantage: false,
	flat: 0,
	bonusDice: [],
};
export function rollEffectsFor(facts: EffectFacts, key: string, scopes?: Set<string>): RollEffects {
	const out: RollEffects = { ...NO_ROLL_EFFECTS, bonusDice: [] };
	out.advantage = facts.advantage.some((a) => matchesTarget(a.target, key));
	out.disadvantage = facts.disadvantage.some((d) => matchesTarget(d.target, key));
	// a SCOPED fact applies only to something the scope names — every comma-separated part must be in
	// the rolling thing's scopes (GWF `two_handed,melee`), and a roll that names no scopes at all
	// (a save, a skill) picks up none of them
	const inScope = (scope: string | undefined): boolean =>
		!scope || (scopes ? scope.split(',').every((t) => scopes.has(t)) : false);
	for (const f of facts.numeric) {
		if (f.op !== 'add' || !matchesTarget(f.target, key)) continue;
		// §A: an ATTACK-scoped bonus is already in the row's to-hit (computeAttacks folds it there,
		// where the weapon is known), so picking it up again here would count it twice
		if (f.scope && (key === 'attack' || !inScope(f.scope))) continue;
		if (f.amount !== undefined) out.flat += f.amount;
		else if (f.diceFormula) {
			const die = parseDiceTerm(f.diceFormula);
			if (die) out.bonusDice.push(die);
		}
	}
	// §B: the same rule for a roll-MANIP (a scoped reroll / min-die).
	const scopeOk = (mod: RollMod): boolean => inScope(mod.scope);
	// several sources → the most generous single value applies (they don't stack — one reroll pass)
	for (const r of facts.rerolls)
		if (matchesTarget(r.target, key) && scopeOk(r)) out.reroll = Math.max(out.reroll ?? 0, r.value);
	for (const m of facts.minDie)
		if (matchesTarget(m.target, key) && scopeOk(m)) out.minDie = Math.max(out.minDie ?? 0, m.value);
	return out;
}

/** What a skill check rolls AS: its effect key plus the scopes that narrow which effects apply.
 *  `proficient` here means "this check adds your proficiency bonus" — RAW's own wording for Reliable
 *  Talent — so expertise carries it and Jack of All Trades' partial rung does not (2024 says "uses one
 *  of your skill proficiencies", which an untrained skill is not).
 *
 *  Shared, because a Stealth check is the same check whether the player taps it in the skills panel or
 *  takes the Hide action: two call sites building this by hand is how one of them rolled with no
 *  effects at all. */
export const skillRollTarget = (
	skill: SkillId,
	sheet: CharacterSheet | null,
): { key: string; scopes: Set<string> } => {
	const prof = sheet?.skills[skill]?.prof;
	return {
		key: `skill.${skill}`,
		scopes: new Set(prof === 'proficient' || prof === 'expertise' ? ['proficient'] : []),
	};
};

/** Just the roll-MANIPULATION half of a `RollEffects` — the `DieMods` a die carries. `RollEffects`
 *  extends `DieMods`, so passing the whole thing where `DieMods` is asked for type-checks while
 *  smuggling `bonusDice` and `flat` along with it: they then reach `rollPool`'s options through a
 *  spread and are applied a SECOND time. Narrow at the seam, so no caller can hand over more than
 *  the field is documented to hold. */
export const dieModsOf = (fx: RollEffects): DieMods => ({
	...(fx.reroll !== undefined ? { reroll: fx.reroll } : {}),
	...(fx.minDie !== undefined ? { minDie: fx.minDie } : {}),
	...(fx.maxDie !== undefined ? { maxDie: fx.maxDie } : {}),
});

/** The two outcomes a condition can force in place of a roll. Named, because they are recorded on
 *  the log entry and compared there — never as bare strings (AGENTS.md ▸ Taste). */
export const AUTO_OUTCOME = { fail: 'fail', succeed: 'succeed' } as const;
export type AutoOutcome = (typeof AUTO_OUTCOME)[keyof typeof AUTO_OUTCOME];

/** A forced roll outcome for `key`, or null to roll normally. `auto_fail`/`auto_succeed` effects
 *  (paralyzed → STR/DEX saves) override the RESULT, not the die — so a matched save doesn't roll at
 *  all. Auto-fail wins a contradictory pair (the debuff bias: conditions that force outcomes are
 *  debilitating, and a fail-closed default is safer than silently succeeding). */
export function autoOutcome(facts: EffectFacts, key: string): AutoOutcome | null {
	if (facts.autoFail.some((a) => matchesTarget(a.target, key))) return AUTO_OUTCOME.fail;
	if (facts.autoSucceed.some((a) => matchesTarget(a.target, key))) return AUTO_OUTCOME.succeed;
	return null;
}

/** Advantage + disadvantage cancel to a straight roll (5e rule) → the −1/0/+1 the roller takes. */
export const netAdvantage = (fx: Pick<RollEffects, 'advantage' | 'disadvantage'>): number =>
	fx.advantage === fx.disadvantage ? 0 : fx.advantage ? 1 : -1;
