/*
 * The action-economy subsystem of the Combat view-model: per-turn action/bonus/reaction pips (base 1,
 * plus extras granted by effects), movement tracking, turn advance, entering/leaving combat, and the
 * in-combat spend/enforce checks. Split out of CombatVM so the turn concern is one cohesive unit;
 * CombatVM composes it as `combat.economy`, passing getters for the reactive character + sheet.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import {
	pipClick,
	isEffectExpired,
	ACTION_SLOT_LABEL,
	type ActionSlot,
	type SpellRow,
	type EffectInstance,
	endConcentrationCarriedBy,
} from '$lib/combat/helpers';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

/** The condition that zeroes the action economy (no Action, Bonus Action, or Reaction). A named seam
 *  (not a bare string compare) — paralyzed/stunned/petrified/unconscious reach it by chaining
 *  `apply_condition:incapacitated`, so this one id gates them all. */
const INCAPACITATED_CONDITION_ID = 'incapacitated';

/** A turn with nothing spent yet — what `Next turn` and entering combat both reset to. */
const freshTurn = (): Character['play']['turn'] => ({
	action: 0,
	bonus: 0,
	reaction: 0,
	move: 0,
	grantedActions: 0,
	attacksMade: 0,
	usedRolls: [],
});

export class TurnEconomy {
	constructor(
		private getCharacter: () => Character | null,
		private getSheet: () => CharacterSheet | null,
	) {}

	/** Incapacitated → can't take actions/reactions/bonus actions (a rule-based block, B9). Read from
	 *  the resolved condition set, so any condition that chains into `incapacitated` triggers it too.
	 *  Gated on effects-auto (off → no automatic block). */
	incapacitated = $derived.by<boolean>(() => {
		const c = this.getCharacter();
		if (!c?.play.autoCalc) return false;
		return this.getSheet()?.facts.conditions.includes(INCAPACITATED_CONDITION_ID) ?? false;
	});

	// base 1 pip per slot + extras from standing effects (Haste → +1 action), rendered as more pips —
	// data-driven via `flat_bonus:<slot>+N` tokens. Reads the sheet's typed-facts object (D7: guards
	// evaluated, item/feature effects included, values resolved — B21). Action Surge is the OTHER kind
	// of extra: granted for this turn only, tracked in play-state, and counted whether effects-auto is
	// on or off. Incapacitated zeroes every slot, overriding both.
	slotMax = $derived.by<Record<ActionSlot, number>>(() => {
		if (this.incapacitated) return { action: 0, bonus: 0, reaction: 0 };
		const c = this.getCharacter();
		const max = { action: 1 + (c?.play.turn.grantedActions ?? 0), bonus: 1, reaction: 1 };
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
		Math.max(0, this.moveMax - (this.getCharacter()?.play.turn.move ?? 0)),
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
	/** Expire whatever round-timed effects have run out at the CURRENT round (with a notice — never
	 *  silently). A cast-linked effect that expires also ends its concentration (the spell's duration
	 *  IS the concentration's, RAW). Shared by the in-combat turn advance and the out-of-combat time
	 *  skip so both expire identically. */
	private expireTimedEffects = () => {
		const c = this.getCharacter();
		if (!c) return;
		// partition in ONE pass (isEffectExpired was evaluated twice before)
		const kept: EffectInstance[] = [];
		const expired: EffectInstance[] = [];
		for (const e of c.play.effects) (isEffectExpired(e, c.play.round) ? expired : kept).push(e);
		if (!expired.length) return;
		c.play.effects = kept;
		endConcentrationCarriedBy(c.play, expired);
		for (const e of expired) toast(t('combat.notice.effectExpired', { label: e.label }));
	};

	/** End the turn: refresh every action-economy slot, advance the round counter, and expire
	 *  round-timed effects. */
	nextTurn = () => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.turn = freshTurn();
		c.play.round += 1;
		this.expireTimedEffects();
	};

	/** B19: pass time OUT of combat — advance `rounds` (1 round = 6 s) and expire timed effects, so a
	 *  10-round Bless cast outside a fight actually ends instead of hanging until a rest. No
	 *  action-economy reset (there's no turn being taken). Callers pass 1 / 10 / 100 / 600 for a
	 *  round / minute / 10 minutes / hour. */
	advanceTime = (rounds: number) => {
		const c = this.getCharacter();
		if (!c || rounds <= 0) return;
		c.play.round += Math.floor(rounds);
		this.expireTimedEffects();
	};
	/** Has the player marked this granted roll as used this turn? Their mark, not the app's: only some
	 *  of these are once-per-turn (Sneak Attack is, a Bardic Inspiration die is not), and the content
	 *  does not say which — so the sheet offers the marker and the player decides what it means. */
	isRollUsed = (id: string): boolean =>
		(this.getCharacter()?.play.turn.usedRolls ?? []).includes(id);
	toggleRollUsed = (id: string) => {
		const turn = this.getCharacter()?.play.turn;
		if (!turn) return;
		turn.usedRolls = turn.usedRolls.includes(id)
			? turn.usedRolls.filter((x) => x !== id)
			: [...turn.usedRolls, id];
	};
	/** Enter/leave combat. Entering resets the turn + round so tracking starts clean; leaving hides the
	 *  turnbar and lifts action-economy enforcement. */
	toggleCombat = () => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.inCombat = !c.play.inCombat;
		if (c.play.inCombat) {
			c.play.turn = freshTurn();
			c.play.round = 1;
		}
	};

	/** Which turn slot an activity consumes, from its casting-time icon (default = the Action). */
	ctSlot(castTimeIcon: SpellRow['castTimeIcon']): ActionSlot {
		return castTimeIcon === 'react' ? 'reaction' : castTimeIcon === 'bonus' ? 'bonus' : 'action';
	}
	/** Silent gate for `slot` — is a pip free right now? (out of combat → always; incapacitated →
	 *  never). The check half of `trySpend`, exposed so an all-or-nothing activation can validate the
	 *  turn cost BEFORE mutating anything (it spends the resource + slot together or not at all). */
	canSpend(slot: ActionSlot): boolean {
		const c = this.getCharacter();
		if (!c || !c.play.inCombat) return true;
		if (this.incapacitated) return false;
		return c.play.turn[slot] < this.slotMax[slot];
	}

	/** Spend the turn cost of ONE weapon strike. Extra Attack buys several strikes with a single
	 *  Action, so the Action is charged on the first strike of each group and the rest ride it —
	 *  which is why an attack does not call `trySpend('action')` directly. */
	trySpendStrike(): boolean {
		const c = this.getCharacter();
		if (!c || !c.play.inCombat) return true;
		const perAction = Math.max(1, this.getSheet()?.attacksPerAction.value ?? 1);
		if (c.play.turn.attacksMade % perAction === 0 && !this.trySpend('action')) return false;
		c.play.turn.attacksMade += 1;
		return true;
	}

	/** In combat, spend one pip of `slot`; block (return false) + warn when it's exhausted. Out of
	 *  combat there is no economy → always allowed. */
	trySpend(slot: ActionSlot): boolean {
		const c = this.getCharacter();
		if (!c || !c.play.inCombat) return true;
		// incapacitated is a hard block, not an exhaustion — a distinct message ("Next turn" won't help)
		if (this.incapacitated) {
			toast(t('combat.notice.incapacitated'), {
				description: t('combat.notice.incapacitatedBody'),
			});
			return false;
		}
		if (c.play.turn[slot] >= this.slotMax[slot]) {
			toast(t('combat.notice.noSlotLeft', { slot: t(ACTION_SLOT_LABEL[slot]) }), {
				description: t('combat.notice.nextTurnToRefresh'),
			});
			return false;
		}
		c.play.turn[slot] += 1;
		return true;
	}
}
