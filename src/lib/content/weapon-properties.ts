/*
 * What a weapon property is CALLED and what it DOES, for the surfaces that print one.
 *
 * A weapon carries its mastery as a tag (`mastery:vex`), and a tag is a word: it says which weapon
 * has the property and nothing about the rule. The rule is a `weapon_property` content row keyed by
 * that word, so it is the pack's own text, translatable, and absent wherever no pack describes it —
 * in which case the word still prints, as it always did.
 */
import type { ContentGraph, LoadedRowOf } from './loader';
import type { System } from '../rules/pipeline';

export type WeaponPropertyRow = LoadedRowOf<'weapon_property'>;

/** Property word → its row, for one edition. The first row wins, like every other scan by id. */
export function weaponPropertyRows(
	graph: ContentGraph,
	system: System,
): Map<string, WeaponPropertyRow> {
	const out = new Map<string, WeaponPropertyRow>();
	for (const row of graph.list('weapon_property', { system }))
		if (!out.has(row.id)) out.set(row.id, row);
	return out;
}
