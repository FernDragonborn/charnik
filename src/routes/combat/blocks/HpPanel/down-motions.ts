/*
 * What the hit-point block knows about its motions beyond their names.
 */
import type { DeathCause, DownMotion } from '$lib/character/schema';

/**
 * The motions that cost noticeably more to draw than the rest, and say so in the pencil's list.
 * Liquid is fused by a filter the browser repaints every frame; everything else here loops
 * `transform` and `opacity` alone.
 */
export const DEAR_MOTIONS: ReadonlySet<DownMotion> = new Set<DownMotion>(['liquid']);

/**
 * A 0 hit points face to DRAW that is not the character's own right now: the saves, and the ending
 * if it had one. Two things need it — the motion being chosen on a character who is not down, and
 * the face a character just left, held still while it is wiped away. Either is looked at, never
 * pressed.
 */
export interface DownShown {
	successes: number;
	failures: number;
	ending: 'dead' | 'stable' | null;
	cause: DeathCause | null;
	/** The hit points that face said, or null to say the character's own as they stand. */
	hitPoints: number | null;
}

/** What is drawn while a motion is being chosen: one success against two failures, where every
 *  motion is at its tightest and both sides show. */
export const PREVIEW_FIGHT: DownShown = {
	successes: 1,
	failures: 2,
	ending: null,
	cause: null,
	hitPoints: null,
};
