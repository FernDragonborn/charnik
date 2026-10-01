/*
 * Concentration — which spell is held, and everything that ends it: the player's own ✕, a replacing
 * cast, 0 HP, incapacitation, a state that forbids it. One unit because every one of those ends at
 * the same two writes — the ref cleared and the spell's carrier effect taken down — and a path that
 * did one without the other leaves a buff standing with no spell behind it.
 *
 * The SAVE a hit asks for is not here: `HitPoints` owns the banner and the roll, and calls `clear`
 * when the save fails. ESTABLISHING concentration is not here either — that is the cast's own step
 * (`SpellCasting.cast`), which reads `cantConcentrate` and takes the prior spell's effect down.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { localizedName } from '$lib/content/detail';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

/** What concentration needs from the sheet around it. */
export interface ConcentrationHost {
	character: Character | null;
	graph: ContentGraph | null;
	sheet: CharacterSheet | null;
	economy: { incapacitated: boolean };
	dismissConcentrationSave(): void;
}

export class Concentration {
	constructor(private host: () => ConcentrationHost) {}

	/** The spell currently concentrated on (resolved to a display label), or null. Reads the schema's
	 *  `play.concentration` ref — set on cast, cleared by tapping the indicator. A getter, like every
	 *  read through the host thunk (`combat-view-model` ▸ header). */
	get conc(): { ref: string; label: string } | null {
		const { character, graph } = this.host();
		const ref = character?.play.concentration;
		if (!ref) return null;
		const row = graph?.get(ref);
		return { ref, label: row ? localizedName(row, app.activeLocale) : ref };
	}

	/** A state forbids Concentration — a `blocks_concentration` marker is live on the sheet (RAW Rage:
	 *  "you can't maintain Concentration"). DATA-DRIVEN (the token, authored on the Rage condition), not a
	 *  hardcoded id, so any homebrew state carrying the marker behaves the same. */
	get cantConcentrate(): boolean {
		return this.host().sheet?.facts.breaksConcentration ?? false;
	}

	/** Remove the cast-applied effect linked to a spell ref (`source === ref`) — dropping or
	 *  replacing concentration takes the spell's own buff down with it. */
	removeLinkedEffect = (ref: string) => {
		const c = this.host().character;
		if (c) c.play.effects = c.play.effects.filter((e) => e.source !== ref);
	};

	/** The player ENDING it on purpose — the chip's ✕ and the Effects panel's badge. It says so,
	 *  because all that happens on screen is a chip disappearing, and the press one step above the ✕
	 *  is a save: a spell dropped deliberately and a spell lost to a bad roll must not look alike.
	 *  `clear` stays the silent primitive every other path uses (0 HP, a replacing cast, a rest) —
	 *  those are consequences of something the player already saw. */
	endByHand = () => {
		const label = this.conc?.label;
		this.clear();
		if (label) toast(t('combat.notice.concentrationEnded', { spell: label }));
	};

	/** Stop concentrating — the state change alone, with nothing said about it. */
	clear = () => {
		const c = this.host().character;
		if (!c) return;
		if (c.play.concentration) this.removeLinkedEffect(c.play.concentration);
		c.play.concentration = null;
		this.host().dismissConcentrationSave(); // no spell → no owed save
	};

	/** RAW: dropping to 0 HP, becoming incapacitated, OR gaining a `blocks_concentration` state (Rage)
	 *  ENDS concentration. Called reactively from the combat page so it fires the instant HP hits 0
	 *  (Damage), an incapacitating condition lands, or Rage is entered. Idempotent — a no-op once
	 *  concentration is already gone. */
	endIfBroken = () => {
		const { character, economy } = this.host();
		if (!character?.play.concentration) return;
		if (character.play.hp.current <= 0 || economy.incapacitated || this.cantConcentrate)
			this.clear();
	};
}
