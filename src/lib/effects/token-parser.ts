/*
 * L1 effect vocabulary — the token PARSER + per-token value resolution.
 *
 * The effects engine is an ISOLATED, optional, removable module: it interprets the BOUNDED effect
 * vocabulary (data, never `eval`/a DSL — a security property, see docs/internals/security.md). The rules
 * core has NO dependency on it; deleting `src/lib/effects/` leaves the core's {value,trace,notes}
 * contract intact. This module may import core TYPES (pipeline), never the reverse.
 *
 * `parseToken` is the SINGLE interpreter of the token grammar (`kind:target:value`, optional
 * `guard ?`). Naming rule: a raw string is a "token" until `parseToken` turns it into an object,
 * after which it is an "effect" (`ParsedEffect`). `resolveEffectValue` bridges to L2 — it
 * evaluates a token's value expression. The fold seam that consumes these lives in apply.ts.
 */
import type { SaidText } from '$lib/util/say';
import type { Layer } from '../rules/pipeline';
import { parseRecharge, type RechargePolicy } from '../rules/recharge';
import { evalExpression, diceToFormula, type ExprContext } from './expression-evaluator';

/** The bounded effect vocabulary, as named constants — compare against these, never bare strings. */
export const EFFECT_KIND = {
	flatBonus: 'flat_bonus',
	setOverride: 'set_override',
	// `block_bonus:<target>` — RAW's "can't benefit from any bonus to its <target>" (grappled/
	// restrained block ALL speed bonuses). A fact matched by target; drops effect-borne positive adds.
	blockBonus: 'block_bonus',
	// `halve:<target>` — a ×½ multiply (G4). The ONE RAW case for a non-integer factor (2014
	// exhaustion L2 = speed halved, L4 = hp-max halved); a dedicated kind, NOT a generic multiply,
	// because token value slots lex integers only and a `1/2` expr floors to 0. Targets: speed, hp_max.
	halve: 'halve',
	advantage: 'advantage',
	disadvantage: 'disadvantage',
	grantProficiency: 'grant_proficiency',
	// `grant_roll:<id>:<expr>` — a named, feature-granted ROLLABLE (Sneak Attack `Nd6`, Bardic
	// Inspiration die). The expr is an L2 value expression (composes with `step()`/`d`); derive
	// resolves it to a dice formula string for a rollable chip → the DiceTrayRequest seam (EFX-ROLL).
	grantRoll: 'grant_roll',
	// `damage_sensitivity:<relation>:<type>` — how this character RELATES to one damage type. One
	// kind rather than three, because the three relations are one axis (a damage multiplier: x0, x1/2,
	// x2), so "immunity outranks vulnerability outranks resistance" stays a comparison inside a kind.
	// The relation is REQUIRED: it is a closed keyword set, and anchoring it at the front leaves the
	// type slot free-form, which it must be (a pack may name its own damage type).
	damageSensitivity: 'damage_sensitivity',
	applyCondition: 'apply_condition',
	grantResource: 'grant_resource',
	// L1 roll-manipulation (the bounded, known set — NOT L3): the roll path consumes these facts.
	reroll: 'reroll', // `reroll:<target>:<threshold>` — reroll a die that lands ≤ threshold (GWF ≤2)
	minDie: 'min_die', // `min_die:<target>:<floor>` — treat a die result below floor AS floor (Reliable Talent d20→10)
	// Roll-OUTCOME overrides (not a die modifier — the result is forced regardless of the roll):
	// paralyzed/stunned auto-fail STR & DEX saves; a rare few auto-succeed. `auto_fail:<target>` /
	// `auto_succeed:<target>`, mirroring advantage/disadvantage (a fact + a note, matched by target).
	autoFail: 'auto_fail',
	autoSucceed: 'auto_succeed',
	// DISPLAY-ONLY free text (`note:<text>`): a rules effect the engine can't model on a single-
	// character sheet (attacks AGAINST you, auto-crit, sense-gated or relational effects). It never
	// folds and matches no target — it's shown, distinctly styled, so the mechanic is visible even
	// though it isn't auto-applied. Text is free-form (keeps its casing; `;` is the list separator).
	note: 'note',
	// MARKER (`blocks_concentration`, no target/value): the carrying state forbids Concentration —
	// RAW Rage ("you can't maintain Concentration"), a homebrew trance, etc. Surfaced as a fact flag the
	// combat layer reads to drop/withhold concentration; data-driven, so any CSV state can carry it.
	blocksConcentration: 'blocks_concentration',
	// MARKER (`damage_reroll`, no target/value): the carrying feature lets you, ONCE PER TURN, reroll a
	// WEAPON's damage dice and use either roll (2024 Savage Attacker). Distinct from `reroll:` (a
	// per-die threshold that always applies) — this is a whole-pool, player-invoked "roll twice, keep
	// higher". Surfaced as a fact the combat layer reads to OFFER a post-roll reroll button; fully
	// data-driven — any CSV feature carrying the token gets the affordance, labelled from the feature's
	// own name (never an id/string hardcoded in code).
	damageReroll: 'damage_reroll',
	// AUTO EVENT (`regain_on_initiative:<resource>:<n>`): a no-choice feature that, WHEN YOU ROLL
	// INITIATIVE, regains expended uses of <resource> until you have <n> (2024 Perfect Focus → Focus 4,
	// Superior Inspiration → Bardic Inspiration 2, Evergreen Wild Shape → 1). Same `kind:target:int`
	// shape as `reroll`/`min_die`. Surfaced as a fact the combat layer AUTO-APPLIES on entering combat +
	// notifies (the maintainer's call: auto + notification, not a player click — these are automatic in
	// RAW). Fully data-driven; the notice is labelled from the feature's own name. Kept beside `on_event`
	// rather than folded into it: "top up TO n" is not one of the executor verbs, and spelling it as one
	// would mean a verb that only ever appears here.
	regainOnInitiative: 'regain_on_initiative',
	// EVENT HOOK (`on_event:<event>:<action>`): when <event> happens to this character, run <action> —
	// one of the bounded executor verbs (docs/internals/actions.md §2), the same set a resource-option
	// spends into. Two bounded vocabularies crossed, so a third trigger costs a name in `PLAY_EVENT`
	// and a fire site, not a new token. Arbitrary event LOGIC stays an L3 plugin `onEvent` handler:
	// widening L1 past a bounded vocabulary is a security property, not a style choice.
	onEvent: 'on_event',
	// L3 handler REFERENCE (`plugin:<namespace>:<handlerName>[:<args>]`) — content never contains code, only this
	// pointer; the derive pre-pass resolves it through the plugin registry (docs/internals/plugins.md §1).
	// Missing/disabled/errored plugin → the token degrades to an inert note like any unknown.
	plugin: 'plugin',
} as const;
export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];
/** The kinds as a list (for schema validation / the `includes` guard). */
export const EFFECT_KINDS = Object.values(EFFECT_KIND) as readonly EffectKind[];
/** MARKER kinds carry no `:target` — a bare token IS the whole effect (`blocks_concentration`). Every
 *  other kind bare (`flat_bonus` with no target) stays malformed → `unknown`. */
const MARKER_KINDS = new Set<string>([EFFECT_KIND.blocksConcentration, EFFECT_KIND.damageReroll]);

// The recharge model's single owner is `rules/recharge`; re-exported here so token consumers keep
// importing it from the effects surface they already use.
export type { RechargePolicy };
export type DamageSensitivity = 'resist' | 'immune' | 'vulnerable';

/** Numeric caps on token values (cost, not game balance — content is untrusted input). Two classes:
 *  a bonus/override is only STORED and rendered as a scalar → a generous finite guard is enough (a
 *  +1e6 AC is silly, not dangerous); a resource `max` DRIVES the pip render loop (see AUDIT B10) →
 *  bound the WORK. Values past a cap are clamped, not dropped, so a typo still parses. */
const MAX_EFFECT_AMOUNT = 1_000_000;
export const MAX_RESOURCE_MAX = 1000;
const clampAmount = (n: number) =>
	Number.isFinite(n) ? Math.max(-MAX_EFFECT_AMOUNT, Math.min(MAX_EFFECT_AMOUNT, n)) : 0;

export interface ParsedEffect {
	kind: EffectKind | 'unknown';
	target?: string;
	/** Numeric flat bonus / override value (present when the value slot is a plain literal). */
	amount?: number;
	/** Dice bonus (e.g. "1d4" / "-1d4") — a roll modifier, not a flat number. */
	dice?: string;
	/** flat_bonus:damage:<type> — the damage-type slot (D9-tail). A flaming weapon's
	 *  `flat_bonus:damage:fire+1d6` carries `damageType: 'fire'`; a weapon folds it into its OWN
	 *  extra typed damage part (rolled + shown separately), never onto the base type. */
	damageType?: string;
	/**
	 * The ONE thing this bonus applies to, when it does not apply to everything: a weapon category
	 * (`melee`, `two_handed`), a weapon id, or a spell id. Written in the TARGET namespace —
	 * `flat_bonus:damage.melee+2`, `flat_bonus:damage.eldritch_blast+3` — where the dotted
	 * sub-targets already live (`speed.fly`, `save.str`), because the `:<qualifier>` slot routes by
	 * target (a `damage` qualifier is a damage TYPE) and the 4th token segment is reserved for a
	 * bonus type (`docs/internals/compatibility.md` §4).
	 *
	 * `flat_bonus:attack:<category>` (Archery, shipped) says the same thing in the older qualifier
	 * slot and normalizes to this field, so there is one shape downstream and one meaning.
	 * Comma-separated means ALL of them — `damage.melee,str` is 2014 Rage: a melee attack, AND one
	 * that resolved from Strength. The roll path already matched a list this way
	 * (`scope.split(',').every(...)`); the target grammar admits it too.
	 */
	scope?: string;
	/** set_override comparison mode (A9): `floor` = "unless already higher" (Headband → INT ≥ 19),
	 *  `cap` = "unless already lower". Absent = a plain absolute set. */
	setMode?: 'floor' | 'cap';
	/** L2 value expression (`ceil(level/2)`, `class_level.monk`) when the value slot is NOT a plain
	 *  literal — resolved against a ctx at derive time by `resolveEffectValue`, not here. Present on
	 *  `flat_bonus` / `set_override` (the stat value) and mirrored by `resource.max` below. */
	valueExpr?: string;
	/** damage_sensitivity: which relation the token declares to `target`'s damage type. */
	sensitivity?: DamageSensitivity;
	/** grant_proficiency: the LEVEL granted — one ladder value, not a set of booleans, so "expertise
	 *  without proficiency" is unrepresentable (the rungs are ordered, and sources combine by max).
	 *  `partial` is Jack of All Trades' rung; the sheet's own ladder carries a `none` below these. */
	proficiency?: 'partial' | 'proficient' | 'expertise';
	/** grant_resource: the fully-specified pool (only present when `id:max:recharge` is given). `max`
	 *  is a literal count; `maxExpr` is an L2 expression for it (`class_level.monk`) resolved at
	 *  derive time — exactly one of the two is set. */
	resource?: { id: string; max?: number; maxExpr?: string; recharge: RechargePolicy };
	/** plugin: the parsed handler reference. `args` is OPAQUE, hostile text the handler must parse
	 *  defensively (docs/internals/plugins.md §1) — never interpreted here. */
	plugin?: { namespace: string; handlerName: string; args: string };
	/** on_event: the executor action token to run when `target`'s event fires, verbatim (it carries its
	 *  own `:` and may hold an L2 formula — `heal:5+con_mod` — resolved at derive like every other). */
	action?: string;
	raw: string;
}

/** Parse results memoized by token string — consumers scan tokens per stat per derive (AUDIT D7
 *  perf), and a `ParsedEffect` is read-only by contract. Bounded like the expression parser's cache. */
const EFFECT_CACHE = new Map<string, ParsedEffect>();
const EFFECT_CACHE_MAX = 4000;

/**
 * Parse one bounded-vocab token — the SINGLE interpreter of the effect grammar (a security
 * boundary: data, never code). Every consumer reads the structured result instead of its own
 * regex. Unknown / malformed → `{kind:'unknown'}` (kept as an inert text note, never dropped).
 * Memoized; treat the result as immutable.
 */
export function parseToken(token: string): ParsedEffect {
	const hit = EFFECT_CACHE.get(token);
	if (hit) return hit;
	const res = parseTokenUncached(token);
	if (EFFECT_CACHE.size >= EFFECT_CACHE_MAX) EFFECT_CACHE.clear();
	EFFECT_CACHE.set(token, res);
	return res;
}

function parseTokenUncached(token: string): ParsedEffect {
	const p = classifyToken(token);
	// Targets/ids are lowercase snake by convention (E3). Normalize the target HERE (the one parse
	// chokepoint) so an author who types `flat_bonus:AC+2` or `damage_sensitivity:resist:Fire` matches
	// case-sensitive derive keys instead of silently folding onto nothing (a parsed-but-never-applied
	// no-op — the worst failure for an untrusted CSV). `valueExpr` is untouched (the L2 grammar is
	// already lowercase) and `raw` keeps the author's casing for the inert-note display. `note` is
	// EXEMPT — its "target" is free-form display prose that must keep its casing.
	if (p.kind !== EFFECT_KIND.note && p.target !== undefined && p.target !== p.target.toLowerCase())
		return { ...p, target: p.target.toLowerCase() };
	return p;
}

/** A per-kind token body parser: `rest` is everything after the first `:`, `kind` the matched kind
 *  (shared by the block/halve and reroll/min_die pairs), `raw` the trimmed original for inert notes. */
type KindParser = (rest: string, raw: string, kind: EffectKind) => ParsedEffect;

/** The `:<qualifier>` slot of a flat_bonus, routed by TARGET (the §A collision resolver): an
 *  `attack` bonus is never damage-typed → the qualifier is a weapon-category `scope`; any
 *  other target keeps the qualifier as a `damageType` (flaming-weapon extra part). Absent → {}.
 *
 *  On `attack` the qualifier and a dotted scope land in the SAME slot, so they are JOINED rather than
 *  one overwriting the other: `attack.melee:versatile` is a bonus on melee versatile weapons, and a
 *  comma list is already read as "all of these" by the roll path and by `scopedAttackBonus`. Letting
 *  the qualifier win widened the token instead of narrowing it. */
function qualifierSlot(
	target: string,
	slot: string | undefined,
	dottedScope: string | undefined,
): Partial<ParsedEffect> {
	if (!slot) return dottedScope ? { scope: dottedScope } : {};
	const q = slot.toLowerCase();
	if (baseTarget(target) !== 'attack')
		return { damageType: q, ...(dottedScope ? { scope: dottedScope } : {}) };
	return { scope: dottedScope ? `${dottedScope},${q}` : q };
}

/** The targets a dotted sub-name SCOPES rather than names: `damage.melee` is a damage bonus for
 *  melee things, while `speed.fly` is its own stat. Two families, one dot — so the split is a list,
 *  not a guess. */
const SCOPABLE_TARGETS: readonly string[] = ['attack', 'damage'];

const baseTarget = (target: string): string => target.toLowerCase().split('.')[0] ?? '';

/** Split a scoped target into what it hits and what it applies to: `damage.longsword` →
 *  `{target: 'damage', scope: 'longsword'}`. Every other dotted target is left whole, because it IS
 *  a target (`save.str`, `passive.perception`). */
function scopedTarget(target: string): { target: string; scope?: string } {
	const lower = target.toLowerCase();
	const dot = lower.indexOf('.');
	if (dot < 0) return { target: lower };
	const base = lower.slice(0, dot);
	if (!SCOPABLE_TARGETS.includes(base)) return { target: lower };
	const scope = lower.slice(dot + 1);
	return scope ? { target: base, scope } : { target: base };
}

const parseFlatBonus: KindParser = (rest, raw, kind) => {
	// literal fast path — ONE target grammar with the expression path below (snake, single
	// optional dot; `-` is the L2 minus operator, E3): a literal amount/dice never needs a ctx
	// optional `:<type>` slot between target and sign (D9-tail flaming damage): `damage:fire+1d6`.
	// `:` is structural (never inside an L2 expression), so this is unambiguous ahead of the `[+-]`.
	const lit =
		/^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+(?:,[a-z0-9_]+)*)?)(?::([a-z][a-z0-9_]*))?\s*([+-])\s*(\d+d\d+|\d+)$/i.exec(
			rest,
		);
	if (lit) {
		const { target, scope } = scopedTarget(lit[1] ?? '');
		const qual = qualifierSlot(target, lit[2], scope);
		const sign = lit[3] ?? '';
		const amount = lit[4] ?? '';
		if (/d/i.test(amount))
			return { kind, target, dice: (sign === '-' ? '-' : '') + amount, raw, ...qual };
		return { kind, target, amount: clampAmount(Number(sign + amount)), raw, ...qual };
	}
	// L2 expression value: `<target>[:<qualifier>]<+|->` then an expression. A `-` sign negates it.
	const ex =
		/^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+(?:,[a-z0-9_]+)*)?)(?::([a-z][a-z0-9_]*))?\s*([+-])\s*(.+)$/i.exec(
			rest,
		);
	if (!ex) return { kind: 'unknown', raw };
	const { target, scope } = scopedTarget(ex[1] ?? '');
	const qual = qualifierSlot(target, ex[2], scope);
	const valueExpr = ex[3] === '-' ? `-(${(ex[4] ?? '').trim()})` : (ex[4] ?? '').trim();
	return { kind, target, valueExpr, raw, ...qual };
};

const parseSetOverride: KindParser = (rest, raw, kind) => {
	// Optional trailing `:floor` / `:cap` (A9). L2 value expressions are colon-free (`:` is
	// structural, the guard's `?` is stripped upstream), so a final `:(floor|cap)` is unambiguous.
	let setMode: 'floor' | 'cap' | undefined;
	let body = rest;
	const modeM = /:(floor|cap)$/i.exec(rest);
	if (modeM?.[1]) {
		setMode = modeM[1].toLowerCase() as 'floor' | 'cap';
		body = rest.slice(0, modeM.index);
	}
	const withMode = (p: ParsedEffect): ParsedEffect => (setMode ? { ...p, setMode } : p);
	const lit = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+(?:,[a-z0-9_]+)*)?):(-?\d+)$/i.exec(body);
	if (lit)
		return withMode({ kind, target: lit[1] ?? '', amount: clampAmount(Number(lit[2])), raw });
	const ex = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+(?:,[a-z0-9_]+)*)?):(.+)$/i.exec(body);
	if (!ex) return { kind: 'unknown', raw };
	return withMode({ kind, target: ex[1] ?? '', valueExpr: (ex[2] ?? '').trim(), raw });
};

// `block_bonus:<target>` / `halve:<target>` — a bare (trimmed) target, no value slot.
const parseTargetOnly: KindParser = (rest, raw, kind) => ({ kind, target: rest.trim(), raw });

const parseGrantRoll: KindParser = (rest, raw, kind) => {
	// `grant_roll:<id>:<expr>` — id is snake (readable), expr is the colon-free L2 value slot.
	const m = /^([a-z0-9][a-z0-9_]*):(.+)$/i.exec(rest.trim());
	if (!m?.[1] || !m[2]) return { kind: 'unknown', raw };
	return { kind, target: m[1].toLowerCase(), valueExpr: m[2].trim(), raw };
};

const parseDamageSensitivity: KindParser = (rest, raw, kind) => {
	// `damage_sensitivity:<relation>:<type>`. A missing relation is malformed, not a default: an
	// author who meant immunity and typed one segment gets an inert note they can see, rather than a
	// silent downgrade to resistance.
	const m = /^(resist|immune|vulnerable):(.+)$/i.exec(rest);
	const [, relation, type] = m ?? [];
	if (!relation || !type) return { kind: 'unknown', raw };
	return {
		kind,
		sensitivity: relation.toLowerCase() as DamageSensitivity,
		target: type.trim(),
		raw,
	};
};

const parseGrantResource: KindParser = (rest, raw, kind) => {
	// `grant_resource:<id>` (bare flag) or `grant_resource:<id>:<max>:<recharge>` where <max> is a
	// literal OR an L2 expression (`class_level.monk`). The recharge keyword anchors the end, so
	// the middle (max) can hold expression characters (`*`, `(`, `,`) unambiguously.
	// Id is snake-only (E3): a kebab pool id would be unreadable from `resource.<id>` expressions.
	const m = /^([a-z0-9][a-z0-9_]*)(?::(.+):([a-z_]+(?:\([^:]*\))?))?$/i.exec(rest.trim());
	if (!m?.[1]) return { kind: 'unknown', raw };
	const id = m[1].toLowerCase();
	const maxSlot = m[2]?.trim();
	// the recharge word (or `trigger(amount)`) anchors the end; an unknown one leaves the token
	// unparsed rather than defaulting to a policy the author did not write
	const recharge = m[3] ? parseRecharge(m[3]) : undefined;
	if (maxSlot && m[3] && !recharge) return { kind: 'unknown', raw };
	if (maxSlot && recharge) {
		const resource = /^\d+$/.test(maxSlot)
			? { id, max: Math.min(Number(maxSlot), MAX_RESOURCE_MAX), recharge }
			: { id, maxExpr: maxSlot, recharge };
		return { kind, target: id, resource, raw };
	}
	return { kind, target: id, raw };
};

const parseGrantProficiency: KindParser = (rest, raw, kind) => {
	// `grant_proficiency:[<level>:]<target>` — the LADDER RUNG is an optional leading word, defaulting
	// to `proficient` so every token written before the rung existed keeps parsing. `partial` is Jack
	// of All Trades: a lesser rung, half the proficiency bonus on a check you are NOT proficient in.
	// NOT `half` — a rung is written BEFORE its target, so `half:skills` reads as "half the skills",
	// and "half" reads as a reduction when this rung is a GAIN. The rungs combine
	// by max, so a skill you are already proficient in keeps proficiency — which is RAW's "that
	// doesn't already include your proficiency bonus", for free.
	// The target is canonicalized here (the ONE place): a `skill.` prefix strips to the bare skill id
	// (skills are bare in this vocab; only saves carry their `save.` prefix), so authors can write
	// either form without it silently dropping.
	const m = /^(?:(partial|proficient|expertise):)?(?:skill\.)?(.+)$/i.exec(rest);
	if (!m?.[2]) return { kind: 'unknown', raw };
	const level = m[1]?.toLowerCase() as 'partial' | 'proficient' | 'expertise' | undefined;
	return { kind, target: m[2].trim(), proficiency: level ?? 'proficient', raw };
};

const parsePlugin: KindParser = (rest, raw, kind) => {
	// `plugin:<namespace>:<handlerName>[:<args>]` — grammar + length caps from docs/internals/plugins.md §1. The token is
	// attacker-controlled content; over-cap or malformed → inert unknown (never a partial parse).
	// `args` may itself contain `:` — only the first two separators are structural, which is also why
	// this body is exempt from `tightenDelimiters` and spells out its own `\s*` on those two.
	const m = /^([a-z0-9][a-z0-9-]{0,31})\s*:\s*([a-z0-9][a-z0-9-]{0,31})(?::([\s\S]{0,256}))?$/.exec(
		rest,
	);
	if (!m?.[1] || !m[2]) return { kind: 'unknown', raw };
	return { kind, plugin: { namespace: m[1], handlerName: m[2], args: m[3] ?? '' }, raw };
};

const parseRollMod: KindParser = (rest, raw, kind) => {
	// `reroll:<target>:<threshold>` / `min_die:<target>:<floor>` — a target plus one integer the
	// roll path reads. Target may be a group (`d20_tests`) or a specific key (`skill.stealth`). §B
	// adds an OPTIONAL middle weapon-category scope list (ALL tags required, comma-separated) for a
	// per-weapon damage manip: GWF `min_die:damage:two_handed,melee:3` (floors dice only on a
	// two-handed melee weapon). The trailing int always anchors the end.
	const m = /^([a-z0-9_.]+)(?::([a-z0-9_,]+))?:(\d+)$/i.exec(rest.trim());
	if (!m?.[1]) return { kind: 'unknown', raw };
	const scope = m[2]?.toLowerCase();
	return {
		kind,
		target: m[1].trim(),
		amount: Number(m[3]),
		raw,
		...(scope ? { scope: scope } : {}),
	};
};

/**
 * The play events an `on_event` token may hook — and the only ones the app fires. Closed on purpose:
 * an event name nobody fires would parse cleanly and then never happen, which is exactly the silent
 * no-op this vocabulary exists to prevent. A new trigger is a name here plus the one call site that
 * fires it (the plugin-facing vocabulary in docs/internals/actions.md §3 is the superset it grows
 * towards). `turn_start` fires on Next turn AND on entering combat, because the tracker's round 1 is
 * the character's first turn and dropping the feature's first use there would be a rules bug.
 */
export const PLAY_EVENT = { turnStart: 'turn_start' } as const;
export type PlayEvent = (typeof PLAY_EVENT)[keyof typeof PLAY_EVENT];
const PLAY_EVENTS = new Set<string>(Object.values(PLAY_EVENT));
/** Is this string one of the fired events? The parser rejects anything else, but a consumer reading
 *  `target` back off a ParsedEffect narrows through here rather than asserting the type. */
export const isPlayEvent = (s: string): s is PlayEvent => PLAY_EVENTS.has(s);

const parseOnEvent: KindParser = (rest, raw, kind) => {
	// `on_event:<event>:<action>` — only the FIRST separator is structural: the action is itself a verb
	// token (`heal:5+con_mod`, `attack:unarmed_strike:2`) and keeps every colon it came with.
	const sep = rest.indexOf(':');
	const event = sep === -1 ? '' : rest.slice(0, sep).toLowerCase();
	const action = sep === -1 ? '' : rest.slice(sep + 1).trim();
	if (!PLAY_EVENTS.has(event) || !action) return { kind: 'unknown', raw };
	return { kind, target: event, action, raw };
};

/** Body parsers keyed by kind. A kind with no entry (advantage / disadvantage / apply_condition /
 *  auto_fail / auto_succeed / note) takes the bare-target fallback in `classifyToken`. */
const KIND_PARSERS: Partial<Record<EffectKind, KindParser>> = {
	[EFFECT_KIND.flatBonus]: parseFlatBonus,
	[EFFECT_KIND.setOverride]: parseSetOverride,
	[EFFECT_KIND.blockBonus]: parseTargetOnly,
	[EFFECT_KIND.halve]: parseTargetOnly,
	[EFFECT_KIND.grantRoll]: parseGrantRoll,
	[EFFECT_KIND.damageSensitivity]: parseDamageSensitivity,
	[EFFECT_KIND.grantResource]: parseGrantResource,
	[EFFECT_KIND.grantProficiency]: parseGrantProficiency,
	[EFFECT_KIND.plugin]: parsePlugin,
	[EFFECT_KIND.reroll]: parseRollMod,
	[EFFECT_KIND.minDie]: parseRollMod,
	// `regain_on_initiative:<resource>:<n>` is the same `kind:target:int` shape (resource + the floor
	// to top up to), so it reuses the roll-mod parser — no scope segment is ever present.
	[EFFECT_KIND.regainOnInitiative]: parseRollMod,
	[EFFECT_KIND.onEvent]: parseOnEvent,
};

/** Kinds whose body ENDS in free-form prose (a `note:`'s display text, a plugin's argument): the
 *  interior spacing is content, so only the ends are trimmed. Every other kind's body is structure. */
const FREE_TEXT_BODY: ReadonlySet<string> = new Set([EFFECT_KIND.note, EFFECT_KIND.plugin]);

/** Whitespace touching a `:` or `,` is formatting, not meaning — `advantage: attack` and
 *  `min_die:damage:two_handed, melee:3` say exactly what they look like they say. Collapsed at the
 *  ONE parse chokepoint (as the target lowercasing in `parseTokenUncached` is), so every kind parser
 *  is tolerant without its regex spelling it out, and so is the next one somebody writes. */
function tightenDelimiters(kind: EffectKind, body: string): string {
	return FREE_TEXT_BODY.has(kind) ? body.trim() : body.replace(/\s*([:,])\s*/g, '$1').trim();
}

function classifyToken(token: string): ParsedEffect {
	const raw = token.trim();
	const sep = raw.indexOf(':');
	// a colon-less token is valid ONLY for a MARKER kind (no target/value — `blocks_concentration`);
	// every other kind bare (`flat_bonus`) is malformed → unknown.
	if (sep === -1)
		return MARKER_KINDS.has(raw) ? { kind: raw as EffectKind, raw } : { kind: 'unknown', raw };
	const kind = raw.slice(0, sep) as EffectKind;
	if (!EFFECT_KINDS.includes(kind)) return { kind: 'unknown', raw };
	const rest = tightenDelimiters(kind, raw.slice(sep + 1));
	// advantage / disadvantage / apply_condition / auto_fail / auto_succeed / note: bare target (rest
	// kept verbatim — note's free-text casing/spacing must survive; the trimming kinds have parsers).
	return (KIND_PARSERS[kind] ?? ((r, rw) => ({ kind, target: r, raw: rw })))(rest, raw, kind);
}

/** A resolved value for a `flat_bonus`/`set_override`/`grant_resource` token: a folded numeric
 *  `amount`, a `diceFormula` (rides the roll path, shown as a note), or an `error` (the L2
 *  expression failed → the token degrades to an inert note; EXPR-3 also routes it to content-health). */
export interface ResolvedValue {
	amount?: number;
	diceFormula?: string;
	error?: string;
}

/**
 * Resolve a token's value slot to a concrete quantity. A plain literal (`amount`/`dice`) passes
 * straight through; an L2 `valueExpr` is evaluated against `ctx` (SPEC2: effective vars) — a numeric
 * result is FLOORED (5e round-down) and cost-clamped, a dice result becomes a roller formula, a
 * failure returns `{error}`. Without a ctx an expression can't resolve (→ error), so the caller
 * degrades it; literals never need a ctx (core-off / no-effects path stays ctx-free).
 */
export function resolveEffectValue(p: ParsedEffect, ctx?: ExprContext): ResolvedValue {
	if (p.amount !== undefined) return { amount: p.amount };
	if (p.dice) return { diceFormula: p.dice };
	if (!p.valueExpr) return {};
	if (!ctx) return { error: 'expression needs a context' };
	const r = evalExpression(p.valueExpr, ctx);
	if (!r.ok) return { error: r.error };
	if (r.value.type === 'number') {
		// `inf` is a resource-max-only terminal (the evaluator lets it through untouched); every
		// OTHER value slot rejects it here — clampAmount would otherwise silently zero it.
		if (!Number.isFinite(r.value.value)) return { error: "'inf' is only valid as a resource max" };
		// `+ 0` normalizes a `-0` (from e.g. `-2*exhaustion` at exhaustion 0) to `0`.
		return { amount: clampAmount(Math.floor(r.value.value) + 0) };
	}
	return { diceFormula: diceToFormula(r.value.dice) };
}

/** A runtime effect source contributing tokens at a pipeline layer. `classId` marks tokens carried
 *  by a specific class's row/feature — SPEC4: their `spellcasting_mod` reads THAT class's mod. */
export interface ActiveEffect {
	source: string;
	layer: Layer;
	tokens: string[];
	classId?: string;
}

/** A ctx, or a per-effect ctx provider (used to scope `spellcasting_mod` to the carrying class). */
export type EffectCtx = ExprContext | ((eff: ActiveEffect) => ExprContext);
export const ctxOf = (ctx: EffectCtx | undefined, eff: ActiveEffect): ExprContext | undefined =>
	typeof ctx === 'function' ? ctx(eff) : ctx;

/** A token split into its optional condition GUARD and the effect part. The L2 guard is
 *  condition-FIRST (`is_raging ? advantage:attack`); `?` never appears elsewhere in the GRAMMAR
 *  (expressions use `if()`, not `?:`, and `:` is structural), so splitting on the first `?` is
 *  unambiguous. Free-text/unknown tokens MAY contain a `?` — their "guard" then fails to evaluate
 *  and the resolve stage keeps them verbatim as inert notes (never dropped). */
export interface GuardedToken {
	guard?: string;
	token: string;
}
export function splitGuard(raw: string): GuardedToken {
	const q = raw.indexOf('?');
	if (q === -1) return { token: raw.trim() };
	return { guard: raw.slice(0, q).trim(), token: raw.slice(q + 1).trim() };
}

/**
 * Does this token name the WEAPON's own attack/damage bonus (D9), rather than something the item
 * grants whoever carries it?
 *
 * A `+1` sword's `flat_bonus:attack+1` is a fact about that sword: `computeAttacks` folds it into
 * that one attack row, so the gather must keep it out of the global facts. The Luck Blade's
 * `flat_bonus:saves+1` and the Staff of Power's `flat_bonus:ac+2` are facts about the WIELDER and
 * ride globally as any worn item's do — which is why this is a question about the token, never about
 * the row. The guard is stripped first: a guarded bonus is still the weapon's.
 */
export const isWeaponOwnBonus = (token: string): boolean => {
	const p = parseToken(splitGuard(token).token);
	return p.kind === EFFECT_KIND.flatBonus && (p.target === 'attack' || p.target === 'damage');
};

/** Catalog keys for the derive-time issues — the ONE owner, like `NOTE_KEY` for the engine's rule
 *  notes, so the producers below and the message catalogs never drift on a bare string. */
export const ISSUE_KEY = {
	unknownTarget: 'effectIssue.unknownTarget',
	unknownTargetSuggested: 'effectIssue.unknownTargetSuggested',
	unknownCondition: 'effectIssue.unknownCondition',
	unknownConditionSuggested: 'effectIssue.unknownConditionSuggested',
	armorBlocksCasting: 'effectIssue.armorBlocksCasting',
	duplicateClassFeature: 'effectIssue.duplicateClassFeature',
	unreadableOptionEffect: 'effectIssue.unreadableOptionEffect',
	unreadableOptionCondition: 'effectIssue.unreadableOptionCondition',
	unreadableOptionCost: 'effectIssue.unreadableOptionCost',
	unrollableValue: 'effectIssue.unrollableValue',
	unreadableResourceMax: 'effectIssue.unreadableResourceMax',
	pluginFailed: 'effectIssue.pluginFailed',
	dependencyCycle: 'effectIssue.dependencyCycle',
	unreadableGuard: 'effectIssue.unreadableGuard',
	rolledAbilityScore: 'effectIssue.rolledAbilityScore',
	unreadableAbilityChange: 'effectIssue.unreadableAbilityChange',
	noPreparedCount: 'effectIssue.noPreparedCount',
} as const;

/** A derive-time problem with one token — the SPEC10 shape ({token, reason} + the carrying source)
 *  content-health merges with loader issues. */
export interface EffectIssue extends SaidText {
	source: string;
	token: string;
	/** What went wrong and what it means for the sheet, in the words of whoever wrote the CSV row, as
	 *  the catalog KEY and its values (`SaidText`) — the derive has no locale and the panel showing it
	 *  is re-read after a language switch. The parser's own phrasing belongs in `detail` (UX-1). */
	key: string;
	/** The technical particulars (the parser's complaint, a plugin's error) — shown demoted, so the
	 *  homebrew author still gets the exact fault the sentence summarizes. */
	detail?: string;
}
