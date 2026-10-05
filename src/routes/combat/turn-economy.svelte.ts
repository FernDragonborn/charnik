/*
 * The action-economy subsystem of the Combat view-model: the turn's pips and movement as the panels
 * read them, and the names they and the other subsystems call to spend one. What each press DOES is
 * a pure action in `$lib/play/turn`.
 */
import type { ActionSlot, SpellRow } from '$lib/combat/helpers';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { isIncapacitated } from '$lib/play/conditions';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';
import {
	advanceTime,
	canSpendTurnSlot,
	markRollUsed,
	nextTurn,
	resetMove,
	setTurnPip,
	spendMove,
	spendStrike,
	spendTurnSlot,
	toggleCombat,
	toggleRollUsed,
	turnSlotMax,
} from '$lib/play/turn';

const NO_SLOTS: Record<ActionSlot, number> = { action: 0, bonus: 0, reaction: 0 };

/** What this subsystem needs from the sheet around it. */
export interface TurnEconomyHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	/** Carry out a play-state action on the open character; false when it was refused. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): boolean;
}

export class TurnEconomy {
	constructor(private host: () => TurnEconomyHost) {}
	private getCharacter = () => this.host().character;
	private getSheet = () => this.host().sheet;
	private act: TurnEconomyHost['act'] = (action) => this.host().act(action);

	/** Incapacitated → can't take actions/reactions/bonus actions (a rule-based block, B9). */
	incapacitated = $derived.by<boolean>(() => {
		const c = this.getCharacter();
		const sheet = this.getSheet();
		return !!c && !!sheet && isIncapacitated(c, sheet);
	});

	/** Pips per slot this turn (`$lib/play/turn` ▸ `turnSlotMax`). */
	slotMax = $derived.by<Record<ActionSlot, number>>(() => {
		const c = this.getCharacter();
		const sheet = this.getSheet();
		return c && sheet ? turnSlotMax(c, sheet) : NO_SLOTS;
	});
	get moveMax(): number {
		return this.getSheet()?.speed.value ?? 0;
	}
	moveLeft = $derived.by(() =>
		Math.max(0, this.moveMax - (this.getCharacter()?.play.turn.move ?? 0)),
	);

	/** Click a pip in a slot. Same click-to-set model as spell slots. */
	usePip = (slot: ActionSlot, index: number) =>
		this.act((c, ctx) => setTurnPip(c, { slot, index }, ctx));
	/** Spend a step of movement (default 5 ft), clamped to the remaining pool. */
	spendMove = (feet = 5) => this.act((c, ctx) => spendMove(c, { feet }, ctx));
	resetMove = () => this.act(resetMove);

	/** End the turn: refresh every slot, advance the round counter, expire round-timed effects. */
	nextTurn = () => this.act(nextTurn);
	/** B19: pass time OUT of combat. Callers pass 1 / 10 / 100 / 600 for a round / minute /
	 *  10 minutes / hour. */
	advanceTime = (rounds: number) => this.act((c, ctx) => advanceTime(c, { rounds }, ctx));

	/** Has the player marked this granted roll as used this turn? */
	isRollUsed = (id: string): boolean =>
		(this.getCharacter()?.play.turn.usedRolls ?? []).includes(id);
	/** Record that something once-per-turn was done — the app's own mark, for an act it performed
	 *  itself (an extra attack). */
	markUsed = (id: string) => this.act((c) => markRollUsed(c, { id }));
	toggleRollUsed = (id: string) => this.act((c) => toggleRollUsed(c, { id }));
	/** Enter/leave combat. */
	toggleCombat = () => this.act(toggleCombat);

	/** Which turn slot an activity consumes, from its casting-time icon (default = the Action). */
	ctSlot(castTimeIcon: SpellRow['castTimeIcon']): ActionSlot {
		return castTimeIcon === 'react' ? 'reaction' : castTimeIcon === 'bonus' ? 'bonus' : 'action';
	}
	/** Silent gate for `slot` — is a pip free right now? The check half of `trySpend`, exposed so an
	 *  all-or-nothing activation can validate the turn cost BEFORE anything is paid. */
	canSpend(slot: ActionSlot): boolean {
		const c = this.getCharacter();
		const sheet = this.getSheet();
		return !c || !sheet || canSpendTurnSlot(c, sheet, slot);
	}

	/** Spend the turn cost of ONE weapon strike; false when the Action it needs is not there. */
	trySpendStrike(): boolean {
		return !this.getSheet() || this.act(spendStrike);
	}

	/** In combat, spend one pip of `slot`; block (return false) + warn when it's exhausted. Out of
	 *  combat there is no economy → always allowed. */
	trySpend(slot: ActionSlot): boolean {
		return !this.getSheet() || this.act((c, ctx) => spendTurnSlot(c, { slot }, ctx));
	}
}
