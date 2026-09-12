/*
 * The DICE TRAY's model — what a roller LINE is, and how a typed token becomes a pill.
 * Pure: no Svelte, no content graph, no locale. The tray's reactive state (`dice-tray.svelte.ts`)
 * and its UI (`Roller.svelte`) are built on this; every rule here is unit-testable on its own.
 *
 * The shape follows the spec's one structural claim: an attack roll and a damage roll are not two
 * instances of "a roll", they are DIFFERENT KINDS of thing. A d20 test is a VERDICT — one die decides
 * and the rest only colour it — while damage is a QUANTITY, where every die is equal and they add up.
 * So a line carries a `role`, and the state toggle that belongs to that role: advantage belongs to a
 * test, a crit belongs to damage. One line = one role, which is also why a long set can wrap without
 * the two halves ever mixing.
 *
 * A line is a list of PILLS, not a formula string. That is the same decision `Rolled.dice` made one
 * floor down: a pill can carry what a string cannot — which effect the die
 * came from, that a bound applies to it, that a damage type was inherited rather than typed.
 */
import {
	ADVANTAGE_MODE,
	ADVANTAGE_SIGN,
	MAX_DICE_PER_TERM,
	flatTotal,
	parseDiceTerm,
	type AdvantageMode,
	type BonusDie,
	type DieMods,
	type FlatPart,
} from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import type { DamagePartSpec } from '$lib/combat/roll';

/** What a pill IS. A named member, not a bare string (AGENTS.md ▸ Taste (open enums, never booleans)): every renderer and every
 *  fold switches on it, so a new kind must fail to compile rather than fall through silently. The
 *  KIND type is not exported and does not need to be — `RollerPill` is a discriminated union, so
 *  `pill.kind === PILL_KIND.dice` narrows to the member without anyone naming it. */
export const PILL_KIND = {
	/** Dice — the weapon's `2d6`, an effect's `+1d4`. */
	dice: 'dice',
	/** A flat modifier, wherever it sits in the line. */
	flat: 'flat',
	/** A damage type. Collapses to a `DamageIcon` once recognised; everything LEFT of it belongs to it. */
	damageType: 'damageType',
	/** A volley multiplier ("×3 attacks") — N instances of the same set, not N different lines. */
	count: 'count',
	/** A word the vocabulary doesn't know, written beside a die as a label ("1d4 dm's luck"). Not an
	 *  error: §6 says so outright. It adds nothing and blocks nothing — it is what the player called
	 *  this die. It carries no number, so the fold walks past it; `rollerNotes` is what takes it to the
	 *  roll's own note, which is where the player's own words belong. */
	note: 'note',
	/** Text the parser could not account for AS ARITHMETIC — `+d4?`. Never dropped, never rolled,
	 *  and the one thing that stops the roll (§5 / §10 / finding J). */
	raw: 'raw',
} as const;

/** The token the pill was made from, kept verbatim so Backspace and double-click can unfold the pill
 *  back into the exact text the player typed — "Bless → Bane" without retyping the whole token. */
interface PillCommon {
	text: string;
}

export interface DicePill extends PillCommon {
	kind: typeof PILL_KIND.dice;
	count: number;
	sides: number;
	sign: 1 | -1;
	/** Floor: treat a die below this AS this (Reliable Talent's `>10`). A property of the DIE. */
	min?: number;
	/** Ceiling: the mirror of `min` (`<10`). */
	max?: number;
	/** Reroll this die once if it lands at or under this (Great Weapon Fighting ≤2, Halfling Lucky 1).
	 *  On the DIE for the same reason the bounds are: RAW it belongs to the weapon's own dice, not to
	 *  a Bless die sitting beside them, and a line-level flag could not tell those apart. Arrives from
	 *  a prefill rather than from a token — no spelling of it has been asked for. */
	reroll?: number;
	/** Where the die came from ("Bless"). Present only when a real source exists — a die the player
	 *  typed by hand has none, and a "manual" marker would add nothing. Also what makes it an EFFECT
	 *  die rather than a pool die when it rolls. */
	source?: string;
}

export interface FlatPill extends PillCommon {
	kind: typeof PILL_KIND.flat;
	amount: number;
	source?: string;
}

interface DamageTypePill extends PillCommon {
	kind: typeof PILL_KIND.damageType;
	type: string;
	/** Set when the app added this pill rather than the player: the tail after a type inherits it.
	 *  Drawn as the SAME pill with a dashed edge, so inheritance is never silent and is edited the
	 *  same way — the moment another type is named, the inherited one goes. */
	inherited?: true;
}

interface CountPill extends PillCommon {
	kind: typeof PILL_KIND.count;
	times: number;
}

interface NotePill extends PillCommon {
	kind: typeof PILL_KIND.note;
}

interface RawPill extends PillCommon {
	kind: typeof PILL_KIND.raw;
	/** The fragment is a name the vocabulary knows TWICE — two packs shipping a Bless. It stays raw
	 *  (and so stops the roll) even on a damage line, where a plain word would become a damage type:
	 *  "bless" silently becoming a damage type named bless is how the `+1d4` went missing. */
	ambiguous?: true;
}

export type RollerPill = DicePill | FlatPill | DamageTypePill | CountPill | NotePill | RawPill;

/** What a line is FOR. The whole two-line model hangs off this: the stripe colour, which state
 *  toggle it gets, and whether it rolls a verdict or a quantity. */
export const ROLLER_ROLE = {
	/** A d20 test — attack, save, check. One die decides it. */
	test: 'test',
	/** Damage — every die counts and they add up. */
	damage: 'damage',
} as const;
export type RollerRole = (typeof ROLLER_ROLE)[keyof typeof ROLLER_ROLE];

export interface RollerLine {
	role: RollerRole;
	pills: RollerPill[];
	/** How this line's d20 are read. Meaningless on a damage line, which is why the toggle differs. */
	advantage: AdvantageMode;
	/** Crit. Manual on purpose: a natural 20 is not always a crit, and a crit happens without one. */
	crit: boolean;
}

export const emptyLine = (role: RollerRole): RollerLine => ({
	role,
	pills: [],
	advantage: ADVANTAGE_MODE.neither,
	crit: false,
});

/** Resolve a WORD (an effect name, a damage type) to what it means — supplied by the vocabulary,
 *  which is the only part of this that needs the content graph and the active locale. Returning null
 *  means "not a name I know", and the token falls through to raw.
 *
 *  It answers with a whole token rather than a pill because a source's contribution is not always a
 *  pill: an effect whose mechanic IS advantage (Blessing of the Trickster) has to be able to set how
 *  the line is read, and a resolver that could only return pills would drop it silently. */
export type RollerResolver = (word: string) => ParsedRollerToken | null;

/** What a typed token turns into. Not every token is a pill: `adv` sets how the line is READ, and a
 *  bound (`>10`) is a property of a die already in the line rather than a thing of its own. */
export const TOKEN_KIND = { pill: 'pill', advantage: 'advantage', bound: 'bound' } as const;
export type ParsedRollerToken =
	| { kind: typeof TOKEN_KIND.pill; pill: RollerPill }
	| { kind: typeof TOKEN_KIND.advantage; mode: AdvantageMode }
	| { kind: typeof TOKEN_KIND.bound; min?: number; max?: number };

/** `adv` / `dis` / `neut` and their long forms, in the one place they are spelled. English only, and
 *  deliberately so: these are the parser's native words, always taken whatever the UI language is.
 *  What a Ukrainian reader TYPES («перевага») arrives through the vocabulary's mode rows instead —
 *  the same road every other localized name takes. */
const ADVANTAGE_WORDS: Record<string, AdvantageMode> = {
	adv: ADVANTAGE_MODE.advantage,
	advantage: ADVANTAGE_MODE.advantage,
	dis: ADVANTAGE_MODE.disadvantage,
	disadv: ADVANTAGE_MODE.disadvantage,
	disadvantage: ADVANTAGE_MODE.disadvantage,
	neut: ADVANTAGE_MODE.neither,
	neutral: ADVANTAGE_MODE.neither,
	neither: ADVANTAGE_MODE.neither,
};

/** A flat modifier written on its own — `+3`, `−2`, or a bare `2`. Named because two things read it:
 *  the token parser, and the compound splitter that has to know a fragment means something. */
const FLAT_TERM = /^([+\-−]?)(\d+)$/;

/**
 * `2d6+3` — a compound token → its signed terms, or null when it is not one. Whitespace parses a
 * token (§4), but no-spaces is what a person types, and a formula pasted off a statblock has none
 * either; without this the whole thing lands as one raw fragment and BLOCKS the roll.
 *
 * The split only happens when EVERY term means something arithmetic on its own. That is what keeps
 * the house rule intact at the same time: `+d4?` still has a fragment nothing accounts for, so it
 * stays one raw pill and still blocks, and `dm's-luck` stays one label rather than becoming a word
 * plus an unrollable `-luck`.
 */
function compoundTerms(text: string): string[] | null {
	const terms = text.split(/(?=[+\-−])/).filter(Boolean);
	if (terms.length < 2) return null;
	return terms.every((t) => parseDiceTerm(t) !== null || FLAT_TERM.test(t)) ? terms : null;
}

/**
 * One token → what it means. Ordered so the cheap, unambiguous forms are decided before anything is
 * looked up by name: a word can only be an effect or a damage type once it is not a die, a number or
 * a bound. Anything left over becomes a `raw` pill — never dropped, and never rolled (§5).
 *
 * Both bound spellings are taken (`>10` and `>=10`) because both are what people write, and the
 * ceiling (`<10`) is accepted beside the floor even though no 5e mechanic needs one: it costs a
 * branch here, and a bound with no home would have to arrive later as a mechanism of its own.
 */
export function parseRollerToken(raw: string, resolve: RollerResolver): ParsedRollerToken | null {
	const text = raw.trim();
	if (!text) return null;
	const pill = (p: RollerPill): ParsedRollerToken => ({ kind: TOKEN_KIND.pill, pill: p });

	const mode = ADVANTAGE_WORDS[text.toLowerCase()];
	if (mode) return { kind: TOKEN_KIND.advantage, mode };

	const bound = /^([<>])=?(\d+)$/.exec(text);
	if (bound)
		return bound[1] === '>'
			? { kind: TOKEN_KIND.bound, min: Number(bound[2]) }
			: { kind: TOKEN_KIND.bound, max: Number(bound[2]) };

	const volley = /^[x×*](\d+)$/i.exec(text);
	if (volley)
		return pill({
			kind: PILL_KIND.count,
			text,
			times: Math.max(1, Math.min(Number(volley[1]), MAX_DICE_PER_TERM)),
		});

	const die = parseDiceTerm(text);
	if (die)
		return pill({
			kind: PILL_KIND.dice,
			text,
			count: die.count,
			sides: die.sides,
			sign: die.sign < 0 ? -1 : 1,
		});

	// a bare number reads as a positive modifier: writing "2" for "+2" is what people do, and a
	// modifier that is right is worth more than a purism that turns it into an unrollable fragment
	const flat = FLAT_TERM.exec(text);
	if (flat)
		return pill({
			kind: PILL_KIND.flat,
			text,
			amount: (flat[1] === '-' || flat[1] === '−' ? -1 : 1) * Number(flat[2]),
		});

	return resolve(text) ?? pill({ kind: PILL_KIND.raw, text });
}

/**
 * A dice pool + modifier (+ its damage type, its roll-manipulation facts, its effect dice) → the
 * pills that describe it. The ONE adapter every prefill goes through, so a roll arriving from an
 * attack row is the same kind of thing as one typed by hand — which is the point of the tray:
 * there is no "prefilled mode" it can be stuck in.
 *
 * `mods` land on the POOL's dice only, which is what keeps a Great Weapon Fighting reroll off a
 * Bless die sitting in the same line (RAW, and the reason those facts belong to a die rather than to
 * a line).
 */
export function pillsFromPool(
	dice: Record<number, number>,
	mod: number,
	opts: { type?: string; mods?: DieMods; bonusDice?: BonusDie[] } = {},
): RollerPill[] {
	const bounds = {
		...(opts.mods?.minDie !== undefined ? { min: opts.mods.minDie } : {}),
		...(opts.mods?.maxDie !== undefined ? { max: opts.mods.maxDie } : {}),
		...(opts.mods?.reroll !== undefined ? { reroll: opts.mods.reroll } : {}),
	};
	const pills: RollerPill[] = Object.entries(dice)
		.sort((a, b) => Number(b[0]) - Number(a[0]))
		.map(([sides, count]) => ({
			kind: PILL_KIND.dice,
			text: dicePillToken({ count, sides: Number(sides), sign: 1 }),
			count,
			sides: Number(sides),
			sign: 1,
			...bounds,
		}));
	// An effect die keeps whatever name the roll site knew. An empty one is not a missing field: it
	// says "an effect die nobody named", which is what makes it an EFFECT die rather than a pool one
	// so it cannot pick up the pool's rerolls. The caption prints a name only when there is one.
	for (const b of opts.bonusDice ?? [])
		pills.push({
			kind: PILL_KIND.dice,
			text: dicePillToken({
				count: b.count,
				sides: b.sides,
				sign: b.sign < 0 ? -1 : 1,
				source: '',
			}),
			count: b.count,
			sides: b.sides,
			sign: b.sign < 0 ? -1 : 1,
			source: b.source ?? '',
		});
	if (mod) pills.push({ kind: PILL_KIND.flat, text: signed(mod), amount: mod });
	if (opts.type) pills.push({ kind: PILL_KIND.damageType, text: opts.type, type: opts.type });
	return pills;
}

/**
 * The TOKEN a dice pill is spelled as — its `text`, which is what unfolding the pill puts back in the
 * draft. A signed (effect) die writes its sign, a pool die does not, exactly as the roll's own `expr`
 * does, so a pill and the record of it read alike.
 *
 * ONE builder because a pill's number and its token are the same fact twice: nudging a count used to
 * rewrite the text as bare `2d4`, and unfolding that turned a Bane die into a BONUS — an 8-point swing
 * on a d20 test with nothing on screen to say so.
 *
 * A bound (`>10`) is deliberately NOT spelled here: it arrives as its own token and lands on the die,
 * and a text carrying both would come back from an unfold as one unparsable fragment.
 */
export const dicePillToken = (
	p: Pick<DicePill, 'count' | 'sides' | 'sign'> & Pick<Partial<DicePill>, 'source'>,
): string => `${p.sign < 0 ? '-' : p.source !== undefined ? '+' : ''}${p.count}d${p.sides}`;

/** The pills that carry a NUMBER. The two folds below both walk these and skip the rest. */
const isValue = (p: RollerPill): p is DicePill | FlatPill =>
	p.kind === PILL_KIND.dice || p.kind === PILL_KIND.flat;

/**
 * Re-derive the line's implicit parts after an edit. Today that is exactly one rule: damage that
 * trails a type with no type of its own INHERITS it, and the inherited type is drawn as a real pill
 * (dashed, because it wasn't typed) rather than left as a silent assumption. Naming another type
 * removes it, since it is rebuilt from scratch every time rather than accumulated.
 *
 * A tail with nothing to inherit gets nothing — that case is a warning, not a guess (§7).
 */
export function normalizeLine(line: RollerLine): RollerLine {
	const pills = line.pills.filter((p) => !(p.kind === PILL_KIND.damageType && p.inherited));
	const at = pills.map((p) => p.kind).lastIndexOf(PILL_KIND.damageType);
	const last = pills[at];
	if (last?.kind === PILL_KIND.damageType && pills.slice(at + 1).some(isValue))
		pills.push({ kind: PILL_KIND.damageType, text: last.text, type: last.type, inherited: true });
	return { ...line, pills };
}

/** The volley pill for a roll the app already knows fires N times (Eldritch Blast's beams) — the
 *  same pill typing `×3` makes, so a prefilled volley and a typed one are one thing. */
export const countPill = (times: number): RollerPill => ({
	kind: PILL_KIND.count,
	text: `×${times}`,
	times,
});

/** A pill `normalizeLine` DERIVED rather than one that was typed. It is rebuilt from the group on its
 *  left after every edit, which makes it the one pill an edit must never target: removing it puts it
 *  straight back, and a Backspace that keeps hitting it can never reach the die in front of it. */
export const isInherited = (pill: RollerPill | undefined): boolean =>
	pill?.kind === PILL_KIND.damageType && pill.inherited === true;

/** A bare WORD — letters, spaces and the punctuation names carry. Not arithmetic, so it can never
 *  make a total quietly smaller, which is the whole test for whether a fragment may stop a roll. */
const isWord = (text: string): boolean => /^\p{L}[\p{L}\p{M}\s'’-]*$/u.test(text.trim());

/**
 * What an unrecognised token becomes, which depends on the line it landed in — and this is the one
 * place the two spec rules about unknown words meet.
 *
 * On a DAMAGE line a word is a damage TYPE: homebrew invents types freely, and one the app has no
 * glyph for still has to type its damage (§7 — it just stays a word instead of collapsing to an
 * icon). Anywhere else a word is a LABEL the player wrote beside a die ("1d4 dm's luck", §6) — it
 * adds nothing and stops nothing.
 *
 * Anything that is NOT a word stays raw, and raw is what blocks. That is the line the house rule
 * actually draws: a fragment that looks like arithmetic and did not parse would make the number
 * quietly smaller; a word never can.
 */
function wordPill(pill: RollerPill, role: RollerRole): RollerPill {
	if (pill.kind !== PILL_KIND.raw || pill.ambiguous || !isWord(pill.text)) return pill;
	return role === ROLLER_ROLE.damage
		? { kind: PILL_KIND.damageType, text: pill.text, type: pill.text.trim().toLowerCase() }
		: { kind: PILL_KIND.note, text: pill.text };
}

/** Add a typed token to a line, resolving what it means first. A bound lands on the last die in the
 *  line rather than becoming a pill of its own — it is a property of that die (§5) — and with no die
 *  to land on it stays raw, because a floor over nothing is not a fact we can keep. */
export function addToken(line: RollerLine, raw: string, resolve: RollerResolver): RollerLine {
	const compound = compoundTerms(raw.trim());
	if (compound) return compound.reduce((l, t) => addToken(l, t, resolve), line);
	const parsed = parseRollerToken(raw, resolve);
	if (!parsed) return line;
	// a mode is a fact about d20s: the vocabulary withholds the rows from a damage line, and typing the
	// word in full must not get past what the menu withheld — `roll()` reads the mode off the TEST line
	// alone, so a damage line's would be set, unrendered and ignored for ever
	if (parsed.kind === TOKEN_KIND.advantage) {
		if (line.role !== ROLLER_ROLE.test)
			return normalizeLine({
				...line,
				pills: [...line.pills, wordPill({ kind: PILL_KIND.raw, text: raw.trim() }, line.role)],
			});
		return { ...line, advantage: parsed.mode };
	}
	if (parsed.kind === TOKEN_KIND.pill)
		return normalizeLine({ ...line, pills: [...line.pills, wordPill(parsed.pill, line.role)] });

	const at = line.pills.map((p) => p.kind).lastIndexOf(PILL_KIND.dice);
	const die = line.pills[at];
	if (!die || die.kind !== PILL_KIND.dice)
		return { ...line, pills: [...line.pills, { kind: PILL_KIND.raw, text: raw.trim() }] };
	const bounded: DicePill = {
		...die,
		...(parsed.min !== undefined ? { min: parsed.min } : {}),
		...(parsed.max !== undefined ? { max: parsed.max } : {}),
		text: `${die.text} ${raw.trim()}`,
	};
	return { ...line, pills: line.pills.map((p, i) => (i === at ? bounded : p)) };
}

/** The dice + modifier a run of value pills comes to. A die with a SOURCE (or a negative one) is an
 *  effect die, not a pool die: that is the distinction `DIE_ROLE` keeps one floor down, and it is
 *  what stops a Bless d4 being rerolled by a Great Weapon Fighting style that owns the weapon's dice.
 *
 *  ponytail: a bound folds to the LINE's `DieMods`, so two dice in one line with different floors
 *  would share the more generous one. No 5e mechanic writes that; give `rollPool` per-die mods if one
 *  ever does. */
function foldValues(pills: RollerPill[]): {
	dice: Record<number, number>;
	mod: number;
	modParts: FlatPart[] | undefined;
	bonusDice: BonusDie[];
	mods: DieMods;
} {
	const dice: Record<number, number> = {};
	const bonusDice: BonusDie[] = [];
	const mods: DieMods = {};
	const flats: FlatPart[] = [];
	for (const p of pills) {
		if (p.kind === PILL_KIND.flat)
			flats.push({ amount: p.amount, ...(p.source !== undefined ? { source: p.source } : {}) });
		if (p.kind !== PILL_KIND.dice) continue;
		if (p.min !== undefined) mods.minDie = Math.max(mods.minDie ?? 0, p.min);
		if (p.max !== undefined) mods.maxDie = Math.min(mods.maxDie ?? p.max, p.max);
		if (p.reroll !== undefined) mods.reroll = Math.max(mods.reroll ?? 0, p.reroll);
		if (p.sign < 0 || p.source !== undefined)
			bonusDice.push({
				sides: p.sides,
				count: p.count,
				sign: p.sign,
				...(p.source ? { source: p.source } : {}),
			});
		else dice[p.sides] = (dice[p.sides] ?? 0) + p.count;
	}
	return { dice, mod: flatTotal(flats), modParts: namedParts(flats), bonusDice, mods };
}

/** The flat parts worth RECORDING: only when at least one of them knows where it came from. An
 *  anonymous `+3` is already fully described by the total beside it, and the roll log is a capped
 *  file every roll pays into — a list that says nothing does not earn its bytes on disk. */
const namedParts = (parts: FlatPart[]): FlatPart[] | undefined =>
	parts.some((p) => p.source !== undefined) ? parts : undefined;

/** What the player CALLED the dice in these lines — the `note` pills, which carry no number and so
 *  are the one contribution the fold has nothing to do with. They go to the roll's own note: a label
 *  someone typed beside a die is their words, not a fact the engine can name. */
export const rollerNotes = (lines: RollerLine[]): string[] =>
	lines.flatMap((l) => l.pills.filter((p) => p.kind === PILL_KIND.note).map((p) => p.text.trim()));

/**
 * The line's pills as DAMAGE GROUPS, by index: everything left of a type pill belongs to it, so a
 * group is a run of pills ending in its type (§7). The render draws each group as one figure, which
 * is how "this +3 belongs to the fire and not to the cold" is legible at all when a line carries
 * several types — the same fold `damageParts` does, exposed so the DOM can match the model instead
 * of laying every pill out flat and hoping.
 */
export function pillGroups(pills: RollerPill[]): number[][] {
	const groups: number[][] = [];
	let run: number[] = [];
	pills.forEach((pill, index) => {
		run.push(index);
		if (pill.kind === PILL_KIND.damageType) {
			groups.push(run);
			run = [];
		}
	});
	if (run.length) groups.push(run);
	return groups;
}

/** How many instances this line fires — the volley multiplier (§12: a volley rolls the SAME set N
 *  times, so it is a count, not N lines). */
export const volleyOf = (line: RollerLine): number =>
	line.pills.reduce((n, p) => (p.kind === PILL_KIND.count ? p.times : n), 1);

/** A test line → what `rollPool` needs. `advantage` comes off the line's own toggle, so the mode is
 *  part of the request rather than an argument beside it. */
export function testRoll(line: RollerLine): {
	dice: Record<number, number>;
	mod: number;
	modParts: FlatPart[] | undefined;
	advantage: number;
	bonusDice: BonusDie[];
	mods: DieMods;
} {
	const { dice, mod, modParts, bonusDice, mods } = foldValues(line.pills);
	return {
		dice,
		mod,
		modParts,
		bonusDice,
		mods,
		advantage: ADVANTAGE_SIGN[line.advantage],
	};
}

/**
 * A damage line → one part per damage type. Everything LEFT of a type pill belongs to it (§7), so
 * the walk closes a group at each type and the type it closed on names it. The inherited pill
 * `normalizeLine` appends is an ordinary type pill here — which is the point of materialising it:
 * the fold has one rule, not a rule plus an exception for the tail.
 *
 * A group that never meets a type keeps `type: ''` and still rolls. A missing damage type is not
 * arithmetic: without it the NUMBER is still right, so blocking the roll over it would be the app
 * refusing to do the one thing it is sure of (§10 / §11).
 */
export function damageParts(line: RollerLine): DamagePartSpec[] {
	const parts: DamagePartSpec[] = [];
	let run: RollerPill[] = [];
	const close = (type: string) => {
		if (!run.some(isValue)) return;
		const { dice, mod, modParts, bonusDice, mods } = foldValues(run);
		parts.push({
			dice,
			mod,
			type,
			...(modParts ? { modParts } : {}),
			...(bonusDice.length ? { bonusDice } : {}),
			...(Object.keys(mods).length ? { mods } : {}),
		});
		run = [];
	};
	for (const p of line.pills) {
		if (p.kind === PILL_KIND.damageType) close(p.type);
		else run.push(p);
	}
	close('');
	return parts;
}

/** Something the line cannot answer for. `blocking` stops the roll; a warning does not.
 *  The distinction is the house rule, not a severity dial: an unaccounted fragment would make the
 *  number quietly smaller, and a missing damage type would not (§10). */
export interface RollerIssue {
	/** Catalog key for what is wrong — the roller answers in the reader's language, and an issue is a
	 *  fact the surface words, the same ruling a roll's own name got. */
	key: string;
	/** ICU values for `key`. Only ever the player's own text, which is data and passes through. */
	values?: Record<string, string>;
	blocking: boolean;
}

/** Everything wrong with a set of lines, in reading order. Collected and returned rather than
 *  thrown — the content loader's `issues[]` precedent, and the `{roll, issues}` shape plan.md ▸
 *  `docs/internals/roller.md` asks for at the point the formula string is a plugin's public API. */
export function rollerIssues(lines: RollerLine[]): RollerIssue[] {
	const issues: RollerIssue[] = [];
	for (const line of lines) {
		for (const p of line.pills)
			// nonsense and a name two candidates SHARE both land here — the vocabulary leaves an ambiguous
			// one unresolved rather than picking a side — and each says which it is: "I can't account for
			// Bless" would be a lie when the trouble is that two packs ship one
			if (p.kind === PILL_KIND.raw)
				issues.push({
					key: p.ambiguous ? 'roller.issue.ambiguous' : 'roller.issue.unaccounted',
					values: { text: p.text },
					blocking: true,
				});
		if (line.role !== ROLLER_ROLE.damage) continue;
		if (damageParts(line).some((part) => !part.type))
			issues.push({ key: 'roller.issue.untypedDamage', blocking: false });
	}
	return issues;
}

/** Can these lines be rolled at all? Blocked by an unaccounted fragment, and by nothing else — the
 *  Roll button reads this to go muted, so "you can't press this" is visible rather than discovered
 *  by pressing it (§10). */
export const canRoll = (lines: RollerLine[]): boolean =>
	!rollerIssues(lines).some((i) => i.blocking) &&
	lines.some((l) => l.pills.some((p) => isValue(p)));
