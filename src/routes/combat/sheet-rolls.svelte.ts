/*
 * Roll semantics: what a tap on a stat, a save, a skill or an attack actually rolls — which effects
 * it picks up, whether the outcome is forced, and the once-per-turn weapon-damage reroll.
 *
 * **ROLLER-N lands here.** Its finding (ROLLER-PLAN) is that the roller answers with a formatted
 * STRING the UI parses back, so provenance and crit-doubling have nowhere to live — the rewrite is
 * against these functions and the host interface below is what it has to satisfy.
 */
import { toast } from 'svelte-sonner';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { rollPool } from '$lib/rules/dice';
import { toastRoll } from '$lib/dice/roll-toast';
import {
	wantsTray,
	rollEffectsFor,
	autoOutcome,
	netAdvantage,
	NO_ROLL_EFFECTS,
	rollDamageParts,
	dealsDamage,
	type RollEffects,
	type Attack,
	type DamagePartSpec,
	type TypedRoll,
	type MenuKind,
	type RollLogEntry,
} from '$lib/combat/helpers';
import type { RollSpec, RollTray } from './roll-tray.svelte';
import type { TurnEconomy } from './turn-economy.svelte';

/** What roll semantics need from the sheet around them. */
export interface SheetRollsHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	round: number;
	tray: RollTray;
	economy: TurnEconomy;
	openMenu(kind: MenuKind, e: Event): void;
}

export class SheetRolls {
	/* Accessor, not an object — a $derived field initialiser runs before a constructor parameter
	   property is assigned (same shape as the other subsystems). */
	constructor(private host: () => SheetRollsHost) {}

	// Savage Attacker (N2, `damage_reroll` fact): the last weapon-damage roll the player MAY reroll,
	// keeping the higher weapon-dice total — once per turn (2024). Held until used or superseded by the
	// next attack. The per-turn gate is `savageUsedRound` vs `round`: `round` advances on Next turn, so
	// the use auto-frees each turn with no reset hook. Whether it's OFFERED is fully data-driven — only
	// when a feature contributes a `damage_reroll` fact, and the button is labelled from that feature's
	// own name (see the `damage_reroll` token in token-parser.ts; no feat id/string is hardcoded here).
	private savagePending = $state<{
		spec: DamagePartSpec;
		roll: TypedRoll;
		entry: RollLogEntry;
	} | null>(null);
	private savageUsedRound = $state<number | null>(null);
	/** The feature name offering a once-per-turn weapon-damage reroll RIGHT NOW, or null when none is
	 *  pending / the per-turn use is spent / no `damage_reroll` feature is active. Drives the offer UI. */
	get savageLabel(): string | null {
		if (!this.savagePending || this.savageUsedRound === this.host().round) return null;
		return this.host().sheet?.facts.damageReroll[0]?.source ?? null;
	}
	/** The log entry the pending reroll would rewrite — so the roll log can put the button on that row. */
	get savagePendingEntry(): RollLogEntry | null {
		return this.savagePending?.entry ?? null;
	}

	/** Advantage/disadvantage + flat + bonus dice + reroll/min_die a roll picks up from active
	 *  effects (gated on the effects-auto toggle). Reads the sheet's typed-facts object (D7: guards
	 *  evaluated, conditions expanded, expression values resolved — B21), not raw `play.effects`. */
	effectsFor(key: string, weaponScopes?: Set<string>): RollEffects {
		const c = this.host().character;
		const sheet = this.host().sheet;
		if (!c || !c.play.autoCalc || !sheet) return NO_ROLL_EFFECTS; // effects-auto off → plain rolls
		return rollEffectsFor(sheet.facts, key, weaponScopes);
	}

	/** A forced outcome (paralyzed → auto-fail STR/DEX saves) for a roll key, or null. Gated on the
	 *  same effects-auto toggle as `effectsFor`, so turning auto off restores plain rolls. */
	private autoOutcomeFor(key: string): 'fail' | 'succeed' | null {
		const c = this.host().character;
		const sheet = this.host().sheet;
		if (!c || !c.play.autoCalc || !sheet) return null;
		return autoOutcome(sheet.facts, key);
	}

	// open the roll builder prefilled + anchored, so the player can pick advantage then Roll
	openRoll = (spec: RollSpec, e: Event) => {
		this.host().tray.prefill(spec);
		this.host().openMenu('dice', e);
	};
	// EVERY roll site: normal tap rolls instantly; Shift-click opens the prefilled tray. `key`
	// (e.g. "save.dex", "skill.stealth", "attack") lets the roll pick up matching effects. NB the
	// flat part is IGNORED for save/skill keys — it's already folded into the sheet value `mod`.
	roll = (label: string, mod: number, e: Event, key?: string) => {
		// a forced outcome (paralyzed → auto-fail its STR/DEX save) skips the die entirely — the result
		// is decided by the condition, not the roll; logged as a no-roll marker so it's still visible
		const forced = key ? this.autoOutcomeFor(key) : null;
		if (forced) {
			this.host().tray.logMarker(`${label} — auto-${forced}`);
			toast(`${label}: automatic ${forced === 'fail' ? 'failure' : 'success'}`);
			return;
		}
		const fx = key ? this.effectsFor(key) : null;
		const adv = fx ? netAdvantage(fx) : 0;
		if (wantsTray(e))
			// the effect DICE ride too: the tray used to drop them, so alt-clicking a roll under Bless
			// rolled a d4 short of the same roll tapped normally — a silently-wrong number, and exactly
			// what the roller's pills exist to make visible
			this.openRoll(
				{
					label,
					dice: { 20: 1 },
					mod,
					advantage: adv,
					bonusDice: fx?.bonusDice ?? [],
					mods: fx ?? {},
				},
				e,
			);
		else
			this.host().tray.rollDiceNow({
				label,
				dice: { 20: 1 },
				mod,
				advantage: adv,
				bonusDice: fx?.bonusDice ?? [],
				mods: fx ?? {},
			});
	};

	/** Roll a weapon/unarmed attack (the Attack action → spends an action in combat). A normal tap
	 *  rolls the to-hit (picks up attack advantage/flat/dice effects) THEN the weapon damage (with
	 *  `damage`-keyed effects — Rage +2, sneak/hemocraft dice); Shift-click opens the roll tray. */
	attackRoll = (at: Attack, e: Event) => {
		if (!this.host().economy.trySpend('action')) return;
		// §A/§B: pass this weapon's category tags so a scoped effect (GWF's min_die on two-handed melee
		// damage) applies only to matching weapons; unscoped effects (Bless, Rage) apply regardless.
		const scopes = new Set(at.scopes);
		const fx = this.effectsFor('attack', scopes);
		const dmgFx = this.effectsFor('damage', scopes);
		// Damage effects (Bless-style flat/dice, reroll/min_die) fold onto the PRIMARY part only — RAW
		// adds them to the weapon's base damage, not to a second damage type's dice.
		const parts: DamagePartSpec[] = at.damageParts.map((p, i) => ({
			dice: p.pool,
			mod: p.mod + (i === 0 ? dmgFx.flat : 0),
			type: p.type,
			...(i === 0 ? { bonusDice: dmgFx.bonusDice, mods: dmgFx } : {}),
		}));
		// asked AFTER the effects fold in, so a flat damage effect on a damage-less weapon still counts
		const hasDmg = dealsDamage(parts);
		if (wantsTray(e)) {
			// tray on the TO-HIT (pick advantage), then Roll fires the damage as one combined entry
			this.openRoll(
				{
					label: at.name,
					dice: { 20: 1 },
					mod: at.toHit + fx.flat,
					advantage: netAdvantage(fx),
					bonusDice: fx.bonusDice,
					mods: fx,
				},
				e,
			);
			if (hasDmg) this.host().tray.queueDamage({ label: `${at.name} damage`, parts });
			return;
		}
		// instant: to-hit (with effect advantage/flat/dice) + per-type damage → one combined entry
		const toHit = rollPool(
			{ 20: 1 },
			{ ...fx, mod: at.toHit + fx.flat, advantage: netAdvantage(fx) },
		);
		const dmgRolls = hasDmg ? rollDamageParts(parts) : undefined;
		// N2 Savage Attacker: does THIS weapon damage qualify for a reroll? The offer itself is not
		// attached to the toast — a toast expires mid-decision, so it announces and the always-visible
		// Playbar (and the log, forever) carries the control, as the ↻ on the damage pill it rerolls.
		// (The Alt-click tray path rolls damage later, so the offer rides the instant tap; a v1 gap.)
		const savage = this.savageOffer(parts[0], dmgRolls);
		const entry = this.host().tray.pushRoll(at.name, toHit, dmgRolls);
		if (savage) this.savagePending = { spec: savage.spec, roll: savage.roll, entry };
	};

	/** Does the attack about to be toasted qualify for a Savage Attacker reroll? ONLY when a feature
	 *  contributes a `damage_reroll` fact, the attack rolled damage dice, and the per-turn use is free.
	 *  Returns the PRIMARY damage part (so the reroll reproduces it) + the roll it made; the caller
	 *  pairs it with the log entry. Fully data-driven — no feat id/name in code. */
	private savageOffer(
		primary: DamagePartSpec | undefined,
		dmgRolls: TypedRoll[] | undefined,
	): { spec: DamagePartSpec; roll: TypedRoll } | null {
		const primaryRoll = dmgRolls?.[0];
		// there must be DICE to reroll — a flat-damage attack (Unarmed Strike) now rolls and toasts its
		// damage too, so "damage was rolled" no longer implies "dice were rolled" for this caller
		if (!primary || !primaryRoll || Object.keys(primary.dice).length === 0) return null;
		const label = this.host().sheet?.facts.damageReroll[0]?.source;
		if (!label || this.savageUsedRound === this.host().round) return null;
		return { spec: primary, roll: primaryRoll };
	}

	/** Savage Attacker: reroll the pending weapon damage and KEEP THE HIGHER total, rewriting the log
	 *  entry in place (truthful record) and spending the once-per-turn use. Rerolls the whole PRIMARY
	 *  damage part — RAW rerolls only the weapon's own dice, so any bonus die riding that part (Bless) is
	 *  rerolled too: a negligible, arguably-faithful deviation ("use either roll"). */
	savageReroll = () => {
		const p = this.savagePending;
		const label = this.savageLabel;
		if (!p || !label) return;
		const re = rollDamageParts([p.spec])[0];
		if (!re) return;
		const keptRe = re.total > p.roll.total;
		const keep = keptRe ? re : p.roll;
		const dropped = keptRe ? p.roll : re;
		const revised: RollLogEntry = {
			...p.entry,
			damage: [keep, ...(p.entry.damage ?? []).slice(1)],
			note: `${label}: kept ${keep.total} (other roll ${dropped.total})`,
		};
		this.host().tray.reviseEntry(p.entry, revised);
		this.savageUsedRound = this.host().round;
		this.savagePending = null;
		// re-toast the REVISED roll, not a summary line: the reroll changed the damage, so the player
		// should see the same card again with the kept dice in it
		toastRoll(revised);
	};
}
