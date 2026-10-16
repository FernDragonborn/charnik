/*
 * Carrying a play-state action out on the open character.
 *
 * An action is pure (`$lib/play`): it returns the character that results, the lines for the roll
 * log and the notices. This is the one place that result reaches the world — the character the
 * panels hold, the log, the toasts — so every action lands the same way whichever control built it.
 */
import { toast } from '$lib/toast/toast';
import { translator } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { say, type Said } from '$lib/util/say';
import { LOG_KIND } from '$lib/character/log-kind';
import { playChanges } from '$lib/play/changes';
import { resourceName } from '$lib/play/resources';
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
import type { LogEvent } from '$lib/combat/roll';

/** What carrying an outcome out needs from the sheet around it. */
export interface PlayOutcomesHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	graph: ContentGraph | null;
	journal: RollJournal;
	hp: { owe(save: OwedConcentrationSave): void; keepOwedFor(spell: string | null): void };
}

/** What stands between the sentences of one notice. */
const SENTENCE_SEPARATOR = ' · ';

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
		const { hp, journal, sheet, graph } = this.host();
		// shallow is enough: an action replaces what it changes and never edits what it was handed
		const before = { ...held.play };
		adoptCharacter(held, outcome.character);
		const events: LogEvent[] = [];
		for (const { name, rolled, quiet, kind } of outcome.log)
			if (!rolled) events.push({ name, ...(kind ? { kind } : {}) });
			else if (quiet) journal.logRoll(name, rolled);
			else journal.pushRoll(name, rolled);
		const said = [...outcome.log, ...outcome.notices].map((l) => l.kind ?? LOG_KIND.notice);
		const nameOf = (ref: string) => {
			const row = graph?.get(ref);
			return row ? localizedName(row, app.activeLocale) : ref;
		};
		events.push(
			...playChanges(
				before,
				outcome.character.play,
				{ resource: (id) => (sheet ? resourceName(sheet, id) : id), spell: nameOf },
				said,
			),
		);
		events.push(...outcome.notices.map((notice) => this.announce(notice)));
		journal.logEvents(events);
		if (outcome.concentrationSave) hp.owe(outcome.concentrationSave);
		// an owed save belongs to the concentration it names, and goes when that one ends or is
		// replaced — whichever writer of `play.concentration` did it
		hp.keepOwedFor(held.play.concentration);
	}

	/**
	 * Tell the player something about their character, and keep it in the log: the toast is gone in
	 * seconds, and the log is where a past turn is read again. One sentence for both, so the two
	 * cannot disagree. For what an action said, and for what a view refused or noticed on the
	 * character's behalf — never for news about the app itself.
	 */
	notify = (notice: PlayNotice): void => this.host().journal.logEvents([this.announce(notice)]);

	/** Say a notice in the reader's language, naming the content rows it points at, and hand back
	 *  its log line. The names are resolved now: a row's name is data, which no catalog holds. */
	private announce(notice: PlayNotice): LogEvent {
		const graph = this.host().graph;
		const names = Object.fromEntries(
			Object.entries(notice.rows ?? {}).map(([name, ref]) => {
				const row = graph?.get(ref);
				return [name, row ? localizedName(row, app.activeLocale) : ref];
			}),
		);
		const named = (text: Said): Said =>
			typeof text === 'string' ? text : { ...text, values: { ...text.values, ...names } };
		const text = named(notice.text);
		const description = [notice.description ?? []].flat().map(named);
		const translate = translator();
		const spoken = description.map((part) => say(part, translate)).join(SENTENCE_SEPARATOR);
		toast(say(text, translate), spoken ? { description: spoken } : {});
		return {
			name:
				typeof text === 'string'
					? { text }
					: {
							text: text.fallback ?? text.key,
							key: text.key,
							...(text.values ? { values: text.values } : {}),
						},
			kind: notice.kind ?? LOG_KIND.notice,
			...(description.length ? { noteParts: description } : {}),
		};
	}
}
