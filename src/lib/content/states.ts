/*
 * A STATE is anything currently modifying the character: a condition the rules name (Poisoned,
 * exhaustion) or a runtime effect the player adds (Bless, half cover). They are ONE content type
 * (CONDEFF) — Poisoned is disadvantage on the attack the same way Bane is, and that they were two
 * types was an authoring accident a pack author should never have had to learn.
 *
 * What still differs is the UI: a condition is a binary or levelled toggle the rules name, an effect
 * is a "+" catalog entry carrying a duration. This leaf answers "which is this row" in one place, so
 * no consumer re-derives the filter — the split used to be a type name, and a type name is exactly
 * the kind of thing that gets forgotten at the next call site.
 */
import { ROW_KIND, VALENCE, type Valence } from './schemas';
import type { ContentGraph, LoadedRowByType } from './loader';
import type { System } from '../rules/pipeline';

/** One state row — the merged `effect` type, of either kind. */
export type StateRow = LoadedRowByType<'effect'>;

/** A row the RULES name, as opposed to one the player adds. Blank reads as an effect: the merged
 *  type keeps `effects_*.csv` exactly as it was, and those rows never carried a kind. */
export const isConditionRow = (row: StateRow): boolean => row.data.kind === ROW_KIND.condition;

/** Every condition of this edition. */
export const conditionRows = (graph: ContentGraph, system: System): StateRow[] =>
	graph.list('effect', { system }).filter(isConditionRow);

/** One condition by id, or undefined — the lookup `apply_condition:<id>` resolves through. */
export const conditionRow = (
	graph: ContentGraph,
	system: System,
	id: string,
): StateRow | undefined => conditionRows(graph, system).find((r) => r.id === id);

/** The "+" picker's catalog: the states a player adds themselves, which is everything that is not a
 *  condition (a condition has its own multi-select, and listing it twice would let one character
 *  carry Poisoned as both). */
export const effectCatalogRows = (graph: ContentGraph, system: System): StateRow[] =>
	graph.list('effect', { system }).filter((r) => !isConditionRow(r));

/** Whether a state is something you want. Anything the row does not say — including a valence a pack
 *  named itself — reads `neutral`, which renders as the un-alarming case rather than guessing. */
export const valenceOf = (row: StateRow): Valence => {
	const raw = row.data.valence;
	if (raw === VALENCE.harmful) return VALENCE.harmful;
	if (raw === VALENCE.helpful) return VALENCE.helpful;
	return VALENCE.neutral;
};

/** Does this state belong on the DEBUFF side of the panel? Only `harmful` does — the split the panel
 *  and the runtime instance's `positive` flag both key off. */
export const isHarmful = (row: StateRow): boolean => valenceOf(row) === VALENCE.harmful;
