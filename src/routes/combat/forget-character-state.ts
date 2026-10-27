/*
 * The combat view-model is a singleton that outlives the character it shows. What it holds for ONE
 * character — a concentration save owed, a reroll offered, a picker half-filled, a question asked —
 * must not be handed to the next.
 */
import type { SheetRolls } from './sheet-rolls.svelte';
import type { ActionExecutor } from './action-executor.svelte';
import type { SpellCasting } from './spell-casting.svelte';
import type { ResourceTracker } from './resource-tracker.svelte';
import type { MenuOverlay } from './menu-overlay.svelte';
import type { RestControls } from './rest-controls.svelte';
import type { HitPoints } from './hit-points.svelte';
import type { InventoryTracker } from './inventory.svelte';
import type { FormShift } from './form-shift.svelte';

export interface CharacterBoundParts {
	hp: HitPoints;
	rolls: SheetRolls;
	rests: RestControls;
	casting: SpellCasting;
	executor: ActionExecutor;
	forms: FormShift;
	menus: MenuOverlay;
	inventory: InventoryTracker;
	resources: ResourceTracker;
}

export function forgetCharacterState(parts: CharacterBoundParts): void {
	parts.hp.owedConcentrationSaves = [];
	parts.rolls.forgetSavage();
	parts.rests.hdPick = {};
	parts.casting.upcastSpell = null;
	parts.casting.enchanting = null;
	parts.executor.asking = null;
	parts.forms.asking = null;
	parts.menus.overlay = null;
	parts.inventory.shotPending = null;
	parts.resources.forgetWindows();
}
