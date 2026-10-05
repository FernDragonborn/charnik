/*
 * Carrying a play-state action out on the open character.
 *
 * An action is pure (`$lib/play`): it returns the character that results, the lines for the roll
 * log and the notices. This is the one place that result reaches the world — the character the
 * panels hold, the log, the toasts — so every action lands the same way whichever control built it.
 */
import { toast } from 'svelte-sonner';
import { translator } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { sayText, type Said } from '$lib/util/say';
import { localizedName } from '$lib/content/detail';
import { isRowActive } from '$lib/content/sources.svelte';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import { deriveSheet, type CharacterSheet } from '$lib/character/derive';
import { settlePlay } from '$lib/play/settle';
import {
	adoptCharacter,
	type OwedConcentrationSave,
	type PlayContext,
	type PlayNotice,
	type PlayOutcome,
} from '$lib/play/outcome';
import type { RollJournal } from './roll-journal.svelte';

/** What carrying an outcome out needs from the sheet around it. */
export interface PlayOutcomesHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	graph: ContentGraph | null;
	journal: RollJournal;
	hp: { pendingConcentrationSave: OwedConcentrationSave | null; dyingStopped(): void };
}

/** What stands between the sentences of one notice. */
const SENTENCE_SEPARATOR = ' · ';

/** Is the death-save track holding anything? */
const tracksDeathSaves = (character: Character): boolean =>
	character.play.deathSaves.successes > 0 || character.play.deathSaves.failures > 0;

export class PlayOutcomes {
	constructor(private host: () => PlayOutcomesHost) {}

	/** What an action reads besides the character: the sheet the screen is already showing for the
	 *  open character, and a fresh one for any other state the action asks about. */
	private context(graph: ContentGraph): PlayContext {
		return {
			derive: (character) => {
				const { character: held, sheet } = this.host();
				return character === held && sheet ? sheet : deriveSheet(character, graph, isRowActive);
			},
			graph,
			locale: app.activeLocale,
		};
	}

	/** Carry out a play-state action on the open character, and hand back what came of it — for a
	 *  caller that has the outcome's `asks` to answer. Null when there is no sheet to act on. */
	enact = (action: (character: Character, ctx: PlayContext) => PlayOutcome): PlayOutcome | null => {
		const { character, sheet, graph } = this.host();
		if (!character || !sheet || !graph) return null;
		const outcome = action(character, this.context(graph));
		this.commit(character, outcome);
		return outcome;
	};

	/** Carry out a play-state action on the open character. False when it was refused, or there is
	 *  no sheet to carry it out on. */
	act = (action: (character: Character, ctx: PlayContext) => PlayOutcome): boolean => {
		const outcome = this.enact(action);
		return !!outcome && !outcome.refused;
	};

	/**
	 * Ask the rules that follow a change again, with no action behind it. An action settles itself;
	 * this is for a sheet that changed under an untouched character — content reloaded, a source
	 * switched — and it is what the combat page runs reactively.
	 */
	settle = (): void => {
		const { character, sheet, graph } = this.host();
		if (character && sheet && graph)
			this.commit(character, settlePlay(character, this.context(graph)));
	};

	private commit(held: Character, outcome: PlayOutcome): void {
		const { hp, journal } = this.host();
		const wasTracking = tracksDeathSaves(held);
		adoptCharacter(held, outcome.character);
		if (held.play.hp.current > 0 || (wasTracking && !tracksDeathSaves(held))) hp.dyingStopped();
		for (const { name, rolled } of outcome.log)
			if (rolled) journal.pushRoll(name, rolled);
			else journal.logMarker(name);
		for (const notice of outcome.notices) this.announce(notice);
		if (outcome.concentrationSave) hp.pendingConcentrationSave = outcome.concentrationSave;
		// an owed save belongs to the concentration it names, and goes when that one ends or is
		// replaced — whichever writer of `play.concentration` did it
		const owed = hp.pendingConcentrationSave;
		if (owed && owed.spell !== held.play.concentration) hp.pendingConcentrationSave = null;
	}

	/** Say a notice in the reader's language, naming the content rows it points at. */
	private announce(notice: PlayNotice): void {
		const translate = translator();
		const graph = this.host().graph;
		const names = Object.fromEntries(
			Object.entries(notice.rows ?? {}).map(([name, ref]) => {
				const row = graph?.get(ref);
				return [name, row ? localizedName(row, app.activeLocale) : ref];
			}),
		);
		const said = (text: Said) =>
			typeof text === 'string'
				? text
				: sayText({ ...text, values: { ...text.values, ...names } }, translate);
		const description = [notice.description ?? []].flat().map(said).join(SENTENCE_SEPARATOR);
		toast(said(notice.text), description ? { description } : {});
	}
}
