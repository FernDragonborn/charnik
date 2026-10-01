/*
 * A rest as the PLAYER performs it — the choices it asks before it is taken. The short rest: how
 * many Hit Dice to spend, spending one, and the two healing models (RAW dice, or the `half` house
 * variant). The long rest: which spent Hit Dice come back, where it cannot return them all.
 *
 * The recharge itself is NOT here — `ResourceTracker.rest` owns refilling pools and pact slots for
 * both rest lengths, and applies the long rest's Hit-Dice recovery. What this file owns is the
 * popovers and the HP arithmetic hanging off them, which is UI flow rather than resource
 * bookkeeping. Every path here ends in `rest(...)`, so the two halves cannot drift apart.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { rollFormula } from '$lib/rules/dice';
import { hitDiceRecovery, shortRestHalfHeal } from '$lib/rules/core';
import type { Character, ShortRestMode } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { MenuKind } from '$lib/combat/helpers';
import type { RollJournal } from './roll-journal.svelte';
import type { ResourceTracker } from './resource-tracker.svelte';
import type { OpenOverlay } from './menu-overlay.svelte';

/** What the short rest needs from the sheet around it. `hpMax` is the EFFECTIVE max (a manual max
 *  with `hp_max` effects folded on top), which only the view-model can answer. */
export interface RestControlsHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	hpMax: number;
	journal: RollJournal;
	resources: ResourceTracker;
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
	/** Spend one Hit Die of the given size (short-rest healing): roll the die + CON mod, heal a MINIMUM
	 *  of 1 HP (RAW) clamped to max, log it, and mark the die spent. Blocked when that pool is empty. */
	spendHitDie = (die: string) => {
		const c = this.host().character;
		const pool = this.host().sheet?.hitDice.find((h) => h.die === die);
		if (!c || !pool) return;
		if (pool.max - this.host().resources.hitDiceSpent(die) <= 0) {
			toast(t('combat.notice.noHitDice', { die }), {
				description: t('combat.notice.regainOnLongRest'),
			});
			return;
		}
		const conMod = this.host().sheet?.abilities.con.mod ?? 0;
		const r = rollFormula(`1${die}${conMod >= 0 ? `+${conMod}` : conMod}`);
		c.play.hp.current = Math.min(this.host().hpMax, c.play.hp.current + Math.max(1, r.total)); // min 1 HP/die
		c.play.hitDiceSpent = {
			...c.play.hitDiceSpent,
			[die]: this.host().resources.hitDiceSpent(die) + 1,
		};
		this.host().journal.pushRoll(
			{ text: `Hit Die ${die}`, key: 'combat.roll.hitDie', values: { die } },
			r,
		);
	};

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
		const p = this.host().character?.play;
		if (!p) return;
		this.host().resources.rest('short');
		const heal = shortRestHalfHeal(this.host().hpMax);
		p.hp.current = Math.min(this.host().hpMax, p.hp.current + heal);
		this.host().journal.logMarker({
			text: `Short rest — +${heal} HP (½ max)`,
			key: 'combat.log.shortRestHalf',
			values: { hp: heal },
		});
		toast(t('combat.notice.shortRestHealed', { hp: heal }));
	}
	/** Commit the `dice` short rest: recharge, then spend each chosen Hit Die (roll + CON, min 1 HP —
	 *  each shows its own roll in the log), and close the picker. */
	commitShortRest = () => {
		this.host().resources.rest('short');
		for (const [die, count] of Object.entries(this.hdPick))
			for (let i = 0; i < count; i++) this.spendHitDie(die);
		this.hdPick = {};
		this.host().overlay = null;
		toast(t('combat.notice.shortRestTaken'));
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
