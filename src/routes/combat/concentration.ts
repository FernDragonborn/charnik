/*
 * Concentration on the sheet — which spell is held, and the player ending it. Ending is two writes,
 * the ref cleared and the spell's carrier effect taken down, and both are `$lib/play/concentration`;
 * what ends it without being asked (0 HP, incapacitation, a state that forbids it) is
 * `$lib/play/settle`.
 *
 * The SAVE a hit asks for is not here — `HitPoints` owns the banner — and ESTABLISHING
 * concentration is the cast's own step (`$lib/play/cast`).
 */
import { toast } from '$lib/toast/toast';
import { t } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { localizedName } from '$lib/content/detail';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { stopConcentrating } from '$lib/play/effects';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';

/** What concentration needs from the sheet around it. */
export interface ConcentrationHost {
	character: Character | null;
	graph: ContentGraph | null;
	sheet: CharacterSheet | null;
	/** Carry out a play-state action on the open character. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): void;
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
	clear = () => this.host().act(stopConcentrating);
}
