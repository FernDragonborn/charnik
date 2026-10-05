/*
 * Experience points on the play sheet: whether this character counts them, how many they have, and
 * what level that total has earned.
 *
 * XP is OPTIONAL in play — a table that levels by milestone never looks at it — so it is a
 * per-character switch (`ui.levelingMode`) and the counter appears only where it is on. Earning a
 * level never TAKES it: a level-up asks questions (a class, hit points, a feat) that only the builder
 * can take answers to, so the sheet says the level is earned and the player levels up as always.
 *
 * The thresholds are the pack's `advancement` rows, in the character's own edition
 * (`rules/advancement.ts`). A pack that ships none leaves the counter without a goal rather than
 * giving it another edition's.
 */
import type { Character, LevelingMode } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { isRowActive } from '$lib/content/sources.svelte';
import { levelEarned, xpToReach, type LevelThreshold } from '$lib/rules/advancement';
import { gainExperience } from '$lib/play/experience';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';

/** What the XP counter needs from the sheet around it. */
export interface ExperienceHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	graph: ContentGraph | null;
	overlay: unknown;
	/** Carry out a play-state action on the open character; false when it was refused. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): boolean;
}

/** Where a character stands: what they have, the level it has earned, and what the next one takes. */
export interface ExperienceProgress {
	xp: number;
	/** The level this total has earned, when the edition's table can say. */
	earned: number | undefined;
	/** The XP total the level after the character's own takes — undefined at the top of the table. */
	next: number | undefined;
	/** Has the total earned a level the character has not taken yet? */
	levelDue: boolean;
}

export class Experience {
	constructor(private host: () => ExperienceHost) {}

	/** The amount typed into the popover, to be added. */
	gain = $state(100);

	get mode(): LevelingMode {
		return this.host().character?.ui.levelingMode ?? 'milestone';
	}
	setMode = (mode: LevelingMode): void => {
		const c = this.host().character;
		if (c) c.ui.levelingMode = mode;
	};

	/** The advancement table of the character's edition, by level. */
	private get table(): LevelThreshold[] {
		const { character, graph } = this.host();
		if (!character || !graph) return [];
		return graph
			.list('advancement', { system: character.system })
			.filter((row) => isRowActive(row))
			.map((row) => ({ level: row.data.level, xp: row.data.xp }));
	}

	/** Null while XP is not counted, so a caller renders nothing rather than a zero. */
	get progress(): ExperienceProgress | null {
		const { character, sheet } = this.host();
		if (!character || !sheet || this.mode !== 'xp') return null;
		const xp = character.play.xp;
		const earned = levelEarned(this.table, xp);
		return {
			xp,
			earned,
			next: xpToReach(this.table, sheet.level + 1),
			levelDue: earned !== undefined && earned > sheet.level,
		};
	}

	/** Add the typed amount (a negative one takes XP away — a correction, or a card that says so).
	 *  The total never goes below zero. */
	add = (): void => {
		this.host().act((c) => gainExperience(c, { amount: this.gain }));
		this.host().overlay = null;
	};
}
