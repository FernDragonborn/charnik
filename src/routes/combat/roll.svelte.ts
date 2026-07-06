/*
 * The dice-roll subsystem of the Combat view-model: the roll-builder tray state (pool, modifier,
 * advantage), the roll log, and the roll-execution methods. Split out of CombatVM so the roll concern
 * is one cohesive unit; CombatVM composes it as `combat.tray` and the higher-level actions
 * (attack/cast/action) call into it. Pure dice math lives in $lib/rules/dice.
 */
import { toast } from 'svelte-sonner';
import { rollPool, type BonusDie, type Rolled } from '$lib/rules/dice';
import { signed, type RollLogEntry } from '$lib/combat/helpers';

/** Cap on the retained roll log (newest kept). */
const ROLL_LOG_MAX = 200;

export class RollTray {
	// dice tray / roll builder
	dice = $state<Record<number, number>>({ 20: 1 }); // sides → count in the pool
	rollMod = $state(0);
	rollAdvantage = $state(0); // −1 disadvantage · 0 normal · +1 advantage
	rollSrc = $state<string | null>(null);
	/** A follow-up roll fired right after the tray's Roll (an attack's damage after its to-hit). */
	private pendingDamage: { label: string; dice: Record<number, number>; mod: number } | null = null;
	log = $state<RollLogEntry[]>([]);

	rollExpr = $derived(
		Object.entries(this.dice)
			.sort((a, b) => Number(b[0]) - Number(a[0]))
			.map(([s, c]) => `${c}d${s}`)
			.join(' + ') + (this.rollMod ? ` ${signed(this.rollMod)}` : '')
	);

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
		this.pendingDamage = null;
	};

	/** Prefill the tray for a specific roll (a stat/attack), so the player can pick advantage then Roll. */
	prefill = (label: string, diceObj: Record<number, number>, mod: number, advantage = 0) => {
		this.rollSrc = label;
		this.dice = { ...diceObj };
		this.rollMod = mod;
		this.rollAdvantage = advantage;
		this.pendingDamage = null;
	};

	/** Queue a damage roll to fire right after the tray's next Roll (an attack's to-hit → damage). */
	queueDamage = (label: string, dice: Record<number, number>, mod: number) => {
		this.pendingDamage = { label, dice, mod };
	};

	/** The custom roll tray's Roll: rolls the pool + any queued attack damage as ONE combined entry
	 *  (line 1 = the roll, line 2 = the dropped adv die, line 3 = damage). */
	doRoll = () => {
		const primary = rollPool(this.dice, this.rollMod, this.rollAdvantage);
		const damage = this.pendingDamage
			? rollPool(this.pendingDamage.dice, this.pendingDamage.mod)
			: undefined;
		this.pendingDamage = null;
		this.pushRoll(this.rollSrc ?? 'Custom roll', primary, damage);
	};

	/** Roll a dice pool immediately (a tap that "just works"): `advantage` (−1/0/+1) and signed
	 *  `bonusDice` come from the stat's active effects. */
	rollDiceNow = (
		label: string,
		diceObj: Record<number, number>,
		mod: number,
		advantage = 0,
		bonusDice: BonusDie[] = []
	) => {
		this.pushRoll(label, rollPool(diceObj, mod, advantage, bonusDice));
	};

	/** Record a completed roll: prepend to the log (capped) and toast it. `damage` (for an attack) is
	 *  the roll that follows the to-hit — shown as its own line/part. */
	pushRoll = (label: string, r: Rolled, damage?: Rolled) => {
		this.log = [{ label, ...r, ...(damage ? { damage } : {}) }, ...this.log].slice(0, ROLL_LOG_MAX);
		const kept = r.advantageRoll ? `d20(${r.advantageRoll.kept}) ` : '';
		const drop = r.advantageRoll ? ` · drop d20(${r.advantageRoll.dropped})` : '';
		const dmg = damage ? ` · dmg ${damage.expr} = ${damage.total}` : '';
		toast(`${label} — ${r.total}${damage ? ` / ${damage.total} dmg` : ''}`, {
			description: `${kept}${r.expr} = ${r.total}${drop}${dmg}`.trim()
		});
	};

	/** A no-roll cast (buff/utility): a bare log marker, not a rolled total. */
	logMarker = (label: string) => {
		this.log = [{ label, expr: '', total: NaN }, ...this.log].slice(0, ROLL_LOG_MAX);
	};
}
