/*
 * The rules that FOLLOW a change in play-state, whoever made it.
 *
 * Each is a consequence RAW leaves no choice about, and each has several causes that know nothing of
 * it: hit points come back from a heal, a rest and a form; concentration breaks on a hit, a
 * condition and a rage; a form ends with its effect, a state or a death. So they are stated once, here, and every action ends in `settled` — a rule
 * enforced by something that watches a screen holds only while that screen is mounted.
 */
import { LOG_KIND } from '$lib/character/log-kind';
import { effectiveHpMax } from '$lib/rules/core';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { endConcentration } from './concentration';
import { leaveForm } from './form';
import { quietly, type PlayContext, type PlayNotice, type PlayOutcome } from './outcome';
import { isIncapacitated } from './conditions';

/** One rule's consequence can be another's cause — concentration ending takes an `hp_max` effect
 *  down, which lowers the maximum. More passes than rules is a loop in the rules themselves. */
const SETTLE_PASSES = 8;

/**
 * Current hit points never stand above the effective maximum — an `hp_max` effect that ended (Aid)
 * or a manual max that was lowered pulls them down.
 *
 * And above 0 hit points nothing about dying is true, so the death-save track does not survive
 * there. RAW, both editions: "The number of both is reset to zero when you regain any hit points or
 * become stable". A DEAD character is left alone: one can die at full hit points (exhaustion), and
 * their track is a record.
 */
function settleHitPoints(character: Character, sheet: CharacterSheet): Character {
	let play = character.play;
	const max = effectiveHpMax(play.hp.max ?? null, sheet.maxHp);
	if (play.hp.current > max) play = { ...play, hp: { ...play.hp, current: max } };
	const tracked = play.deathSaves.successes > 0 || play.deathSaves.failures > 0;
	if (!play.death && play.hp.current > 0 && tracked)
		play = { ...play, deathSaves: { successes: 0, failures: 0 } };
	return play === character.play ? character : { ...character, play };
}

/** RAW: dropping to 0 hit points, becoming Incapacitated, or gaining a state that forbids it (Rage
 *  — a `blocks_concentration` marker, so any homebrew state carrying one behaves the same) ENDS
 *  concentration. */
function endBrokenConcentration(character: Character, sheet: CharacterSheet): Character {
	const play = character.play;
	if (!play.concentration) return character;
	const broken =
		play.hp.current <= 0 || isIncapacitated(character, sheet) || sheet.facts.breaksConcentration;
	return broken ? { ...character, play: endConcentration(play) } : character;
}

/**
 * A form that has ended is left. Its carrier effect gone is the form gone — the Effects panel's ✕,
 * its clock running out and a rest all remove an effect and know nothing of forms — and that needs
 * no saying. Its own rules ending it does: "You automatically revert if you fall unconscious, drop
 * to 0 hit points, or die" (SRD 5.1), "until you … have the Incapacitated condition, or die" (SRD
 * 5.2.1). The states are the feature's `ends_when` statements, and death answers for all of them.
 * 0 hit points is NOT one of them: it ends a form that has hit points of its own, because those are
 * what ran out, and SRD 5.2.1 — whose druid keeps their own — does not name it.
 */
function endFinishedForm(character: Character, sheet: CharacterSheet): PlayOutcome {
	const play = character.play;
	const form = play.form;
	if (!form) return quietly(character);
	const left = { ...character, play: leaveForm(play) };
	if (!play.effects.some((effect) => effect.source === form.monster)) return quietly(left);
	const endsWhen = sheet.facts.forms.find((rules) => rules.id === form.id)?.endsWhen ?? [];
	const stated =
		endsWhen.length > 0 &&
		(!!play.death || endsWhen.some((state) => sheet.facts.conditions.includes(state)));
	const spent = form.hpBefore !== undefined && play.hp.current <= 0;
	if (!stated && !spent) return quietly(character);
	return {
		...quietly(left),
		notices: [
			{
				text: { key: 'combat.notice.formEnded' },
				rows: { name: form.monster },
				kind: LOG_KIND.effect,
			},
		],
	};
}

/**
 * Apply every rule until nothing moves, against the sheet as it stands after each step — a rule may
 * change what the sheet says. The form goes first: one that ends at 0 hit points hands the
 * character's own back, and concentration is then asked of those. The character in the outcome is
 * the one it was given when there is nothing to do.
 */
export function settlePlay(character: Character, ctx: PlayContext): PlayOutcome {
	let settling = character;
	const notices: PlayNotice[] = [];
	for (let pass = 0; pass < SETTLE_PASSES; pass++) {
		const sheet = ctx.derive(settling);
		const formed = endFinishedForm(settling, sheet);
		notices.push(...formed.notices);
		const unbroken =
			formed.character === settling ? endBrokenConcentration(settling, sheet) : formed.character;
		const next = unbroken === settling ? settleHitPoints(settling, sheet) : unbroken;
		if (next === settling) break;
		settling = next;
	}
	return { ...quietly(settling), notices };
}

/** An action's result with the rules that follow it applied. */
export function settled(outcome: PlayOutcome, ctx: PlayContext): PlayOutcome {
	const after = settlePlay(outcome.character, ctx);
	if (after.character === outcome.character) return outcome;
	return {
		...outcome,
		character: after.character,
		notices: [...outcome.notices, ...after.notices],
	};
}
