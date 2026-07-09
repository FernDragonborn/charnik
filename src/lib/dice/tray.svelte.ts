/*
 * The dice-tray CONTRACT — the seam every "open the tray" caller (RollButton, combat, …) talks to,
 * so nothing is nailed to a concrete tray. A real DiceTray registers a handler when it mounts; until
 * then (and on routes without a tray, e.g. the compendium) the fallback rolls instantly + toasts, so
 * the affordance already works. Rewriting/expanding the tray means implementing this contract, not
 * touching callers.
 */
import { rollFormula } from '$lib/rules/dice';
import { toast } from 'svelte-sonner';

/**
 * A request to open the tray. Deliberately minimal + stable; the tray impl can grow richer behind it
 * (advantage/disadvantage, flat modifiers, an attack→damage chain — see
 * charnik-dicetray-attack-damage-concept) without changing any caller.
 */
export interface DiceTrayRequest {
	/** Human label for the roll ("Fireball", "Acid Splash — to hit", "HP rolled"). */
	label: string;
	/** A dice formula string the tray pre-fills ("8d6", "1d20", "16d12 + 80"). */
	formula: string;
}

/** A live tray registers a handler for the request. */
export type DiceTrayHandler = (request: DiceTrayRequest) => void;

const registry = $state<{ handler: DiceTrayHandler | null }>({ handler: null });

/** Register the live tray (a DiceTray component calls this on mount); returns an unregister fn. */
export function registerDiceTray(handler: DiceTrayHandler): () => void {
	registry.handler = handler;
	return () => {
		if (registry.handler === handler) registry.handler = null;
	};
}

/** Open the tray for a request — or, with no tray registered, roll instantly + toast (the fallback so
 *  the roll affordance works everywhere today; the tray just makes it richer where present). */
export function openDiceTray(request: DiceTrayRequest): void {
	if (registry.handler) {
		registry.handler(request);
		return;
	}
	const { total, expr } = rollFormula(request.formula);
	toast(`${request.label} — ${total}`, { description: expr });
}
