/*
 * What the hit-point block knows about its motions beyond their names.
 */
import type { DownMotion } from '$lib/character/schema';

/**
 * The motions that cost noticeably more to draw than the rest, and say so in the pencil's list.
 * Liquid is fused by a filter the browser repaints every frame; everything else here loops
 * `transform` and `opacity` alone.
 */
export const DEAR_MOTIONS: ReadonlySet<DownMotion> = new Set<DownMotion>(['liquid']);

/** The saves the block draws while a motion is being chosen on a character who is not down: one
 *  success against two failures, where every motion is at its tightest and both sides show. */
export const PREVIEW_SAVES = { successes: 1, failures: 2 } as const;
