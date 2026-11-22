/*
 * How effects leave play, as pure play-state changes: the states that end WITH another
 * (`ends_with`), the exhaustion an ending leaves (`exhaustion_on_end`), and the death at the top of
 * the exhaustion ladder. The actions (`effects.ts`) and the settle pass (`settle.ts`) both end
 * effects; this is the half they share, so neither imports the other.
 */
import {
	EXHAUSTION_MAX,
	type Character,
	type CharacterPlay,
	type DeathCause,
	type EffectInstance,
} from '$lib/character/schema';
import type { ContentGraph } from '$lib/content/loader';
import { conditionRow } from '$lib/content/states';
import { dropEffects } from './concentration';

/** The condition whose row states how tall the exhaustion ladder is. */
const EXHAUSTION_CONDITION_ID = 'exhaustion';

/** The catalog effect row an instance came from, if it came from one. */
export function effectRow(effect: EffectInstance, graph: ContentGraph) {
	const row = effect.source ? graph.get(effect.source) : undefined;
	return row?.type === 'effect' ? row : undefined;
}

/**
 * Record a death on the play-state. The first cause sticks: a character already dead is returned
 * untouched. Nothing is SAID of it — the hit-point block is what says a character died and of what,
 * and a notice on top of that was a stand-in for a block that could not.
 */
export const markDead = (play: CharacterPlay, cause: DeathCause): CharacterPlay =>
	play.death ? play : { ...play, death: { cause, exhaustion: play.exhaustion } };

/** How tall the exhaustion ladder is for this character's system: the condition row's own
 *  `max_level`, so a homebrew ladder of another height works. 0 = no such row is loaded. */
export function exhaustionLadder(character: Character, graph: ContentGraph): number {
	const row = conditionRow(graph, character.system, EXHAUSTION_CONDITION_ID);
	return row ? Number(row.data.max_level ?? 1) : 0;
}

/**
 * The exhaustion level, clamped to the ladder. The TOP of it is lethal — RAW "You die if your
 * Exhaustion level is 6" (2024 glossary; 2014's level-6 row is likewise "Death") — and the
 * threshold is the DATA cap, so a homebrew ladder kills at its own top.
 */
export function withExhaustion(
	character: Character,
	level: number,
	graph: ContentGraph,
): Character {
	// the data cap AND the schema's, because the two disagree above 20: a level the schema refuses
	// makes every later save fail, and the sheet keeps working as if nothing is wrong
	const max = Math.min(exhaustionLadder(character, graph), EXHAUSTION_MAX);
	const exhaustion = Math.max(0, Math.min(max, Math.round(level)));
	const play = { ...character.play, exhaustion };
	return { ...character, play: max > 0 && exhaustion >= max ? markDead(play, 'exhaustion') : play };
}

/** Take the chosen effects off, with every state that ends with one of them, and add the
 *  exhaustion their rows leave. The character is returned as given when nothing ends. */
export function withoutEffects(
	character: Character,
	shouldEnd: (effect: EffectInstance) => boolean,
	graph: ContentGraph,
): Character {
	const effects = character.play.effects;
	const removed = new Set(effects.filter(shouldEnd));
	if (!removed.size) return character;
	const rows = new Map(effects.map((effect) => [effect, effectRow(effect, graph)]));
	const ending = new Set<string>();
	for (const effect of removed) {
		const id = rows.get(effect)?.id;
		if (id) ending.add(id);
	}
	let expanded = true;
	while (expanded) {
		expanded = false;
		for (const effect of effects) {
			const row = rows.get(effect);
			if (!row?.data.ends_with || removed.has(effect) || !ending.has(row.data.ends_with)) continue;
			removed.add(effect);
			ending.add(row.id);
			expanded = true;
		}
	}
	const play = dropEffects(character.play, (effect) => removed.has(effect));
	const next = { ...character, play };
	const exhaustion = [...removed].reduce(
		(sum, effect) => sum + Math.max(0, rows.get(effect)?.data.exhaustion_on_end ?? 0),
		0,
	);
	return exhaustion ? withExhaustion(next, play.exhaustion + exhaustion, graph) : next;
}
