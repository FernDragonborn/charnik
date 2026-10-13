/*
 * Whether motion is reduced RIGHT NOW, as reactive state: the app's setting weighed against the
 * system's, which a player may change while the app is open. The root layout mirrors `reduced` onto
 * `<html data-motion>`; a component that must not even MOUNT a loop reads it here.
 */
import { app } from '$lib/stores/app.svelte';
import { isMotionReduced, SYSTEM_ASKS_REDUCED_MOTION } from '$lib/util/motion';

const system = typeof window === 'undefined' ? null : window.matchMedia(SYSTEM_ASKS_REDUCED_MOTION);
let systemAsks = $state(system?.matches ?? false);
system?.addEventListener('change', (event) => (systemAsks = event.matches));

export const motion = {
	get reduced(): boolean {
		return isMotionReduced(app.reduceMotion, systemAsks);
	},
};
