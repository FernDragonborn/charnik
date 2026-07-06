/*
 * The action-economy subsystem of the Combat view-model: per-turn action/bonus/reaction pips (base 1,
 * plus extras granted by effects), movement tracking, turn advance, entering/leaving combat, and the
 * in-combat spend/enforce checks. Split out of CombatVM so the turn concern is one cohesive unit;
 * CombatVM composes it as `combat.economy`, passing getters for the reactive character + sheet.
 */
import { toast } from 'svelte-sonner';
import { parseEffect, EFFECT_KIND } from '$lib/effects/index';
import { pipClick, type ActionSlot, type SpRow } from '$lib/combat/helpers';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

export class TurnEconomy {
	constructor(
		private getCharacter: () => Character | null,
		private getSheet: () => CharacterSheet | null
	) {}

	// base 1 pip per slot + extras from effects (Action Surge → +1 action, Haste → +1 action), rendered
	// as more pips — data-driven via `flat-bonus:<slot>+N` tokens.
	slotMax = $derived.by<Record<ActionSlot, number>>(() => {
		const c = this.getCharacter();
		const max = { action: 1, bonus: 1, reaction: 1 };
		if (c?.play.autoCalc)
			for (const eff of c.play.effects)
				for (const t of eff.effects) {
					const p = parseEffect(t);
					if (
						p.kind === EFFECT_KIND.flatBonus &&
						p.amount !== undefined &&
						p.target &&
						Object.hasOwn(max, p.target)
					)
						max[p.target as keyof typeof max] += p.amount;
				}
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
	/** End the turn: refresh every action-economy slot and advance the round counter. */
	nextTurn = () => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.turn = { action: 0, bonus: 0, reaction: 0, move: 0 };
		c.play.round += 1;
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
		if (c.play.turn[slot] >= this.slotMax[slot]) {
			toast(`No ${slot} left this turn`, { description: 'Press “Next turn” to refresh.' });
			return false;
		}
		c.play.turn[slot] += 1;
		return true;
	}
}
