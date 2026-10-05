/*
 * A rest as the PLAYER performs it — the choices it asks before it is taken. The short rest: how
 * many Hit Dice to spend, spending one, and the two healing models (RAW dice, or the `half` house
 * variant). The long rest: which spent Hit Dice come back, where it cannot return them all.
 *
 * What a rest DOES is not here — the recharge, the Hit Dice and the healing are pure actions in
 * `$lib/play/rests`. What this file owns is the popovers: the choice being made, and the press that
 * hands it over.
 */
import { hitDiceRecovery } from '$lib/rules/core';
import { diceShortRest, halfShortRest, spendHitDie } from '$lib/play/rests';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';
import type { Character, ShortRestMode } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { MenuKind } from '$lib/combat/helpers';
import type { ResourceTracker } from './resource-tracker.svelte';
import type { OpenOverlay } from './menu-overlay.svelte';

/** What the rest controls need from the sheet around them. */
export interface RestControlsHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	resources: ResourceTracker;
	/** Carry out a play-state action on the open character; false when it was refused. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): boolean;
	overlay: OpenOverlay | null;
	openMenu(kind: MenuKind, e: Event): void;
}

export class RestControls {
	constructor(private host: () => RestControlsHost) {}

	/** Hit-dice pools for the panel: each die size with its spent/left counts (left disables the spend
	 *  button when the pool is empty — refilled on a long rest).
	 *
	 *  A getter, not `$derived`: a field initialiser runs before the constructor assigns `host`, so a
	 *  `$derived` reading through it throws on construction (same reason `SheetRolls` uses accessors).
	 *  Reactivity is unaffected — the sheet reads inside still register with whatever effect calls it. */
	get hitDice() {
		return (this.host().sheet?.hitDice ?? []).map((h) => ({
			...h,
			spent: this.host().resources.hitDiceSpent(h.die),
			left: h.max - this.host().resources.hitDiceSpent(h.die),
		}));
	}
	/** Spend one Hit Die of the given size (short-rest healing). */
	spendHitDie = (die: string) => this.host().act((c, ctx) => spendHitDie(c, { die }, ctx));

	/** The character's short-rest healing model (per-character rules variant; `dice` = RAW default). */
	get shortRestMode(): ShortRestMode {
		return this.host().character?.ui.shortRestMode ?? 'dice';
	}
	/** Hit dice chosen to spend in the short-rest popover (die size → count). Reset when it opens. */
	hdPick = $state<Record<string, number>>({});
	/** Total hit dice currently selected in the popover. */
	hdPickCount = $derived(Object.values(this.hdPick).reduce((n, v) => n + v, 0));
	/** Bump the chosen count of one die size, clamped to [0, the pool's remaining]. */
	hdPickInc = (die: string, delta: number) => {
		const left = this.hitDice.find((h) => h.die === die)?.left ?? 0;
		this.hdPick = {
			...this.hdPick,
			[die]: Math.max(0, Math.min(left, (this.hdPick[die] ?? 0) + delta)),
		};
	};
	/** Press "☾ Short": the `half` model heals ½ max HP right away; the `dice` model opens the picker
	 *  popover (choose how many Hit Dice to spend). Both run the shared short-rest recharge (pools /
	 *  pact slots / effect expiry). */
	startShortRest = (e: Event) => {
		if (this.shortRestMode === 'half') return this.doHalfShortRest();
		this.hdPick = {}; // a fresh selection each time the picker opens
		this.host().openMenu('restshort', e);
	};
	/** The `half` short rest (BG3 / house variant): recharge + heal ½ max HP, no Hit Dice spent. */
	private doHalfShortRest() {
		if (this.host().act(halfShortRest)) this.host().resources.saveNow();
	}
	/** Commit the `dice` short rest: recharge, then spend each chosen Hit Die (each shows its own roll
	 *  in the log), and close the picker. */
	commitShortRest = () => {
		const hitDice = this.hdPick;
		if (this.host().act((c, ctx) => diceShortRest(c, { hitDice }, ctx)))
			this.host().resources.saveNow();
		this.hdPick = {};
		this.host().overlay = null;
	};

	/** Hit Dice the long rest will return, as the player has them chosen (die size → count). */
	hdRecover = $state<Record<string, number>>({});
	/** How many of them are chosen in all — the picker's counter against the budget. */
	hdRecoverCount = $derived(Object.values(this.hdRecover).reduce((n, v) => n + v, 0));
	/** How many spent Hit Dice this long rest may return. */
	get hdRecoverBudget(): number {
		return this.host().resources.longRestHitDiceBudget;
	}
	/** Whether there is anything to CHOOSE: the rest cannot return every spent die, and they are not
	 *  all one size. RAW only SRD 5.1 gets here — 5.2.1 returns them all. */
	private get longRestAsksWhich(): boolean {
		const out = this.hitDice.filter((h) => h.spent > 0);
		return out.length > 1 && out.reduce((n, h) => n + h.spent, 0) > this.hdRecoverBudget;
	}
	/** Bump how many dice of one size come back, clamped to that size's spent count and to the room
	 *  the budget has left. */
	hdRecoverInc = (die: string, delta: number) => {
		const spent = this.hitDice.find((h) => h.die === die)?.spent ?? 0;
		const now = this.hdRecover[die] ?? 0;
		const room = this.hdRecoverBudget - this.hdRecoverCount + now;
		this.hdRecover = { ...this.hdRecover, [die]: Math.max(0, Math.min(spent, room, now + delta)) };
	};
	/** Press "Long": where the rest returns only SOME of the spent Hit Dice and they differ in size,
	 *  ask which — pre-filled largest-first, so confirming at once is the rest it always was.
	 *  Everywhere else there is nothing to ask and the rest is taken on the press. */
	startLongRest = (e: Event) => {
		if (!this.longRestAsksWhich) return this.host().resources.rest('long');
		const spent = Object.fromEntries(this.hitDice.map((h) => [h.die, h.spent]));
		this.hdRecover = hitDiceRecovery(this.hitDice, spent, this.hdRecoverBudget);
		this.host().openMenu('restlong', e);
	};
	/** Commit the long rest with the chosen Hit Dice, and close the picker. */
	commitLongRest = () => {
		this.host().resources.rest('long', { hitDice: this.hdRecover });
		this.hdRecover = {};
		this.host().overlay = null;
	};
}
