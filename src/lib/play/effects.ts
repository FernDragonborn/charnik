/*
 * The effects and conditions on a character, as actions: putting one on, taking one off, its round
 * timer, the concentration one of them carries, and exhaustion, which is a condition with a level.
 *
 * Every one of them can change what the sheet says — a maximum, whether concentration can be held —
 * so every one ends in `settled`.
 */
import type { Character, EffectInstance } from '$lib/character/schema';
import type { ContentGraph } from '$lib/content/loader';
import { remainingRounds } from '$lib/combat/effects-view';
import { dropEffects, endConcentration } from './concentration';
import { effectRow, withExhaustion, withoutEffects } from './effect-endings';
import { quietly, type PlayContext, type PlayOutcome } from './outcome';
import { settled } from './settle';

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
	return endEffects(character, (effect) => iids.includes(effect.iid), ctx);
}

/** A dependent state ends when the named effect ends, regardless of how its parent left play. */
export function endEffects(
	character: Character,
	shouldEnd: (effect: EffectInstance) => boolean,
	ctx: PlayContext,
): PlayOutcome {
	const next = withoutEffects(character, shouldEnd, ctx.graph);
	return next === character ? quietly(character) : settled(quietly(next), ctx);
}

export function consumeAttackEffects(character: Character, ctx: PlayContext): PlayOutcome {
	return endEffects(
		character,
		(effect) => effectRow(effect, ctx.graph)?.data.expires_after === 'attack',
		ctx,
	);
}

/** A projection used for later attacks in the same dice-tray volley. */
export function afterAttackEffects(character: Character, graph: ContentGraph): Character {
	const before = character.play;
	const play = dropEffects(
		before,
		(effect) => effectRow(effect, graph)?.data.expires_after === 'attack',
	);
	return play === before ? character : { ...character, play };
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

/** Effects-auto on or off. Off drops every effect layer from the sheet — a maximum an effect was
 *  raising goes with it — so the switch settles like any other change. */
export const setAutoCalc = (
	character: Character,
	{ on }: { on: boolean },
	ctx: PlayContext,
): PlayOutcome =>
	settled(quietly({ ...character, play: { ...character.play, autoCalc: on } }), ctx);

/** Stop concentrating: the ref goes, and the effect the spell left with it. */
export const stopConcentrating = (character: Character, ctx: PlayContext): PlayOutcome =>
	settled(quietly({ ...character, play: endConcentration(character.play) }), ctx);

/** Set the exhaustion level (`withExhaustion` clamps it and dies at the top of the ladder). */
export function setExhaustion(
	character: Character,
	{ level }: { level: number },
	ctx: PlayContext,
): PlayOutcome {
	return settled(quietly(withExhaustion(character, level, ctx.graph)), ctx);
}
