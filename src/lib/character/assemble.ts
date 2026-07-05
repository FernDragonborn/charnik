/*
 * The single place a build draft is wrapped into a validated Character. The Build VM resolves its
 * reactive draft into a plain `build` object (refs, scores, skills…) and hands it here; this fn owns
 * the character envelope (schemaVersion, id, system, play, ui) and the last-resort fallback so a
 * live preview never crashes on a half-finished build. Pure + unit-testable — no Svelte, no graph.
 */
import { CHARACTER_SCHEMA_VERSION } from '../schema/version';
import { characterSchema, type Character, type CharacterPlay, type CharacterUi } from './schema';
import type { SystemId } from '../stores/app.svelte';

/** The character-envelope fields that wrap an assembled build. */
export interface AssembleWrapper {
	/** Final id: the edited character's id when levelling up, else a slug of the name. */
	id: string;
	system: SystemId;
	/** Free/Strict authoring mode — folded into `ui.strict`. */
	strict: boolean;
	/** Existing play-state to preserve when editing (null = a fresh, blank play-state). */
	play: CharacterPlay | null;
	/** Existing ui prefs to preserve when editing (null = none). */
	ui: Partial<CharacterUi> | null;
}

/** A resolved build object (loose — validated here). Name + abilities are always present so the
 *  fallback below can rely on them. */
type BuildInput = { name: string; abilities: Record<string, number>; [k: string]: unknown };

/**
 * Validate an assembled build into a Character. On failure, fall back to a minimal valid character
 * (name + abilities only) so the builder's live preview keeps rendering while choices are incomplete.
 */
export function assembleCharacter(build: BuildInput, w: AssembleWrapper): Character {
	const res = characterSchema.safeParse({
		schemaVersion: CHARACTER_SCHEMA_VERSION,
		id: w.id,
		system: w.system,
		build,
		// editing keeps the original play-state; creating starts blank
		play: w.play ?? { hp: { current: 0, temp: 0 } },
		// persist the Free/Strict choice per character (keep any other ui prefs like panelColumns)
		ui: { ...(w.ui ?? {}), strict: w.strict }
	});
	if (res.success) return res.data;
	// last-resort: a bare valid character so the preview never crashes
	return characterSchema.parse({
		schemaVersion: CHARACTER_SCHEMA_VERSION,
		id: w.id,
		system: w.system,
		build: { name: build.name, abilities: build.abilities },
		play: { hp: { current: 0, temp: 0 } },
		ui: {}
	});
}
