/*
 * Reduce motion: the app's one switch for whether anything on screen moves by itself.
 *
 * The system has a say (`prefers-reduced-motion`) and the player has the last word: the setting
 * follows the system, or overrules it either way. The answer is mirrored onto the root element as
 * `data-motion` (`stores/motion.svelte.ts` weighs it, the root layout writes it), and that attribute
 * is what every rule and every script asks — a stylesheet reading the media query and a script
 * reading the setting would be two switches that can disagree.
 */

/** The player's setting. An open enum, not a boolean: "follow the system" is its third case. */
export const REDUCE_MOTION = { system: 'system', on: 'on', off: 'off' } as const;
export type ReduceMotion = (typeof REDUCE_MOTION)[keyof typeof REDUCE_MOTION];
export const REDUCE_MOTION_CHOICES: readonly ReduceMotion[] = Object.values(REDUCE_MOTION);

/** What the root element says once the setting and the system are weighed. */
export const MOTION = { reduced: 'reduced', full: 'full' } as const;

/** The media query the system answers through. */
export const SYSTEM_ASKS_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Is motion reduced, given the setting and what the system asks for? */
export const isMotionReduced = (setting: ReduceMotion, systemAsks: boolean): boolean =>
	setting === REDUCE_MOTION.on || (setting === REDUCE_MOTION.system && systemAsks);

/** Does anything move right now? For what CSS cannot reach — the Web Animations API, a script that
 *  starts a loop. Read per call. */
export const motionWanted = (): boolean =>
	document.documentElement.dataset.motion !== MOTION.reduced;
