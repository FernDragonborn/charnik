/*
 * The dice-tray CONTRACT — the seam every "open the tray" caller (RollButton, combat, …) talks to,
 * so nothing is nailed to a concrete tray. A real DiceTray registers a handler when it mounts; until
 * then (and on routes without a tray, e.g. the compendium) the fallback rolls instantly + toasts, so
 * the affordance already works. Rewriting/expanding the tray means implementing this contract, not
 * touching callers.
 */
import { rollFormula, type DieMods } from '$lib/rules/dice';
import { toast } from 'svelte-sonner';

/** A damage roll queued to fire right after the tray's next Roll (an attack's to-hit → damage). */
export interface QueuedDamage {
	label: string;
	dice: Record<number, number>;
	mod: number;
	mods?: DieMods;
}

/**
 * A request to open the tray. `label` + `formula` are the minimal, stable core every caller uses
 * (RollButton, the compendium). The rich combat tray (D8) grows it behind the SAME seam with
 * optional extras — a pre-split pool, advantage, roll-manipulation mods, an attack→damage chain —
 * which a formula-only caller simply omits (the fallback + the adapter read `formula`). See
 * charnik-dicetray-attack-damage-concept.
 */
export interface DiceTrayRequest {
	/** Human label for the roll ("Fireball", "Acid Splash — to hit", "HP rolled"). */
	label: string;
	/** A dice formula string the tray pre-fills ("8d6", "1d20", "16d12 + 80"). */
	formula: string;
	/** Optional pre-split pool (sides→count) — when present, used verbatim instead of parsing `formula`. */
	pool?: Record<number, number>;
	/** Flat modifier for the pool (paired with `pool`). */
	mod?: number;
	/** −1 disadvantage · 0 normal · +1 advantage. */
	advantage?: number;
	/** reroll / min_die facts that ride the roll (GWF, Reliable Talent). */
	mods?: DieMods;
	/** An attack's damage roll, fired right after the to-hit. */
	queuedDamage?: QueuedDamage;
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
