/*
 * Hit points and how a character dies: damage (defenses → temp HP → current), healing, temp HP, the
 * concentration-save banner damage raises, the death-save track, and the three lethal rules.
 *
 * These are one unit because they are one rule chain — damage decides instant death, opens the
 * concentration check and drops you to 0, and the death-save track is what 0 HP leads to. Splitting
 * them would put the branches of a single RAW sequence in different files.
 *
 * `hpMax` is the EFFECTIVE max, so it stays the answer to "how much HP" for everything above:
 * the view-model re-exposes it (A14 — a manual max still has `hp_max` effects folded onto it), and
 * the action executor and the short rest read it from there rather than recomputing.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { naturalOf, rollPool } from '$lib/rules/dice';
import { applyDamageSensitivity, netAdvantage, DEATH_CAUSE_LABEL } from '$lib/combat/helpers';
import { effectiveHpMax } from '$lib/rules/core';
import type { Character, DeathCause } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { RollJournal } from './roll-journal.svelte';
import type { SheetRolls } from './sheet-rolls.svelte';
import type { OpenOverlay } from './menu-overlay.svelte';

/** What the HP rules need from the sheet around them. */
export interface HitPointsHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	journal: RollJournal;
	rolls: SheetRolls;
	overlay: OpenOverlay | null;
	/** Stop concentrating — a failed save's confirmed Drop takes the spell's own effect down with it. */
	clearConcentration(): void;
}

export class HitPoints {
	constructor(private host: () => HitPointsHost) {}

	/** The temp-HP popover's amount (two-way bound in the markup through the view-model). */
	tempHpInput = $state(5);
	setTempHp = () => {
		const c = this.host().character;
		if (c) c.play.hp.temp = Math.max(0, this.tempHpInput);
		this.host().overlay = null;
	};

	// --- HP: apply damage / healing to the play-state (temp HP soaks damage first) -------------
	hpAmount = $state(1);
	/** B4 concentration-save banner: a CON save the player owes after taking damage while concentrating.
	 *  `dc` is the suggested-but-editable DC; `failed` is set once a rolled save misses (the banner then
	 *  offers Drop). Null = no check due. Set in `damage()`, cleared on a passed roll / drop / when the
	 *  concentration it names ends or is replaced.
	 *
	 *  `spell` is WHICH concentration it is owed for: an owed save is a fact about one spell, and
	 *  without the name the banner re-attached itself to whatever was concentrated on next — offering
	 *  "Drop" for a spell that had never been rolled for. */
	pendingConcentrationSave = $state<{ dc: number; failed?: boolean; spell: string } | null>(null);
	/** The CON saving-throw bonus a concentration save rolls (d20 + this); already folds save.con flat
	 *  effects, so the roll must NOT re-add `fx.flat` (roll.ts: saves are pre-folded into the sheet). */
	get concentrationSaveMod(): number {
		return this.host().sheet?.abilities.con.save.value ?? 0;
	}
	/** Selected damage type for the next Damage press (B20). Null = untyped (no resist/vuln math). */
	damageType = $state<string | null>(null);
	get hpMax(): number {
		const { character, sheet } = this.host();
		if (!sheet) return character?.play.hp.max ?? 0;
		// A14: a manual max no longer silences hp_max effects — they re-fold on top of it.
		return effectiveHpMax(character?.play.hp.max ?? null, sheet.maxHp);
	}
	/** A14: pull play HP current down to the live effective max — call reactively so an expired
	 *  hp_max effect (Aid) or a dropped manual max reduces current. Idempotent (no-op once
	 *  current ≤ max), so it can't loop the autosave debounce. */
	clampCurrentHp = () => {
		const p = this.host().character?.play;
		if (p && p.hp.current > this.hpMax) p.hp.current = this.hpMax;
	};
	/** The damage types the character has ANY defense for — the only ones worth offering in the
	 *  type picker (any other type resolves identically to untyped). Empty → no picker shown. */
	get damageTypeOptions(): string[] {
		const d = this.host().sheet?.damageSensitivities;
		if (!d) return [];
		return [...new Set([...d.resist, ...d.immune, ...d.vulnerable])].sort();
	}
	/** Was the hit that is being entered a CRITICAL? Only asked at 0 HP, where it is the difference
	 *  between one death-save failure and two — the Damage button has no attack behind it to read
	 *  crit-ness from, and one checkbox beats inferring it wrong. Default off, off again after each
	 *  hit, and off as soon as HP leave 0 (`syncDyingState`) — its control only renders at
	 *  0 HP, so a flag that outlived that is a flag nobody can see or unset. */
	damageWasCrit = $state(false);

	/** You are no longer dying: the death-save track resets and the crit answer goes with it. RAW,
	 *  both editions — "The number of both is reset to zero when you regain any hit points or become
	 *  stable" — so every way out of dying calls this rather than restating it. */
	private stopDying(play: Character['play']): void {
		play.deathSaves = { successes: 0, failures: 0 };
		this.damageWasCrit = false;
	}

	/**
	 * Above 0 hit points nothing about dying is true, so neither the death-save track nor the "was it
	 * a critical?" answer may survive there. RAW is the reset clause — "when you regain any hit
	 * points" — and this is where it is enforced, rather than at each of the several ways HP goes up
	 * (a heal, a long rest, the number field the player types into): the ones that RESTORE hit points
	 * are open-ended, the state that depends on them is one. The crit answer rides along because its
	 * checkbox only renders at 0 HP, so a tick nobody spent on a hit would sit invisible and cost two
	 * failures on some later ordinary one.
	 *
	 * A DEAD character is left alone — one can die at full hit points (exhaustion), and their track is
	 * a record. Reactive + idempotent, like `clampCurrentHp` beside it.
	 */
	syncDyingState = () => {
		const p = this.host().character?.play;
		if (!p || p.death || p.hp.current <= 0) return;
		if (p.deathSaves.successes || p.deathSaves.failures || this.damageWasCrit) this.stopDying(p);
	};

	/**
	 * The owed save belongs to the concentration it names, so it dies when that concentration does —
	 * whichever of the several writers of `play.concentration` did it (the next spell replacing it, a
	 * long rest, an expiring carrier). Matching by NAME rather than by "is anything concentrated on"
	 * is what covers the replacement case. Reactive + idempotent, like `syncDyingState` beside it.
	 */
	syncPendingConcentration = () => {
		const pend = this.pendingConcentrationSave;
		if (pend && pend.spell !== this.host().character?.play.concentration)
			this.pendingConcentrationSave = null;
	};

	damage = () => {
		const p = this.host().character?.play;
		if (!p) return;
		const raw = Math.max(0, Math.round(this.hpAmount));
		// B20: resist/immune/vulnerable modify the damage BEFORE temp HP soaks it (RAW ordering).
		const defenses = this.host().sheet?.damageSensitivities ?? {
			resist: [],
			immune: [],
			vulnerable: [],
		};
		const taken = applyDamageSensitivity(raw, this.damageType, defenses).final;
		let n = taken;
		const soaked = Math.min(p.hp.temp, n); // temp HP absorbs first (5e rule)
		p.hp.temp -= soaked;
		n -= soaked;
		const before = p.hp.current;
		p.hp.current = Math.max(0, before - n);
		// INSTANT DEATH (SRD 5.1 "Instant Death", verified): damage reduces you to 0 AND the damage
		// REMAINING equals/exceeds your hit-point MAXIMUM (the FULL max, not half) → you die outright,
		// no death saves. The same threshold also covers "Damage at 0 Hit Points" (already at 0 → the
		// leftover is the whole hit). The 2024 SRD 5.2.1 omits the "Playing the Game" chapter that
		// carries this rule (it only cross-references it), so both editions run the 5.1 text — the 2024
		// PHB keeps the same threshold. docs/internals/rules-core.md ▸ RAW, RAI, and saying which
		if (p.hp.current === 0 && n - before >= this.hpMax) this.die('massive_damage');
		// RAW, both editions: damage taken while ALREADY at 0 HP is a death-save failure — two if the
		// hit was a critical. Unconditional in the book, so it is applied rather than offered; the
		// count stays hand-editable like every other pip. `taken`, not `n`: the text says "any damage",
		// and temp HP soaking it does not un-hit a dying body.
		if (before === 0 && taken > 0 && !p.death) {
			const failures = this.damageWasCrit ? 2 : 1;
			p.deathSaves.failures = Math.min(3, p.deathSaves.failures + failures);
			toast(t('combat.notice.deathFailureFromDamage', { count: failures }));
			if (p.deathSaves.failures >= 3) this.die('death_saves');
		}
		// crit-ness belongs to ONE hit, never to the next one — and cleared OUTSIDE the branch above,
		// because its checkbox only renders at 0 HP: ticked and then healed instead of hit, the flag
		// went invisible while staying set, and cost two failures on some later ordinary hit.
		this.damageWasCrit = false;
		// B4: taking damage while concentrating opens the "check due" banner — a CON save at DC
		// max(10, ⌊dmg/2⌋), capped 30 in 2024 (RAW). Suggested-but-editable DC, PLAYER-rolled, never an
		// auto-drop (play-tracker surfaces, never forces). 0 HP already ends it via endConcentrationIfBroken.
		if (taken > 0 && p.concentration && p.hp.current > 0) {
			const cap = this.host().character?.system === '5.5e' ? 30 : Number.POSITIVE_INFINITY;
			this.pendingConcentrationSave = {
				dc: Math.min(cap, Math.max(10, Math.floor(taken / 2))),
				spell: p.concentration,
			};
		}
	};
	/** Heal by the entered amount. Leaving 0 HP clears the death-save track, but that is not written
	 *  here — `syncDyingState` owns it for every way hit points come back. */
	heal = () => {
		const p = this.host().character?.play;
		if (!p) return;
		p.hp.current = Math.min(this.hpMax, p.hp.current + Math.max(0, Math.round(this.hpAmount)));
	};

	/** Roll the owed concentration save (B4 banner). Instant + auto-applied like a death save — the tray
	 *  has no result callback, and save.con effects (Bless bonus dice, War Caster advantage) already fold
	 *  through `effectsFor`. `mod` is the sheet CON-save value (flat effects pre-folded → do NOT add
	 *  `fx.flat`, roll.ts). Pass → the check clears. Fail → RAW the spell ends, but we mark the banner
	 *  `failed` and OFFER Drop rather than auto-dropping (surface, never force). */
	rollConcentrationSave = () => {
		const pend = this.pendingConcentrationSave;
		if (!pend || pend.failed || !this.host().character?.play.concentration) return;
		const fx = this.host().rolls.effectsFor('save.con');
		const r = rollPool(
			{ 20: 1 },
			{
				...fx,
				mod: this.concentrationSaveMod,
				advantage: netAdvantage(fx),
			},
		);
		this.host().journal.pushRoll(
			{ text: 'Concentration save', key: 'combat.roll.concentration' },
			r,
		);
		if (r.total >= pend.dc) {
			toast(t('combat.notice.concentrationHeld', { total: r.total, dc: pend.dc }));
			this.pendingConcentrationSave = null;
		} else {
			toast(t('combat.notice.concentrationFailed', { total: r.total, dc: pend.dc }), {
				description: t('combat.notice.concentrationFailedBody'),
			});
			this.pendingConcentrationSave = { ...pend, failed: true };
		}
	};
	/** The B4 banner's "Drop spell" — deliberately END concentration (either instead of rolling, or to
	 *  confirm the RAW consequence of a failed save). Ends the spell AND dismisses the banner. */
	dropConcentrationFromSave = () => {
		this.host().clearConcentration();
		this.pendingConcentrationSave = null;
	};
	/** The B4 banner's ✕ — dismiss the reminder WITHOUT ending concentration. Unlike Drop, the spell
	 *  keeps going: the player is waving off the check (they'll roll physically, have a feature that
	 *  ignores it, or just don't care). Surface, never force — a reminder must be dismissable. */
	dismissConcentrationSave = () => {
		this.pendingConcentrationSave = null;
	};

	/** Roll a death save (shown while at 0 HP): a d20 vs 10 — `save.death`-targeted effects (and
	 *  the `saves`/`d20_tests` groups: Bless, exhaustion) apply. Outcomes per RAW: nat 20 → back up
	 *  at 1 HP; nat 1 → two failures; 10+ → success; three successes → stable (counters reset). */
	deathSave = () => {
		const c = this.host().character;
		if (!c) return;
		const fx = this.host().rolls.effectsFor('save.death');
		// SMELL-6: always roll instantly + auto-apply the outcome. Unlike other rolls, a death save
		// MUTATES play-state (pips / nat20→1 HP), and the tray contract has no result callback — a tray
		// roll couldn't apply it. A death save is a fixed d20-vs-10 with nothing to customize
		// (advantage/effects already fold via `fx`), so there's no reason to offer the tray here.
		const r = rollPool({ 20: 1 }, { ...fx, mod: fx.flat, advantage: netAdvantage(fx) });
		this.host().journal.pushRoll({ text: 'Death save', key: 'combat.roll.deathSave' }, r);
		const ds = c.play.deathSaves;
		const natural = naturalOf(r);
		if (natural === 20) {
			c.play.hp.current = 1;
			this.stopDying(c.play);
			toast(t('combat.notice.nat20Revive'));
		} else if (natural === 1) {
			ds.failures = Math.min(3, ds.failures + 2);
			toast(t('combat.notice.nat1Failures'));
		} else if (r.total >= 10) {
			ds.successes = Math.min(3, ds.successes + 1);
			if (ds.successes >= 3) {
				this.stopDying(c.play);
				toast(t('combat.notice.stabilised'));
			}
		} else {
			ds.failures = Math.min(3, ds.failures + 1);
		}
		// "On your third failure, you die" — checked once, after every branch, so a natural 1's DOUBLE
		// failure is as lethal as a third single one (it wasn't, before).
		if (c.play.deathSaves.failures >= 3) this.die('death_saves');
	};

	/** Manually set a death-save track (players track by hand too): clicking pip `index` fills to it,
	 *  or clears it when it's already the last filled one. `kind` is 'successes' | 'failures'. */
	toggleDeathSave = (kind: 'successes' | 'failures', index: number) => {
		const play = this.host().character?.play;
		const ds = play?.deathSaves;
		if (!play || !ds) return;
		ds[kind] = ds[kind] === index + 1 ? index : index + 1;
		if (kind === 'failures' && ds.failures >= 3) this.die('death_saves');
		// the track filled by hand means what the rolled one means: three successes and you are stable,
		// so the counters reset (RAW) instead of sitting at 3/0 for ever
		if (kind === 'successes' && ds.successes >= 3) {
			this.stopDying(play);
			toast(t('combat.notice.stabilised'));
		}
	};

	/** Record a death. The three lethal rules (massive damage · three death-save failures · the top of
	 *  the exhaustion ladder) all land HERE, so "what happens when you die" is one place. Idempotent —
	 *  the first cause sticks, so re-entering the same state doesn't re-toast. Death is AUTOMATIC in
	 *  RAW (no "you can"), so like the initiative regain it auto-applies and NOTIFIES; the player still
	 *  owns the way back (`revive`). */
	die = (cause: DeathCause) => {
		const p = this.host().character?.play;
		if (!p || p.death) return;
		p.death = { cause };
		toast(t('combat.notice.died'), { description: t(DEATH_CAUSE_LABEL[cause]) });
	};
	/** "I was revived" — the way back from the dead screen. RAW leaves the HP to the revival effect, so
	 *  we apply the Revivify FLOOR (at least 1 HP, never taking hit points away — a character who died
	 *  of Exhaustion at full HP keeps them) and clear the death-save track (it resets on regaining HP).
	 *  Exhaustion drops by one, per the 2024 glossary ("If the creature died with any Exhaustion levels,
	 *  it returns with 1 fewer level") — applied in BOTH editions because reviving straight back onto a
	 *  lethal exhaustion 6 would kill you again on the spot; RAW is silent in 2014, so RAI wins
	 *  (docs/internals/rules-core.md ▸ RAW, RAI, and saying which). Everything else (conditions, curses) survives death per RAW. */
	revive = () => {
		const p = this.host().character?.play;
		if (!p) return;
		p.death = null;
		this.stopDying(p);
		p.exhaustion = Math.max(0, p.exhaustion - 1);
		p.hp = { ...p.hp, current: Math.max(1, p.hp.current) };
		toast(t('combat.notice.revived'));
	};

	get hpBar(): { cur: number; tmp: number } {
		const c = this.host().character;
		const sheet = this.host().sheet;
		if (!c || !sheet) return { cur: 0, tmp: 0 };
		// `|| 1` guards a 0 max (unset HP) so the bar math can't divide → NaN/Infinity (D19)
		// A14: effectiveHpMax so a manual max still stacks hp_max effects (Aid) on top.
		const max = effectiveHpMax(c.play.hp.max ?? null, sheet.maxHp) || 1;
		return {
			cur: Math.max(0, Math.min(100, (c.play.hp.current / max) * 100)),
			tmp: (c.play.hp.temp / max) * 100,
		};
	}
}
