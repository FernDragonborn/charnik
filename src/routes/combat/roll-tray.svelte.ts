/*
 * The dice-roll subsystem of the Combat view-model: the roller ORGAN the tray mounts, the roll log,
 * and the roll-execution methods. Split out of CombatVM so the roll concern is one cohesive unit;
 * CombatVM composes it as `combat.tray` and the higher-level actions (attack/cast/action) call into
 * it. Pure dice math lives in $lib/rules/dice, and the organ's own model in $lib/dice/roller.
 *
 * The builder half used to live here as loose fields (`dice`, `rollMod`, `rollAdvantage`) plus a
 * `pendingDamage` queue that the tray could neither show nor edit — which is UBUG-21. It is now one
 * `RollerOrgan`: a test line and, when there IS damage, a damage line, both made of the same
 * editable pills. `prefill` / `queueDamage` keep their names and their callers.
 */
import {
	ADVANTAGE_MODE,
	advantageFromSign,
	cycleAdvantage,
	rollPool,
	type BonusDie,
	type DieMods,
	type Rolled,
} from '$lib/rules/dice';
import { toastRoll } from '$lib/dice/roll-toast';
import { RollerOrgan } from '$lib/dice/roller.svelte';
import {
	amendedNote,
	type RollLogEntry,
	type TypedRoll,
	type DamagePartSpec,
} from '$lib/combat/helpers';

/** Cap on the retained roll log (newest kept). */
const ROLL_LOG_MAX = 200;

/** A roll request — the pool + modifier and optional advantage / bonus dice / reroll-min_die mods.
 *  The ONE shape prefill / rollDiceNow / queueDamage (and the VM's openRoll) all speak, so a roll
 *  site passes one typed object instead of 5–6 positional args. */
export interface RollSpec {
	label: string;
	dice: Record<number, number>;
	mod: number;
	/** −1 disadvantage · 0 normal · +1 advantage (default 0). */
	advantage?: number;
	/** Signed effect bonus dice (Bless +1d4). They ride an instant roll, and a prefilled roller shows
	 *  them as pills you can edit or drag to the other line. */
	bonusDice?: BonusDie[];
	/** reroll/min_die effect facts — apply on the tray's Roll too. */
	mods?: DieMods;
	/** Optional provenance line recorded with the completed roll (item 4: an upcast's "Xd base + Yd @
	 *  slot N"), so a boosted roll explains where the extra dice came from. */
	note?: string;
	/** How many instances the action fires — a volley (Eldritch Blast's beams at level 5). Absent or 1
	 *  is the ordinary single roll. */
	times?: number;
}

/** One completed roll as a log line. Shared by the single push and the volley so a beam of a volley
 *  and a lone attack are the same record — only their timestamps differ. */
const entryOf = ({
	label,
	r,
	at,
	damage,
	note,
}: {
	label: string;
	r: Rolled;
	at: number;
	damage?: TypedRoll[];
	note?: string;
}): RollLogEntry => ({
	label,
	...r,
	...(damage ? { damage } : {}),
	...(note ? { note } : {}),
	at,
});

export class RollTray {
	/** The roll being built — the organ the dice tray mounts. Its lines, pills and state toggles ARE
	 *  the builder; nothing about the roll under construction lives beside it. */
	organ = new RollerOrgan();
	log = $state<RollLogEntry[]>([]);

	/**
	 * Sinks to the persistent `log.jsonl` (B4), injected by CombatVM so this module stays
	 * storage-agnostic (both no-ops when unset — tests, previews).
	 *
	 * `persist` appends a completed roll. `persistRevision` REPLACES the line a roll already wrote:
	 * an amendment (advantage applied after the fact, a Savage Attacker reroll) is not a new roll, it
	 * changes what that roll was decided as — and without this the correction lived only until the
	 * page reloaded, while the pill happily offered to amend the rehydrated one again (ROLLER-PLAN
	 * finding G).
	 */
	constructor(
		private readonly persist?: (entry: RollLogEntry) => void,
		private readonly persistRevision?: (entry: RollLogEntry) => void,
	) {}

	/** Restore the log from a prior session's persisted history (newest-first, capped). */
	seed = (entries: RollLogEntry[]) => {
		this.log = entries.slice(0, ROLL_LOG_MAX);
	};

	/** Clear the organ to an empty test line (opening the dice menu fresh). */
	reset = () => this.organ.reset();

	/** Prefill the roller for a specific roll (a stat/attack), so the player can pick advantage then
	 *  Roll. `spec.mods` = the roll's reroll/min_die effect facts; they ride the POOL's dice, so a
	 *  Great Weapon Fighting reroll never reaches a Bless die that lands in the same line. */
	prefill = (spec: RollSpec) => {
		this.organ.prefill({
			label: spec.label,
			test: {
				dice: spec.dice,
				mod: spec.mod,
				advantage: advantageFromSign(spec.advantage ?? 0),
				...(spec.mods ? { mods: spec.mods } : {}),
				...(spec.bonusDice?.length ? { bonusDice: spec.bonusDice } : {}),
				...(spec.times ? { times: spec.times } : {}),
			},
			...(spec.note ? { note: spec.note } : {}),
		});
	};

	/** Prefill a roll that is PURE DAMAGE — nothing decides it with a d20 (Fireball: the target saves,
	 *  not you). A separate entry point rather than a flag on `prefill`, because the two are different
	 *  SHAPES: this one has no test line at all, and giving damage one would hand it an advantage
	 *  toggle and a to-hit total it has no use for. */
	prefillDamage = (spec: { label: string; parts: DamagePartSpec[]; note?: string }) => {
		this.organ.prefill({
			label: spec.label,
			damage: spec.parts,
			...(spec.note ? { note: spec.note } : {}),
		});
	};

	/** Give the roll its damage half — one part per damage type. UBUG-21: this used to be a queue the
	 *  tray could neither show nor edit, so everything the player could change belonged to the to-hit
	 *  under a heading that said "Greataxe"; it is now the organ's second LINE, made of the same
	 *  pills. The label is dropped on purpose — the roll already has one, and "Greataxe" plus
	 *  "Greataxe damage" was one name said twice. */
	queueDamage = (spec: { label: string; parts: DamagePartSpec[] }) => {
		this.organ.setDamage(spec.parts);
	};

	/** Roll a dice pool immediately (a tap that "just works"): advantage, signed bonus dice and
	 *  reroll/min_die mods all come from the stat's active effects (via the RollSpec). */
	rollDiceNow = (spec: RollSpec) => {
		this.pushRoll(
			spec.label,
			rollPool(spec.dice, {
				...(spec.mods ?? {}),
				mod: spec.mod,
				...(spec.advantage === undefined ? {} : { advantage: spec.advantage }),
				...(spec.bonusDice ? { bonusDice: spec.bonusDice } : {}),
			}),
		);
	};

	/** Record a completed roll: prepend to the log (capped) and toast it. `damage` (for an attack) is
	 *  the per-type rolls that follow the to-hit — each shown as its own line, plus a combined total. */
	pushRoll = (label: string, r: Rolled, damage?: TypedRoll[], note?: string): RollLogEntry => {
		// spread rather than passed straight through: `damage: undefined` is not the same as "no damage"
		// under exactOptionalPropertyTypes, and the log entry must not carry an empty key
		const entry = entryOf({
			label,
			r,
			at: Date.now(),
			...(damage ? { damage } : {}),
			...(note ? { note } : {}),
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
	 *  per instance because each is its own throw; the organ's `roll()` builds its volley the same way,
	 *  which is why an instant cast and one sent through the tray come out identical. */
	pushVolley = (
		label: string,
		times: number,
		roll: () => { r: Rolled; damage?: TypedRoll[] },
		note?: string,
	): void => {
		const at = Date.now();
		this.recordRolls(
			// `at + i` so an amendment rewrites ITS beam, not a sibling that shared the millisecond
			Array.from({ length: Math.max(1, times) }, (_, i) => {
				const { r, damage } = roll();
				return entryOf({
					label,
					r,
					at: at + i,
					...(damage ? { damage } : {}),
					...(note ? { note } : {}),
				});
			}),
		);
	};

	/** Record rolls that one ACTION resolved — a volley's N instances. Each gets its own log line
	 *  (they are separate rolls, and each carries its own `at` so an amendment can rewrite the right
	 *  one), and they share ONE toast, because one action happened. */
	recordRolls = (entries: RollLogEntry[]): void => {
		if (!entries.length) return;
		this.log = [...entries, ...this.log].slice(0, ROLL_LOG_MAX);
		for (const entry of entries) this.persist?.(entry);
		toastRoll(entries);
	};

	/** Replace an existing log entry (identity match) with a revised copy — used by the Savage Attacker
	 *  reroll to rewrite a completed damage roll in place so the log stays truthful. No-op if the entry
	 *  has rolled off the capped log. */
	reviseEntry = (old: RollLogEntry, revised: RollLogEntry) => {
		this.log = this.log.map((e) => (e === old ? revised : e));
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
	amendAdvantage = (entry: RollLogEntry) => {
		const revised = cycleAdvantage(entry);
		if (!revised) return;
		const note = amendedNote(entry.note, revised);
		// a spread can't REMOVE a key, and a roll cycled back to neutral must lose the amendment line
		const { note: _replaced, ...rest } = revised;
		this.reviseEntry(entry, note ? { ...rest, note } : rest);
	};

	/** A no-roll cast (buff/utility): a bare log marker, not a rolled total. */
	logMarker = (label: string) => {
		this.log = [
			{
				label,
				expr: '',
				dice: [],
				d20s: [],
				advantage: ADVANTAGE_MODE.neither,
				mod: 0,
				total: NaN,
				at: Date.now(),
			},
			...this.log,
		].slice(0, ROLL_LOG_MAX);
	};
}
