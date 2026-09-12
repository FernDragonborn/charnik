/*
 * Roll semantics: what a tap on a stat, a save, a skill or an attack actually rolls — which effects
 * it picks up, whether the outcome is forced, and the once-per-turn weapon-damage reroll.
 *
 * These functions are what the dice tray calls, and the host interface below is the contract it
 * satisfies (docs/internals/roller.md).
 */
import { toast } from 'svelte-sonner';
import { t, translator } from '$lib/i18n';
import { attackRollName } from '$lib/combat/attacks';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { DIE_ROLE, rollPool, totalOf, type RolledDie } from '$lib/rules/dice';
import { toastRoll } from '$lib/dice/roll-toast';
import {
	wantsTray,
	rollEffectsFor,
	autoOutcome,
	AUTO_OUTCOME,
	netAdvantage,
	NO_ROLL_EFFECTS,
	rollDamageParts,
	dealsDamage,
	dieModsOf,
	AMENDMENT_KIND,
	type RollEffects,
	type Attack,
	type DamagePartSpec,
	type TypedRoll,
	type MenuKind,
	type RollLogEntry,
	type RollName,
	sayRollName,
	nameFields,
} from '$lib/combat/helpers';
import type { RollSpec, RollJournal } from './roll-journal.svelte';
import type { TurnEconomy } from './turn-economy.svelte';

/** What roll semantics need from the sheet around them. */
export interface SheetRollsHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	round: number;
	journal: RollJournal;
	economy: TurnEconomy;
	openMenu(kind: MenuKind, e: Event): void;
}

/** WHICH effects a roll picks up: its effect key (`save.dex`, `skill.stealth`, `attack`), and the
 *  scopes that narrow which of the matching ones apply. A bare string is the common case — a key with
 *  nothing to narrow — so most call sites read exactly as they did before scopes existed. */
export type RollTarget = string | { key: string; scopes?: Set<string> };

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
	/** The pending reroll names its roll by `at`, the roll's own identity, NOT by holding the entry
	 *  object: an amendment REPLACES that object in the log, so a held reference dangles the moment
	 *  the player re-reads the d20 — and both surfaces that draw the offer match it by identity, so
	 *  the offer silently withdrew itself. */
	private savagePending = $state<{
		spec: DamagePartSpec;
		roll: TypedRoll;
		at: number;
	} | null>(null);
	private savageUsedRound = $state<number | null>(null);
	/** The feature name offering a once-per-turn weapon-damage reroll RIGHT NOW, or null when none is
	 *  pending / the per-turn use is spent / no `damage_reroll` feature is active. Drives the offer UI. */
	get savageLabel(): string | null {
		if (!this.savagePending || this.savageUsedRound === this.host().round) return null;
		return this.host().sheet?.facts.damageReroll[0]?.source ?? null;
	}
	/** The log entry the pending reroll would rewrite — so the roll log can put the button on that row.
	 *  Looked up fresh every read, so an amended roll is still the row the offer belongs to. */
	get savagePendingEntry(): RollLogEntry | null {
		const at = this.savagePending?.at;
		if (at === undefined) return null;
		return this.host().journal.log.find((e) => e.at === at) ?? null;
	}

	/** Advantage/disadvantage + flat + bonus dice + reroll/min_die a roll picks up from active
	 *  effects (gated on the effects-auto toggle). Reads the sheet's typed-facts object (D7: guards
	 *  evaluated, conditions expanded, expression values resolved — B21), not raw `play.effects`. */
	effectsFor(key: string, scopes?: Set<string>): RollEffects {
		const c = this.host().character;
		const sheet = this.host().sheet;
		if (!c || !c.play.autoCalc || !sheet) return NO_ROLL_EFFECTS; // effects-auto off → plain rolls
		return rollEffectsFor(sheet.facts, key, scopes);
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
		this.host().journal.prefill(spec);
		this.host().openMenu('dice', e);
	};
	// EVERY roll site: normal tap rolls instantly; Shift-click opens the prefilled tray. `name` is
	// what the roll is called (and its catalog key, when it has one — the record keeps the key so the
	// log is not frozen in one language). `key` (e.g. "save.dex", "skill.stealth", "attack") is a
	// different thing: it lets the roll pick up matching EFFECTS. NB the flat part is IGNORED for
	// save/skill keys — it's already folded into the sheet value `mod`.
	// The two travel together as one argument because they answer one question — WHICH effects this
	// roll picks up — and because a fifth positional parameter is a type (AGENTS ▸ Taste). `scopes`
	// narrows the key the way a weapon's tags narrow an attack: a skill check says whether it adds
	// your proficiency bonus, which is the only thing RAW's Reliable Talent keys off.
	roll = (name: RollName, mod: number, e: Event, target?: RollTarget) => {
		const { key, scopes } = typeof target === 'string' ? { key: target } : (target ?? {});
		const label = name.text;
		// a forced outcome (paralyzed → auto-fail its STR/DEX save) skips the die entirely — the result
		// is decided by the condition, not the roll; logged as a no-roll marker so it's still visible
		const forced = key ? this.autoOutcomeFor(key) : null;
		if (forced) {
			// the outcome rides the entry as a FACT and the roll keeps its own name, so the line reads in
			// the language the log is READ in rather than the one the save was forced in
			this.host().journal.logMarker(name, forced);
			toast(
				t(
					forced === AUTO_OUTCOME.fail
						? 'combat.notice.automaticFailure'
						: 'combat.notice.automaticSuccess',
					{ label: sayRollName(name, translator()) },
				),
			);
			return;
		}
		const fx = key ? this.effectsFor(key, scopes) : null;
		const adv = fx ? netAdvantage(fx) : 0;
		if (wantsTray(e))
			// the effect DICE ride too: the tray used to drop them, so Shift-clicking a roll under Bless
			// rolled a d4 short of the same roll tapped normally — a silently-wrong number, and exactly
			// what the roller's pills exist to make visible
			this.openRoll(
				{
					label,
					...(name.key ? { labelKey: name.key } : {}),
					test: {
						dice: { 20: 1 },
						mod,
						advantage: adv,
						bonusDice: fx?.bonusDice ?? [],
						mods: fx ? dieModsOf(fx) : {},
					},
				},
				e,
			);
		else
			this.host().journal.rollDiceNow({
				label,
				...(name.key ? { labelKey: name.key } : {}),
				test: {
					dice: { 20: 1 },
					mod,
					advantage: adv,
					bonusDice: fx?.bonusDice ?? [],
					mods: fx ? dieModsOf(fx) : {},
				},
			});
	};

	/** Roll a weapon/unarmed attack (the Attack action → spends an action in combat). A normal tap
	 *  rolls the to-hit (picks up attack advantage/flat/dice effects) THEN the weapon damage (with
	 *  `damage`-keyed effects — Rage +2, sneak/hemocraft dice); Shift-click opens the roll tray. */
	attackRoll = (at: Attack, e: Event) => {
		if (!this.host().economy.trySpendStrike()) return;
		const { fx, parts, hasDmg } = this.attackSpec(at);
		if (wantsTray(e)) {
			// tray on the TO-HIT (pick advantage), then Roll fires the damage as one combined entry
			this.openRoll(
				{
					...nameFields(attackRollName(at, t)),
					test: {
						dice: { 20: 1 },
						mod: at.toHit,
						advantage: netAdvantage(fx),
						bonusDice: fx.bonusDice,
						mods: dieModsOf(fx),
					},
					...(hasDmg ? { damage: parts } : {}),
					weapon: true,
				},
				e,
			);
			return;
		}
		this.rollAttackNow(at);
	};

	/**
	 * Roll one attack instantly, charging NOTHING: no turn slot, no tray. What an action that makes
	 * attacks calls (UBUG-11) — a Flurry of Blows already paid one bonus action for the pair, so each
	 * strike inside it must not try to pay again. `name` distinguishes the strikes in the log.
	 */
	rollAttackNow = (at: Attack, name: RollName = attackRollName(at, t)) => {
		this.rollAttacks(at, [name]);
	};

	/**
	 * Roll N strikes of ONE attack as one action (a Flurry of Blows' pair, Extra Attack): each strike is
	 * its own throw and its own log line, recorded TOGETHER so they share a `group`, get distinct `at`
	 * stamps and toast as a single card — which is what `actionRuns` reads the run back from.
	 *
	 * The stamps are the load-bearing half: `at` is the identity an amendment matches on, and two
	 * strikes made in the same millisecond shared it, so re-reading one rewrote both and only one line
	 * on disk.
	 */
	rollAttacks = (at: Attack, names: RollName[]) => {
		const { parts, fx, hasDmg } = this.attackSpec(at);
		const stamp = Date.now();
		// instant: to-hit (with effect advantage/flat/dice) + per-type damage → one combined entry each
		const entries = names.map((name, i) =>
			this.host().journal.entryFor(
				name,
				rollPool({ 20: 1 }, { ...fx, mod: at.toHit, advantage: netAdvantage(fx) }),
				{ at: stamp + i, ...(hasDmg ? { damage: rollDamageParts(parts) } : {}) },
			),
		);
		this.host().journal.recordRolls(entries);
		// N2 Savage Attacker: does THIS weapon damage qualify for a reroll? The offer itself is not
		// attached to the toast — a toast expires mid-decision, so it announces and the always-visible
		// Playbar (and the log, forever) carries the control, as the ↻ on the damage pill it rerolls.
		// A multi-strike action arms on its FIRST strike, like a volley through the tray does.
		const first = entries[0];
		const savage = this.savageOffer(parts[0], first?.damage);
		if (savage && first?.at !== undefined)
			this.savagePending = { spec: savage.spec, roll: savage.roll, at: first.at };
	};

	/**
	 * Record the rolls the TRAY made and, when they were a weapon attack, arm the same once-per-turn
	 * reroll a tapped attack offers. The damage a tray roll throws is built by the tray (the player
	 * may have edited it, and the crit toggle lives there), so the part to reroll comes from the tray
	 * rather than from the attack the tray was prefilled with.
	 *
	 * A volley arms on its FIRST instance — the one the log and the Playbar show on top, and the one
	 * the offer's pill is drawn on.
	 */
	recordTrayRolls = (entries: RollLogEntry[]) => {
		this.host().journal.recordRolls(entries);
		const entry = entries[0];
		if (!this.host().journal.weaponAttack || !entry || entry.at === undefined) return;
		const savage = this.savageOffer(this.host().journal.diceTray.damageSpecs[0], entry.damage);
		if (savage) this.savagePending = { spec: savage.spec, roll: savage.roll, at: entry.at };
	};

	/** The effects and damage parts an attack rolls with — shared by the tap, the tray and the action
	 *  executor, so the three can never disagree about what a weapon actually swings for. */
	private attackSpec(at: Attack) {
		// §A/§B: pass this weapon's category tags so a scoped effect (GWF's min_die on two-handed melee
		// damage) applies only to matching weapons; unscoped effects (Bless, Rage) apply regardless.
		const scopes = new Set(at.scopes);
		const fx = this.effectsFor('attack', scopes);
		const dmgFx = this.effectsFor('damage', scopes);
		// The FLAT halves of both axes are already in the row (`computeAttacks` folds them where the
		// weapon is known), so picking them up here would count them twice — and it is why the row can
		// print the number the tap rolls. What only a roll can carry rides on: bonus dice and the
		// die manipulations, folded onto the PRIMARY part, as RAW adds them to the weapon's base damage.
		const parts: DamagePartSpec[] = at.damageParts.map((p, i) => ({
			dice: p.pool,
			mod: p.mod,
			type: p.type,
			...(i === 0 ? { bonusDice: dmgFx.bonusDice, mods: dieModsOf(dmgFx) } : {}),
		}));
		// asked AFTER the effects fold in, so a flat damage effect on a damage-less weapon still counts
		return { fx, parts, hasDmg: dealsDamage(parts) };
	}

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

	/**
	 * Savage Attacker: reroll the pending WEAPON damage and keep the higher, rewriting the log entry
	 * in place (truthful record) and spending the once-per-turn use.
	 *
	 * RAW rerolls the weapon's OWN dice, so the reroll goes out with the part's `bonusDice` and its
	 * flat modifier stripped: a Bless d4 riding the same part is not the weapon's die and keeps the
	 * face it rolled. The two candidates are then compared as weapon dice against weapon dice — the
	 * flat modifier is identical on both sides and would only flatten the difference — and the kept
	 * set is re-assembled with the effect dice that never moved.
	 *
	 * ponytail: a CRIT's twin of a Bless die carries `DIE_ROLE.crit`, so the split below counts it
	 * with the weapon's dice. Fixing it wants the twin to remember which role it doubled; nothing
	 * else needs that, and the case is a crit and an effect die and this feat at once.
	 */
	savageReroll = () => {
		const p = this.savagePending;
		const label = this.savageLabel;
		const entry = this.savagePendingEntry;
		if (!p || !label || !entry) return;
		const weaponOnly: DamagePartSpec = {
			dice: p.spec.dice,
			mod: 0,
			type: p.spec.type,
			...(p.spec.mods ? { mods: p.spec.mods } : {}),
			...(p.spec.crit ? { crit: p.spec.crit } : {}),
		};
		const rerolled = rollDamageParts([weaponOnly])[0];
		if (!rerolled) return;
		const isEffectDie = (d: RolledDie) => d.role === DIE_ROLE.bonus;
		const sum = (dice: RolledDie[]) => dice.reduce((n, d) => n + d.sign * d.value, 0);
		const effectDice = p.roll.dice.filter(isEffectDie);
		const wasWeapon = p.roll.dice.filter((d) => !isEffectDie(d));
		// the same part with one weapon set or the other, so both candidates are read the one way
		const partWith = (weapon: RolledDie[]): TypedRoll => {
			const part = { ...p.roll, dice: [...weapon, ...effectDice] };
			return { ...part, total: totalOf(part) };
		};
		const keptRe = sum(rerolled.dice) > sum(wasWeapon);
		const keep = partWith(keptRe ? rerolled.dice : wasWeapon);
		const dropped = partWith(keptRe ? wasWeapon : rerolled.dice);
		const revised: RollLogEntry = {
			...entry,
			damage: [keep, ...(entry.damage ?? []).slice(1)],
			// an amendment, not a note: overwriting `note` used to destroy whatever provenance the roll
			// already carried (an upcast's "8d6 base + 1d6 @ slot 4")
			amendments: [
				...(entry.amendments ?? []),
				{
					kind: AMENDMENT_KIND.damageReroll,
					source: label,
					from: dropped.total,
					to: keep.total,
				},
			],
		};
		this.host().journal.reviseEntry(entry, revised);
		this.savageUsedRound = this.host().round;
		this.savagePending = null;
		// re-toast the REVISED roll, not a summary line: the reroll changed the damage, so the player
		// should see the same card again with the kept dice in it
		toastRoll(revised);
	};
}
