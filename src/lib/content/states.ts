/*
 * A STATE is anything currently modifying the character: a condition the rules name (Poisoned,
 * exhaustion) or a runtime effect the player adds (Bless, half cover). They are ONE content type
 * (CONDEFF) — Poisoned is disadvantage on the attack the same way Bane is, and that they were two
 * types was an authoring accident a pack author should never have had to learn.
 *
 * The UI is one surface too: ONE "+" lists every state a player can put on themselves, and what a
 * row still answers to its KIND for is how it behaves once it is in that list — a condition toggles
 * (you cannot be Poisoned twice), a catalog entry adds again. This leaf answers "which is this row"
 * in one place, so no consumer re-derives the filter: the split used to be a type name, and a type
 * name is exactly the kind of thing that gets forgotten at the next call site.
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

const APPLY_CONDITION = 'apply_condition:';

/** The condition this row PUTS ON the character, when putting it on is the whole of what the row
 *  does. Such a row and the condition it names are one thing to the player: `rage` ships as both —
 *  the condition holding the mechanics, the catalog entry applying it with a duration — and in one
 *  list that reads as the same word twice. */
export const appliedConditionId = (row: StateRow): string | null => {
	const tokens = row.data.effects ?? [];
	const only = tokens.length === 1 ? tokens[0] : undefined;
	return only?.startsWith(APPLY_CONDITION) ? only.slice(APPLY_CONDITION.length) : null;
};

/** Which condition a picker row stands for — its own id, or the one it exists to apply. Null for a
 *  row that does something of its own. */
export const pickerConditionId = (row: StateRow): string | null =>
	isConditionRow(row) ? row.id : appliedConditionId(row);

/** Every state the "+" picker offers — conditions and catalog entries in ONE list.
 *
 *  Two rows are kept out. A LEVELLED condition (exhaustion, `max_level > 1`) is a stepper with a
 *  block of its own, and an entry that could only ever say "on" would double-count with it (D19).
 *  And a condition an APPLIER already stands for drops in favour of the applier, which is the row
 *  that carries the default duration and the ref the instance resolves through. */
export const addableStateRows = (graph: ContentGraph, system: System): StateRow[] => {
	const rows = graph.list('effect', { system }).filter((r) => Number(r.data.max_level ?? 1) <= 1);
	const applied = new Set(
		rows.filter((r) => !isConditionRow(r)).flatMap((r) => appliedConditionId(r) ?? []),
	);
	return rows.filter((r) => !(isConditionRow(r) && applied.has(r.id)));
};

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
