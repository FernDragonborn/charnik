/*
 * The effects and conditions on a character, as actions: putting one on, taking one off, its round
 * timer, the concentration one of them carries, and exhaustion, which is a condition with a level.
 *
 * Every one of them can change what the sheet says — a maximum, whether concentration can be held —
 * so every one ends in `settled`.
 */
import { EXHAUSTION_MAX, type Character, type EffectInstance } from '$lib/character/schema';
import { conditionRow } from '$lib/content/states';
import type { ContentGraph } from '$lib/content/loader';
import { remainingRounds } from '$lib/combat/effects-view';
import { dropEffects, endConcentration } from './concentration';
import { die } from './hit-points';
import { quietly, type PlayContext, type PlayOutcome } from './outcome';
import { settled } from './settle';

/** The condition whose row states how tall the exhaustion ladder is. */
const EXHAUSTION_CONDITION_ID = 'exhaustion';

/** An effect to put on the character. */
export interface NewEffect {
	label: string;
	tokens: string[];
	/** Buff (true, default) vs debuff (false) — drives the Buffs/Debuffs split. */
	positive?: boolean;
	/** Rounds it lasts; 0 → until removed. */
	durationRounds: number;
	/** The catalog ref when it came from a row, stored so derive reads the row LIVE and a fix to the
	 *  catalog reaches effects already on a character; absent for a custom one, which is baked. */
	ref?: string | null;
}

/** The instance an effect is once it is on a character, its clock started at `round`. */
export const effectInstanceOf = (spec: NewEffect, round: number): EffectInstance => ({
	iid: crypto.randomUUID(),
	label: spec.label,
	effects: spec.tokens,
	positive: spec.positive ?? true,
	...(spec.ref ? { source: spec.ref } : {}),
	// 0 or less → indefinite: the duration fields are absent, which is "until removed"
	...(spec.durationRounds > 0
		? { durationRounds: Math.round(spec.durationRounds), startedRound: round }
		: {}),
});

/** Put an effect on the character. Its clock starts at the current round. */
export function addEffect(character: Character, spec: NewEffect, ctx: PlayContext): PlayOutcome {
	const play = character.play;
	const effects = [...play.effects, effectInstanceOf(spec, play.round)];
	return settled(quietly({ ...character, play: { ...play, effects } }), ctx);
}

/** Take effects off by instance id — and the concentration one of them was carrying. */
export function removeEffects(
	character: Character,
	iids: readonly string[],
	ctx: PlayContext,
): PlayOutcome {
	const play = dropEffects(character.play, (effect) => iids.includes(effect.iid));
	return play === character.play
		? quietly(character)
		: settled(quietly({ ...character, play }), ctx);
}

/**
 * Set an effect's remaining duration to an exact number of rounds FROM NOW — the start is
 * re-anchored to the current round. 0 → indefinite: the duration fields are removed.
 */
export function setEffectDuration(
	character: Character,
	{ iid, rounds }: { iid: string; rounds: number },
	ctx: PlayContext,
): PlayOutcome {
	const play = character.play;
	const left = Math.max(0, Math.round(rounds || 0));
	const effects = play.effects.map((effect): EffectInstance => {
		if (effect.iid !== iid) return effect;
		const { durationRounds: _duration, startedRound: _started, ...timeless } = effect;
		return left === 0 ? timeless : { ...timeless, durationRounds: left, startedRound: play.round };
	});
	return settled(quietly({ ...character, play: { ...play, effects } }), ctx);
}

/** Nudge an effect's REMAINING duration by a number of rounds. Reaching 0 makes it indefinite. */
export function bumpEffectDuration(
	character: Character,
	{ iid, delta }: { iid: string; delta: number },
	ctx: PlayContext,
): PlayOutcome {
	const effect = character.play.effects.find((candidate) => candidate.iid === iid);
	const left = effect ? (remainingRounds(effect, character.play.round) ?? 0) : 0;
	return setEffectDuration(character, { iid, rounds: left + delta }, ctx);
}

/** Stop concentrating: the ref goes, and the effect the spell left with it. */
export const stopConcentrating = (character: Character, ctx: PlayContext): PlayOutcome =>
	settled(quietly({ ...character, play: endConcentration(character.play) }), ctx);

/** How tall the exhaustion ladder is for this character's system: the condition row's own
 *  `max_level`, so a homebrew ladder of another height works. 0 = no such row is loaded. */
export function exhaustionLadder(character: Character, graph: ContentGraph): number {
	const row = conditionRow(graph, character.system, EXHAUSTION_CONDITION_ID);
	return row ? Number(row.data.max_level ?? 1) : 0;
}

/**
 * Set the exhaustion level, clamped to the ladder. The TOP of it is lethal — RAW "You die if your
 * Exhaustion level is 6" (2024 glossary; 2014's level-6 row is likewise "Death") — and the
 * threshold is the DATA cap, so a homebrew ladder kills at its own top.
 */
export function setExhaustion(
	character: Character,
	{ level }: { level: number },
	ctx: PlayContext,
): PlayOutcome {
	// the data cap AND the schema's, because the two disagree above 20: a level the schema refuses
	// makes every later save fail, and the sheet keeps working as if nothing is wrong
	const max = Math.min(exhaustionLadder(character, ctx.graph), EXHAUSTION_MAX);
	const exhaustion = Math.max(0, Math.min(max, Math.round(level)));
	const tired = { ...character, play: { ...character.play, exhaustion } };
	return settled(max > 0 && exhaustion >= max ? die(tired, 'exhaustion') : quietly(tired), ctx);
}
