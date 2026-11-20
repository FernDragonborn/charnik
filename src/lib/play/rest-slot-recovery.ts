import type { CharacterSheet } from '$lib/character/derive';
import { characterFeatures } from '$lib/character/features';
import type { Character } from '$lib/character/schema';
import type { ContentGraph } from '$lib/content/loader';
import { evalExpression } from '$lib/effects/expression-evaluator';
import { MAX_SLOT_LEVEL } from '$lib/rules/spellcasting';
import { resourceLeft, resourceSpent } from './resources';

export type SlotRecoveryPicks = Record<string, Record<string, number>>;

/** Each recovery rule contributes its own budget. Pact Magic already returns on a Short Rest. */
export function shortRestSlotGroups(
	character: Character,
	sheet: CharacterSheet,
	graph: ContentGraph,
) {
	const ctx = sheet.castCtx;
	if (!ctx) return [];
	const spent = sheet.spellcasting.pools.flatMap(({ forcedUpcast, spellLevel, max }) => {
		if (forcedUpcast || !spellLevel) return [];
		const count = Math.min(max, character.play.spellSlotsSpent[String(spellLevel)] ?? 0);
		return count > 0 ? [{ level: spellLevel, count }] : [];
	});
	if (!spent.length) return [];
	return characterFeatures(character, graph).flatMap(({ row }) => {
		if (row.type !== 'class_feature') return [];
		const {
			short_rest_slots: formula,
			short_rest_slot_pool: id,
			short_rest_slot_max: max,
		} = row.data;
		if (!formula || !id || resourceLeft(character, sheet, id) < 1) return [];
		const result = evalExpression(formula, ctx);
		if (!result.ok || result.value.type !== 'number') return [];
		const budget = Math.floor(result.value.value);
		const slots = spent.filter(({ level }) => level <= Math.min(budget, max ?? MAX_SLOT_LEVEL));
		return slots.length ? [{ row, id, budget, slots }] : [];
	});
}

export const slotRecoveryCost = (picks: Readonly<Record<string, number>>): number =>
	Object.entries(picks).reduce((sum, [key, count]) => sum + Number(key) * count, 0);

/** Validate every selection against both its budget and the slots still available to restore. */
export function recoverSlots(
	character: Character,
	sheet: CharacterSheet,
	graph: ContentGraph,
	picks: SlotRecoveryPicks,
) {
	const spellSlotsSpent = { ...character.play.spellSlotsSpent };
	const recoveredPools: Record<string, number> = {};
	const groups = shortRestSlotGroups(character, sheet, graph);
	for (const [id, given] of Object.entries(picks)) {
		const selected = Object.entries(given).filter(([, count]) => count !== 0);
		if (!selected.length) continue;
		const group = groups.find((candidate) => candidate.id === id);
		if (!group || slotRecoveryCost(given) > group.budget) return null;
		for (const [key, count] of selected) {
			const slot = group.slots.find(({ level }) => String(level) === key);
			if (!slot || !Number.isInteger(count) || count < 0 || count > slot.count) return null;
			const left = Math.min(slot.count, spellSlotsSpent[key] ?? 0);
			if (count > left) return null;
			spellSlotsSpent[key] = left - count;
		}
		recoveredPools[id] = resourceSpent(character, sheet, id) + 1;
	}
	return { spellSlotsSpent, recoveredPools };
}
