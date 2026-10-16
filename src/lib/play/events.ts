/*
 * The two moments in play that FIRE features: rolling Initiative and the start of a turn.
 *
 * Whoever ends a turn also starts the next one, and entering combat IS the first turn — so each is
 * one action, and a feature listening for the moment cannot be missed by a caller that forgot to
 * fire it. RAW these happen TO the character, so they are applied and said rather than offered; with
 * effects-auto off the player manages by hand and nothing fires.
 */
import { LOG_KIND } from '$lib/character/log-kind';
import { PLAY_EVENT, type PlayEvent } from '$lib/effects/token-parser';
import type { Character } from '$lib/character/schema';
import { runAction } from './options';
import { chain, quietly, type PlayContext, type PlayOutcome } from './outcome';
import { resourceLeft, resourceName, restoreResourceUpTo } from './resources';
import { nextTurn, toggleCombat } from './turn';

/** What an event is told: rounds an effect one of its hooks adds lasts when nothing states a length. */
export interface EventRun {
	effectRounds: number;
}

/**
 * Run every `on_event` hook listening for an event (2024 Champion's Heroic Rally at a turn start).
 * Both halves were decided at derive: the action's formula is resolved, and the hook's guard decided
 * whether it is in the list at all — which is how "if you are Bloodied" is said.
 */
function fireEvent(
	character: Character,
	event: PlayEvent,
	{ effectRounds }: EventRun,
	ctx: PlayContext,
): PlayOutcome {
	if (!character.play.autoCalc) return quietly(character);
	return ctx
		.derive(character)
		.facts.onEvent.filter((hook) => hook.event === event)
		.reduce<PlayOutcome>(
			(outcome, hook) =>
				chain(outcome, (next) =>
					runAction(next, { name: hook.source, action: hook.action, effectRounds }, ctx),
				),
			quietly(character),
		);
}

/** "When you roll Initiative": every `regain_on_initiative` feature restores its pool up to N, and
 *  says what came back under the feature's own name (Perfect Focus → Focus 4). */
function regainOnInitiative(character: Character, ctx: PlayContext): PlayOutcome {
	if (!character.play.autoCalc) return quietly(character);
	const sheet = ctx.derive(character);
	return sheet.facts.initiativeRegain.reduce<PlayOutcome>(
		(outcome, regain) =>
			chain(outcome, (next) => {
				const before = resourceLeft(next, sheet, regain.id);
				const restored = restoreResourceUpTo(next, regain, ctx);
				const after = resourceLeft(restored.character, sheet, regain.id);
				if (after <= before) return restored;
				return {
					...restored,
					notices: [
						...restored.notices,
						{
							text: regain.source,
							description: {
								key: 'combat.notice.resourceRestoredTo',
								values: { resource: resourceName(sheet, regain.id), count: after },
							},
							kind: LOG_KIND.resource,
						},
					],
				};
			}),
		quietly(character),
	);
}

/** Enter or leave combat. Entering is rolling Initiative, and round 1 is the character's first
 *  turn — so a turn-start feature fires here too, or it would skip the first turn of every fight. */
export function enterOrLeaveCombat(
	character: Character,
	run: EventRun,
	ctx: PlayContext,
): PlayOutcome {
	return chain(toggleCombat(character, ctx), (toggled) =>
		toggled.play.inCombat
			? chain(regainOnInitiative(toggled, ctx), (regained) =>
					fireEvent(regained, PLAY_EVENT.turnStart, run, ctx),
				)
			: quietly(toggled),
	);
}

/** End the turn and start the next one. */
export function startNextTurn(character: Character, run: EventRun, ctx: PlayContext): PlayOutcome {
	return chain(nextTurn(character, ctx), (next) => fireEvent(next, PLAY_EVENT.turnStart, run, ctx));
}
