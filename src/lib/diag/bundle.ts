/*
 * The bug-report diagnostics bundle: a PII-free snapshot the user reviews and copies into a GitHub
 * issue. Pure + synchronous so it's trivially testable and can't leak — it is handed only the fields
 * it may include and derives a character summary that carries ids/classes/level/counts, NEVER the
 * name, notes, photo, or any free-text (docs/AUDIT.md DIAG-1 redaction rule).
 *
 * "Local-first, no auto-upload": this only formats text; sending is the user pasting it.
 */
import type { Character } from '$lib/character/schema';
import type { LogEntry } from './logger';
import { LogLevel } from './logger';

/** A redacted, shareable summary of the active character — build shape only, zero free-text. */
export interface CharacterSummary {
	id: string;
	system: string;
	classes: { class: string; level: number; subclass?: string }[];
	totalLevel: number;
	speciesRef?: string;
	backgroundRef?: string;
	counts: { feats: number; inventory: number; spells: number };
}

export interface DiagnosticsInput {
	appVersion: string;
	platform: string;
	activeSystem: string;
	activeLocale: string;
	character: Character | null;
	logTail: LogEntry[];
	/** Content-health signals, already computed elsewhere — counts only, no row contents. */
	contentIssues?: { issues: number; metaIssues: number; driftItems: number };
}

/** Reduce a character to build-shape identity only. Refs are already `source:id` (not user text);
 *  name/notes/photo/xp and all runtime play-state are deliberately dropped. */
export function summarizeCharacter(character: Character): CharacterSummary {
	const classes = character.build.classes.map((c) => ({
		class: c.class,
		level: c.level,
		...(c.subclass ? { subclass: c.subclass } : {})
	}));
	return {
		id: character.id,
		system: character.system,
		classes,
		totalLevel: classes.reduce((sum, c) => sum + c.level, 0),
		...(character.build.species ? { speciesRef: character.build.species } : {}),
		...(character.build.background ? { backgroundRef: character.build.background } : {}),
		counts: {
			feats: character.build.feats.length,
			inventory: character.build.inventory.length,
			spells: character.build.spells.length
		}
	};
}

/** The machine-readable bundle object. Serialize with `formatBundle` for the clipboard. */
export interface DiagnosticsBundle {
	generatedAt: string;
	appVersion: string;
	platform: string;
	activeSystem: string;
	activeLocale: string;
	character: CharacterSummary | null;
	contentIssues?: { issues: number; metaIssues: number; driftItems: number };
	log: { level: LogLevel; time: string; msg: string; ctx?: Record<string, unknown> }[];
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsBundle {
	return {
		generatedAt: new Date().toISOString(),
		appVersion: input.appVersion,
		platform: input.platform,
		activeSystem: input.activeSystem,
		activeLocale: input.activeLocale,
		character: input.character ? summarizeCharacter(input.character) : null,
		...(input.contentIssues ? { contentIssues: input.contentIssues } : {}),
		log: input.logTail.map((e) => ({
			level: e.level,
			time: new Date(e.ts).toISOString(),
			msg: e.msg,
			...(e.ctx ? { ctx: e.ctx } : {})
		}))
	};
}

/** Pretty JSON for the clipboard — fenced so it pastes cleanly into a GitHub issue body. */
export function formatBundle(bundle: DiagnosticsBundle): string {
	return '```json\n' + JSON.stringify(bundle, null, 2) + '\n```';
}
