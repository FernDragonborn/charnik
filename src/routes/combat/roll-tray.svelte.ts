/*
 * The dice-roll subsystem of the Combat view-model: the roll-builder tray state (pool, modifier,
 * advantage), the roll log, and the roll-execution methods. Split out of CombatVM so the roll concern
 * is one cohesive unit; CombatVM composes it as `combat.tray` and the higher-level actions
 * (attack/cast/action) call into it. Pure dice math lives in $lib/rules/dice.
 */
import {
	cycleAdvantage,
	rollPool,
	type BonusDie,
	type DieMods,
	type Rolled,
} from '$lib/rules/dice';
import { toastRoll } from '$lib/dice/roll-toast';
import {
	poolExpr,
	rollDamageParts,
	type RollLogEntry,
	type TypedRoll,
	type DamagePartSpec,
} from '$lib/combat/helpers';

/** The amendment sentence we write onto a roll's note. Matched so re-amending REPLACES it instead of
 *  stacking, and so undoing removes it without eating a note the roll already carried (an upcast's
 *  "8d6 base + 1d6 @ slot 4" is provenance, and amending the d20 must not destroy it). */
const AMEND_NOTE = /(?:^\s*|\s·\s)(?:dis)?advantage after the roll[^·]*/;

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
	/** Signed effect bonus dice (Bless +1d4) — only rollDiceNow applies these; a prefilled tray Roll
	 *  does not (it re-rolls the pool interactively). */
	bonusDice?: BonusDie[];
	/** reroll/min_die effect facts — apply on the tray's Roll too. */
	mods?: DieMods;
	/** Optional provenance line recorded with the completed roll (item 4: an upcast's "Xd base + Yd @
	 *  slot N"), so a boosted roll explains where the extra dice came from. */
	note?: string;
}

export class RollTray {
	// dice tray / roll builder
	dice = $state<Record<number, number>>({ 20: 1 }); // sides → count in the pool
	rollMod = $state(0);
	rollAdvantage = $state(0); // −1 disadvantage · 0 normal · +1 advantage
	rollSrc = $state<string | null>(null);
	/** reroll/min_die effect facts riding a prefilled roll (they apply on the tray's Roll too). */
	private rollMods: DieMods = {};
	/** Provenance line carried from a prefilled roll into its logged entry (item 4). */
	private rollNote: string | null = null;
	/** A follow-up roll fired right after the tray's Roll (an attack's damage after its to-hit) — one
	 *  typed part per damage type. */
	private pendingDamage = $state<{ label: string; parts: DamagePartSpec[] } | null>(null);
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

	rollExpr = $derived(poolExpr(this.dice, this.rollMod));

	bumpDie = (sides: number, d: number) => {
		const n = (this.dice[sides] ?? 0) + d;
		if (n <= 0) delete this.dice[sides];
		else this.dice[sides] = n;
		this.dice = { ...this.dice };
	};

	/** Clear the tray to a bare d20 (opening the dice menu fresh). */
	reset = () => {
		this.dice = { 20: 1 };
		this.rollMod = 0;
		this.rollAdvantage = 0;
		this.rollSrc = null;
		this.rollMods = {};
		this.rollNote = null;
		this.pendingDamage = null;
	};

	/** Prefill the tray for a specific roll (a stat/attack), so the player can pick advantage then
	 *  Roll. `spec.mods` = the roll's reroll/min_die effect facts (they survive into the tray's Roll). */
	prefill = (spec: RollSpec) => {
		this.rollSrc = spec.label;
		this.dice = { ...spec.dice };
		this.rollMod = spec.mod;
		this.rollAdvantage = spec.advantage ?? 0;
		this.rollMods = spec.mods ?? {};
		this.rollNote = spec.note ?? null;
		this.pendingDamage = null;
	};

	/**
	 * What rides on the tray's next Roll, for a READ-ONLY line beside the pool (UBUG-21, interim).
	 *
	 * The tray builds the TO-HIT — its pool, its modifier, its advantage — while the damage is queued
	 * out of sight. Under a heading that says "Greataxe" that reads as the attack, so a player adding
	 * "+1d6" for a damage rider gets it summed into the d20 and the card resolves a silently-wrong
	 * number (item 9). Showing what is queued does not make it editable; it makes the pool honest
	 * about being half of the roll. The editable version is `ROLLER-N`'s sub-roll model.
	 */
	get queuedDamage(): { label: string; text: string } | null {
		const p = this.pendingDamage;
		if (!p) return null;
		return {
			label: p.label,
			text: p.parts
				.map((part) => `${poolExpr(part.dice, part.mod)}${part.type ? ` ${part.type}` : ''}`)
				.join(' + '),
		};
	}

	/** Queue a damage roll to fire right after the tray's next Roll (an attack's to-hit → damage). Each
	 *  part is one damage type; they roll and display separately. */
	queueDamage = (spec: { label: string; parts: DamagePartSpec[] }) => {
		this.pendingDamage = { label: spec.label, parts: spec.parts };
	};

	/** The custom roll tray's Roll: rolls the pool + any queued attack damage as ONE combined entry
	 *  (line 1 = the roll, line 2 = the dropped adv die, then one line per damage type + a total). */
	doRoll = () => {
		const primary = rollPool(this.dice, {
			...this.rollMods,
			mod: this.rollMod,
			advantage: this.rollAdvantage,
		});
		const damage = this.pendingDamage ? rollDamageParts(this.pendingDamage.parts) : undefined;
		this.pendingDamage = null;
		this.pushRoll(this.rollSrc ?? 'Custom roll', primary, damage, this.rollNote ?? undefined);
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
		const entry: RollLogEntry = {
			label,
			...r,
			...(damage ? { damage } : {}),
			...(note ? { note } : {}),
			at: Date.now(),
		};
		this.log = [entry, ...this.log].slice(0, ROLL_LOG_MAX);
		this.persist?.(entry);
		toastRoll(entry);
		// return the STORED element, not the local literal: assigning into the $state array wraps it in a
		// reactive proxy, so a caller holding the entry (Savage Attacker's pending reroll) must hold the
		// SAME proxy the `{#each}` iterates — else an `entry === log[i]` identity check would never match.
		// `?? entry` only guards the type (log[0] is always the just-pushed element after the assignment).
		return this.log[0] ?? entry;
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
		const adv = revised.advantageRoll;
		const kept = (entry.note ?? '').replace(AMEND_NOTE, '').trim();
		const amendment = adv
			? `${adv.mode === -1 ? 'disadvantage' : 'advantage'} after the roll · kept ${adv.kept} over ${adv.dropped}`
			: '';
		const note = [kept, amendment].filter(Boolean).join(' · ');
		// a spread can't REMOVE a key, and a roll cycled back to neutral must lose the amendment line
		const { note: _replaced, ...rest } = revised;
		this.reviseEntry(entry, note ? { ...rest, note } : rest);
	};

	/** A no-roll cast (buff/utility): a bare log marker, not a rolled total. */
	logMarker = (label: string) => {
		this.log = [
			{ label, expr: '', dice: [], mod: 0, total: NaN, at: Date.now() },
			...this.log,
		].slice(0, ROLL_LOG_MAX);
	};
}
