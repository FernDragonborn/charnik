/*
 * The action-economy subsystem of the Combat view-model: per-turn action/bonus/reaction pips (base 1,
 * plus extras granted by effects), movement tracking, turn advance, entering/leaving combat, and the
 * in-combat spend/enforce checks. Split out of CombatVM so the turn concern is one cohesive unit;
 * CombatVM composes it as `combat.economy`, passing getters for the reactive character + sheet.
 */
import { toast } from 'svelte-sonner';
import { pipClick, isEffectExpired, type ActionSlot, type SpRow } from '$lib/combat/helpers';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

/** The condition that zeroes the action economy (no Action, Bonus Action, or Reaction). A named seam
 *  (not a bare string compare) — paralyzed/stunned/petrified/unconscious reach it by chaining
 *  `apply_condition:incapacitated`, so this one id gates them all. */
export const INCAPACITATED_CONDITION_ID = 'incapacitated';

export class TurnEconomy {
	constructor(
		private getCharacter: () => Character | null,
		private getSheet: () => CharacterSheet | null
	) {}

	/** Incapacitated → can't take actions/reactions/bonus actions (a rule-based block, B9). Read from
	 *  the resolved condition set, so any condition that chains into `incapacitated` triggers it too.
	 *  Gated on effects-auto (off → no automatic block). */
	incapacitated = $derived.by<boolean>(() => {
		const c = this.getCharacter();
		if (!c?.play.autoCalc) return false;
		return this.getSheet()?.facts.conditions.includes(INCAPACITATED_CONDITION_ID) ?? false;
	});

	// base 1 pip per slot + extras from effects (Action Surge → +1 action, Haste → +1 action), rendered
	// as more pips — data-driven via `flat_bonus:<slot>+N` tokens. Reads the sheet's typed-facts
	// object (D7: guards evaluated, item/feature effects included, values resolved — B21). Incapacitated
	// zeroes every slot (no action/bonus/reaction), overriding any extras.
	slotMax = $derived.by<Record<ActionSlot, number>>(() => {
		if (this.incapacitated) return { action: 0, bonus: 0, reaction: 0 };
		const c = this.getCharacter();
		const max = { action: 1, bonus: 1, reaction: 1 };
		if (c?.play.autoCalc)
			for (const f of this.getSheet()?.facts.numeric ?? [])
				if (f.op === 'add' && f.amount !== undefined && Object.hasOwn(max, f.target))
					max[f.target as keyof typeof max] += f.amount;
		return max;
	});
	get moveMax(): number {
		return this.getSheet()?.speed.value ?? 0;
	}
	moveLeft = $derived.by(() =>
		Math.max(0, this.moveMax - (this.getCharacter()?.play.turn.move ?? 0))
	);

	/** Click a pip in a slot. Same click-to-set model as spell slots: clicking a filled (available) pip
	 *  spends up to it; clicking a spent pip restores down to it. */
	usePip = (slot: ActionSlot, index: number) => {
		const t = this.getCharacter()?.play.turn;
		if (!t) return;
		t[slot] = pipClick(t[slot], index, this.slotMax[slot]);
	};
	/** Spend a step of movement (default 5 ft), clamped to the remaining pool. */
	spendMove = (ft = 5) => {
		const t = this.getCharacter()?.play.turn;
		if (!t) return;
		t.move = Math.min(this.moveMax, Math.max(0, t.move + ft));
	};
	resetMove = () => {
		const c = this.getCharacter();
		if (c) c.play.turn.move = 0;
	};
	/** End the turn: refresh every action-economy slot, advance the round counter, and expire
	 *  round-timed effects (with a notice — never silently). A cast-linked effect that expires also
	 *  ends its concentration (the spell's duration IS the concentration's, RAW). */
	nextTurn = () => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.turn = { action: 0, bonus: 0, reaction: 0, move: 0 };
		c.play.round += 1;
		const expired = c.play.effects.filter((e) => isEffectExpired(e, c.play.round));
		if (!expired.length) return;
		c.play.effects = c.play.effects.filter((e) => !isEffectExpired(e, c.play.round));
		for (const e of expired) {
			if (e.source && e.source === c.play.concentration) c.play.concentration = null;
			toast(`${e.label} — expired`);
		}
	};
	/** Enter/leave combat. Entering resets the turn + round so tracking starts clean; leaving hides the
	 *  turnbar and lifts action-economy enforcement. */
	toggleCombat = () => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.inCombat = !c.play.inCombat;
		if (c.play.inCombat) {
			c.play.turn = { action: 0, bonus: 0, reaction: 0, move: 0 };
			c.play.round = 1;
		}
	};

	/** Which turn slot an activity consumes, from its casting time (default = the Action). */
	ctSlot(ct: SpRow['ct']): ActionSlot {
		return ct === 'react' ? 'reaction' : ct === 'bonus' ? 'bonus' : 'action';
	}
	/** In combat, spend one pip of `slot`; block (return false) + warn when it's exhausted. Out of
	 *  combat there is no economy → always allowed. */
	trySpend(slot: ActionSlot): boolean {
		const c = this.getCharacter();
		if (!c || !c.play.inCombat) return true;
		// incapacitated is a hard block, not an exhaustion — a distinct message ("Next turn" won't help)
		if (this.incapacitated) {
			toast('Incapacitated', { description: "Can't take actions, bonus actions, or reactions." });
			return false;
		}
		if (c.play.turn[slot] >= this.slotMax[slot]) {
			toast(`No ${slot} left this turn`, { description: 'Press “Next turn” to refresh.' });
			return false;
		}
		c.play.turn[slot] += 1;
		return true;
	}
}
