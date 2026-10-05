/*
 * What a play-state action is handed and what it hands back.
 *
 * An action is a pure function: it takes the character and the intent, returns the character that
 * results, and touches nothing else. So what it would have DONE to the world around it — a line in
 * the roll log, a notice — comes back as data for the caller to carry out, and a caller with no
 * screen (a node test, an input that is not a click) gets the same character the sheet does.
 */
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import type { Rng, Rolled } from '$lib/rules/dice';
import type { RollName } from '$lib/combat/roll';
import type { SaidText } from '$lib/util/say';

/** What an action reads besides the character. */
export interface PlayContext {
	/**
	 * The sheet of a character as it stands. A function rather than a value because an action can
	 * change what the sheet says in the middle of itself: a hit that breaks a form is finished against
	 * the character's own hit-point maximum, not the form's.
	 */
	derive(character: Character): CharacterSheet;
	/** The loaded content, for a rule that is a row's own column (the height of the exhaustion
	 *  ladder) rather than something the sheet already states. */
	graph: ContentGraph;
	/** The dice. Seeded in a test; the host's own otherwise. */
	rng?: Rng;
}

/** One line for the roll log: a marker, or a roll when the action made one. */
export interface PlayLogLine {
	name: RollName;
	rolled?: Rolled;
}

/** Something to tell the player. `rows` are content refs the sentence names — the value of that
 *  name is the row's own name in the reader's language, which only the caller has. */
export interface PlayNotice {
	text: SaidText;
	description?: SaidText;
	rows?: Record<string, string>;
}

/** A concentration save a hit has made due: the DC, and the spell it is owed for. */
export interface OwedConcentrationSave {
	dc: number;
	spell: string;
}

export interface PlayOutcome {
	character: Character;
	/** In the order they happened. */
	log: PlayLogLine[];
	notices: PlayNotice[];
	/** Present when the action left a concentration save owed. It is not play-state: it does not
	 *  survive a reload, and the player may wave it off. */
	concentrationSave?: OwedConcentrationSave;
}

/** An outcome that says nothing beyond the character. */
export const quietly = (character: Character): PlayOutcome => ({
	character,
	log: [],
	notices: [],
});

/**
 * Write an action's result into the character object the sheet is holding.
 *
 * In place, because that object is the reactive one: every panel reads it, and replacing it would
 * re-derive and re-render the whole sheet for a change of three hit points. An action shares what it
 * did not change, so assigning each section back writes only the ones that moved.
 */
export function adoptCharacter(held: Character, next: Character): void {
	if (next === held) return;
	Object.assign(held.play, next.play);
	Object.assign(held, { ...next, play: held.play });
}
