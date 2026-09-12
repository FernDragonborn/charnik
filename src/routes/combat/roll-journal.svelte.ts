/*
 * The dice-roll subsystem of the Combat view-model: the dice tray the overlay mounts, the roll log,
 * and the roll-execution methods. Split out of CombatVM so the roll concern is one cohesive unit;
 * CombatVM composes it as `combat.journal` and the higher-level actions (attack/cast/action) call into
 * it. Pure dice math lives in $lib/rules/dice, and the tray's own model in $lib/dice/roller.
 *
 * The builder half used to live here as loose fields (`dice`, `rollMod`, `rollAdvantage`) plus a
 * `pendingDamage` queue that the tray could neither show nor edit — which is UBUG-21. It is now one
 * `DiceTray`: a test line and, when there IS damage, a damage line, both made of the same
 * editable pills, built from ONE `RollSpec` — a roll site says what it wants rolled once.
 */
import {
	ADVANTAGE_MODE,
	advantageFromSign,
	cycleAdvantage,
	setAdvantage,
	type AdvantageMode,
	rollPool,
	type BonusDie,
	type DieMods,
	type Rolled,
} from '$lib/rules/dice';
import { toastRoll } from '$lib/dice/roll-toast';
import { DiceTray } from '$lib/dice/dice-tray.svelte';
import type { SaidText, SaidValue } from '$lib/util/say';
import {
	amendedAdvantage,
	nameFields,
	withoutLegacyAmendment,
	type AutoOutcome,
	type RollLogEntry,
	type RollName,
	type TypedRoll,
	type DamagePartSpec,
} from '$lib/combat/helpers';

/** Cap on the retained roll log (newest kept). Matches `LOG_MAX_LINES` on disk on purpose: a
 *  deeper in-session log silently loses everything past the disk cap on the next reload. */
const ROLL_LOG_MAX = 100;

/**
 * ONE roll request, carrying the whole action: what it is called, the d20 test, the damage it deals
 * and how many instances it fires. A roll site describes what it wants rolled ONCE — an attack used
 * to arrive in two calls (`prefill` then `queueDamage`), and the second call's label was dropped on
 * the floor because the roll already had one.
 *
 * The advantage axis stays NUMERIC here: a roll site gets it from `netAdvantage(fx)`, arithmetic
 * over effects that sums and clamps. It becomes the named `AdvantageMode` — "how this roll was
 * decided" — at exactly one seam, `prefill` below (docs/internals/roller.md).
 */
export interface RollSpec {
	label: string;
	/** The catalog key for `label` when the roll's name is a closed vocabulary (a skill, an ability
	 *  check or save). Travels to the record so the log is not frozen in one language. */
	labelKey?: string;
	/** ICU values for `labelKey`, including a value that is itself a catalog word (a numbered strike).
	 *  Travels to the record for the same reason the key does. */
	labelValues?: Record<string, SaidValue>;
	/** The d20 half. ABSENT means the roll is a QUANTITY and not a verdict: a Fireball has damage and
	 *  no test, because the target saves rather than you rolling to hit. The roller then builds no
	 *  test line at all, so there is no advantage toggle and no to-hit total to explain away. */
	test?: {
		dice: Record<number, number>;
		mod: number;
		/** −1 disadvantage · 0 normal · +1 advantage (default 0). */
		advantage?: number;
		/** Signed effect bonus dice (Bless +1d4). They ride an instant roll, and a prefilled roller
		 *  shows them as pills you can edit or drag to the other line. */
		bonusDice?: BonusDie[];
		/** reroll/min_die effect facts — apply on the tray's Roll too. */
		mods?: DieMods;
	};
	/** The damage half, one part per damage type. */
	damage?: DamagePartSpec[];
	/** Optional provenance line recorded with the completed roll (item 4: an upcast's "Xd base + Yd @
	 *  slot N"), so a boosted roll explains where the extra dice came from. */
	note?: string;
	/** How many instances the action fires — a volley (Eldritch Blast's beams at level 5). Absent or 1
	 *  is the ordinary single roll. */
	times?: number;
	/** Is this a WEAPON attack? Only a weapon's damage qualifies for a once-per-turn reroll (Savage
	 *  Attacker), so the tray has to know which kind of action it is holding — a Fire Bolt and a bare
	 *  tray roll go through the same tray and must not be offered it. */
	weapon?: boolean;
}

/** One completed roll as a log line. Shared by the single push and the volley so a beam of a volley
 *  and a lone attack are the same record — only their timestamps differ. */
const entryOf = ({
	label,
	labelKey,
	labelValues,
	r,
	at,
	damage,
	noteParts,
}: {
	label: string;
	labelKey?: string;
	labelValues?: Record<string, SaidValue>;
	r: Rolled;
	at: number;
	damage?: TypedRoll[];
	noteParts?: SaidText[];
}): RollLogEntry => ({
	label,
	...(labelKey ? { labelKey } : {}),
	...(labelValues ? { labelValues } : {}),
	...r,
	...(damage ? { damage } : {}),
	...(noteParts?.length ? { noteParts } : {}),
	at,
});

export class RollJournal {
	/** The roll being built — the dice tray this subsystem mounts. Its lines, pills and toggles ARE
	 *  the builder; nothing about the roll under construction lives beside it. */
	diceTray = new DiceTray();
	log = $state<RollLogEntry[]>([]);

	/**
	 * Sinks to the persistent `log.jsonl` (B4), injected by CombatVM so this module stays
	 * storage-agnostic (both no-ops when unset — tests, previews).
	 *
	 * `persist` appends a completed roll. `persistRevision` REPLACES the line a roll already wrote:
	 * an amendment (advantage applied after the fact, a Savage Attacker reroll) is not a new roll, it
	 * changes what that roll was decided as — and without this the correction lived only until the
	 * page reloaded, while the pill happily offered to amend the rehydrated one again.
	 */
	constructor(
		private readonly persist?: (entry: RollLogEntry) => void,
		private readonly persistRevision?: (entry: RollLogEntry) => void,
	) {}

	/** Restore the log from a prior session's persisted history (newest-first, capped). */
	seed = (entries: RollLogEntry[]) => {
		this.log = entries.slice(0, ROLL_LOG_MAX);
	};

	/** Is the roll the tray currently holds a weapon attack? Read by the surface that records the
	 *  tray's rolls to decide whether to arm the weapon-damage reroll. Every way of filling the tray
	 *  passes through `prefill` or `reset`, so it cannot go stale behind a spell or a custom roll. */
	weaponAttack = false;

	/** Clear the tray to an empty test line (opening the dice menu fresh). */
	reset = () => {
		this.weaponAttack = false;
		this.diceTray.reset();
	};

	/** Prefill the roller for one whole action, so the player can pick advantage then Roll. The tray
	 *  takes the request as it stands; the only translation left is the advantage axis, numeric on the
	 *  way in and named inside the roller. `test.mods` = the roll's reroll/min_die effect facts; they
	 *  ride the POOL's dice, so a Great Weapon Fighting reroll never reaches a Bless die that lands in
	 *  the same line. */
	prefill = (spec: RollSpec) => {
		this.weaponAttack = spec.weapon === true;
		this.diceTray.prefill({
			label: spec.label,
			...(spec.labelKey ? { labelKey: spec.labelKey } : {}),
			...(spec.labelValues ? { labelValues: spec.labelValues } : {}),
			...(spec.test
				? {
						test: {
							dice: spec.test.dice,
							mod: spec.test.mod,
							advantage: advantageFromSign(spec.test.advantage ?? 0),
							...(spec.test.mods ? { mods: spec.test.mods } : {}),
							...(spec.test.bonusDice?.length ? { bonusDice: spec.test.bonusDice } : {}),
						},
					}
				: {}),
			...(spec.damage?.length ? { damage: spec.damage } : {}),
			...(spec.times ? { times: spec.times } : {}),
			...(spec.note ? { note: spec.note } : {}),
		});
	};

	/** Roll a d20 test immediately (a tap that "just works"): advantage, signed bonus dice and
	 *  reroll/min_die mods all come from the stat's active effects (via the RollSpec). The parameter
	 *  REQUIRES the test half rather than shrugging at a spec without one — a damage-only request has
	 *  nothing for this method to roll, and "silently rolls nothing" is not a state worth having. */
	rollDiceNow = (spec: RollSpec & Required<Pick<RollSpec, 'test'>>) => {
		this.pushRoll(
			{ text: spec.label, ...(spec.labelKey ? { key: spec.labelKey } : {}) },
			rollPool(spec.test.dice, {
				...(spec.test.mods ?? {}),
				mod: spec.test.mod,
				...(spec.test.advantage === undefined ? {} : { advantage: spec.test.advantage }),
				...(spec.test.bonusDice ? { bonusDice: spec.test.bonusDice } : {}),
			}),
		);
	};

	/**
	 * A completed roll as the entry that records it, WITHOUT recording it — what an action resolving
	 * SEVERAL rolls collects so `recordRolls` can stamp one group and a distinct `at` on each.
	 *
	 * `at` defaults to now and is passed in by a batch, because two rolls made in the same millisecond
	 * would otherwise share the identity an amendment matches on and rewrite each other.
	 */
	entryFor = (
		name: RollName,
		r: Rolled,
		// spread rather than passed straight through: `damage: undefined` is not the same as "no damage"
		// under exactOptionalPropertyTypes, and the log entry must not carry an empty key
		opts: { at?: number; damage?: TypedRoll[]; noteParts?: SaidText[] } = {},
	): RollLogEntry =>
		entryOf({
			...nameFields(name),
			r,
			at: opts.at ?? Date.now(),
			...(opts.damage ? { damage: opts.damage } : {}),
			...(opts.noteParts ? { noteParts: opts.noteParts } : {}),
		});

	/** Record a completed roll: prepend to the log (capped) and toast it. `damage` (for an attack) is
	 *  the per-type rolls that follow the to-hit — each shown as its own line, plus a combined total. */
	pushRoll = (
		name: RollName,
		r: Rolled,
		damage?: TypedRoll[],
		noteParts?: SaidText[],
	): RollLogEntry => {
		const entry = this.entryFor(name, r, {
			...(damage ? { damage } : {}),
			...(noteParts ? { noteParts } : {}),
		});
		this.log = [entry, ...this.log].slice(0, ROLL_LOG_MAX);
		this.persist?.(entry);
		toastRoll(entry);
		// return the STORED element, not the local literal: assigning into the $state array wraps it in a
		// reactive proxy, so a caller holding the entry (Savage Attacker's pending reroll) must hold the
		// SAME proxy the `{#each}` iterates — else an `entry === log[i]` identity check would never match.
		// `?? entry` only guards the type (log[0] is always the just-pushed element after the assignment).
		return this.log[0] ?? entry;
	};

	/** Roll the same thing N times as ONE action — a volley (Eldritch Blast's beams). `roll` is called
	 *  per instance because each is its own throw; the tray's `roll()` builds its volley the same way,
	 *  which is why an instant cast and one sent through the tray come out identical. */
	pushVolley = (
		name: RollName,
		times: number,
		roll: () => { r: Rolled; damage?: TypedRoll[] },
		noteParts?: SaidText[],
	): void => {
		const at = Date.now();
		this.recordRolls(
			// `at + i` so an amendment rewrites ITS beam, not a sibling that shared the millisecond
			Array.from({ length: Math.max(1, times) }, (_, i) => {
				const { r, damage } = roll();
				return this.entryFor(name, r, {
					at: at + i,
					...(damage ? { damage } : {}),
					...(noteParts ? { noteParts } : {}),
				});
			}),
		);
	};

	/** Record rolls that one ACTION resolved — a volley's N instances. Each gets its own log line
	 *  (they are separate rolls, and each carries its own `at` so an amendment can rewrite the right
	 *  one), and they share ONE toast and ONE `group`, because one action happened.
	 *
	 *  The group is stamped HERE because this is the one seam every multi-instance action passes
	 *  through — the tray's Roll button and `pushVolley` alike — so a volley cannot be recorded
	 *  anywhere without it. A single roll is left ungrouped: being one line already says it. */
	recordRolls = (entries: RollLogEntry[]): void => {
		if (!entries.length) return;
		const group = entries.length > 1 ? crypto.randomUUID() : undefined;
		const action = group ? entries.map((e) => ({ ...e, group })) : entries;
		this.log = [...action, ...this.log].slice(0, ROLL_LOG_MAX);
		for (const entry of action) this.persist?.(entry);
		toastRoll(action);
	};

	/** Replace an existing log entry (identity match) with a revised copy — used by the Savage Attacker
	 *  reroll to rewrite a completed damage roll in place so the log stays truthful. No-op if the entry
	 *  has rolled off the capped log. */
	reviseEntry = (old: RollLogEntry, revised: RollLogEntry) => {
		// matched on `at`, the roll's own identity, falling back to the object only for an entry that
		// was never stamped: a previous amendment has already replaced the object once, so a caller
		// holding the pre-amendment copy would otherwise rewrite the disk line and no row on screen
		const same = (e: RollLogEntry) => (old.at === undefined ? e === old : e.at === old.at);
		this.log = this.log.map((e) => (same(e) ? revised : e));
		// the same roll, decided differently — rewrite ITS line rather than appending a second one
		if (revised.at !== undefined) this.persistRevision?.(revised);
	};

	/**
	 * UX-3: change how a roll that already landed was rolled. First tap rolls one more d20 and keeps
	 * the better; every tap after that switches between advantage and disadvantage, which only picks
	 * the OTHER die of the pair already on the table — so the toggle can never manufacture a better
	 * result, and a mis-tap is one tap from corrected.
	 *
	 * The player rolls first and amends only if the roll turns out to have been advantaged, which is
	 * how tables actually play ("that has advantage" once the die is down) and is RAW-exact rather
	 * than a fudge. Whether they were ENTITLED to it is table trust, not ours to police.
	 *
	 * The record stays truthful: the amended entry says it was changed after the fact and names the
	 * die that lost, the same shape the Savage Attacker reroll writes.
	 */
	/** Re-read a landed roll's d20 (UX-3). With no `mode` it CYCLES (the d20 pill's one tap);
	 *  with one it sets that mode outright, which is what spending 2014 Inspiration for advantage
	 *  does — the same amendment, arrived at deliberately rather than by tapping around the cycle. */
	amendAdvantage = (entry: RollLogEntry, mode?: AdvantageMode) => {
		const revised = mode ? setAdvantage(entry, mode) : cycleAdvantage(entry);
		if (!revised) return;
		const amendments = amendedAdvantage(entry, revised);
		// the roll's own note stays; only a legacy prose amendment is stripped, so an entry written
		// before amendments were structured does not end up carrying both
		const note = withoutLegacyAmendment(entry.note);
		// a spread can't REMOVE a key, and a roll cycled back to how it was rolled must lose both
		const { note: _replaced, amendments: _restated, ...rest } = revised;
		this.reviseEntry(entry, {
			...rest,
			...(note ? { note } : {}),
			...(amendments.length ? { amendments } : {}),
		});
	};

	/**
	 * A no-roll cast (buff/utility): a bare log marker, not a rolled total. Takes the same `RollName`
	 * a rolled entry does, so a marker carries its catalog key and reads in the language the log is
	 * being READ in — `log.jsonl` keeps the line verbatim, and a finished sentence written into it
	 * would be frozen in whatever language the marker happened in. `outcome` is the same fact for the
	 * marker a forced save leaves: the condition decided it, so there is no die to show.
	 */
	logMarker = (name: RollName, outcome?: AutoOutcome) => {
		const entry: RollLogEntry = {
			...nameFields(name),
			...(outcome ? { outcome } : {}),
			expr: '',
			dice: [],
			d20s: [],
			advantage: ADVANTAGE_MODE.neither,
			mod: 0,
			total: NaN,
			at: Date.now(),
		};
		this.log = [entry, ...this.log].slice(0, ROLL_LOG_MAX);
		// persisted like any other line: a paralysed character's auto-failed save is part of the record,
		// and a marker that lived only until the reload was the log quietly editing itself
		this.persist?.(entry);
	};
}
