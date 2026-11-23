/*
 * A roll the GM asks for, on this side of the table: what the sheet rolls for it, the roll read back
 * off the log entry it left, and whether it met a DC. Pure — the view-model rolls, these read.
 */
import type { CharacterSheet } from '#lib/character/derive.ts';
import { naturalOf } from '#lib/rules/dice.ts';
import { AUTO_OUTCOME, type RollLogEntry, type RollName } from '#lib/combat/roll.ts';
import {
	abilityCheckRoll,
	abilityOf,
	savingThrowRoll,
	skillOf,
	skillRoll,
	type SheetRollSpec,
} from '#lib/combat/sheet-roll-specs.ts';
import { REQUESTED_ROLL, TABLE_REQUEST, type TableRequest } from '#lib/table-link/types.ts';
import type { TableRoll } from '#lib/table-link/wire-schema.ts';

export type RollRequest = Extract<TableRequest, { kind: typeof TABLE_REQUEST.roll }>;

/** Did a roll meet its DC? A condition that forced the outcome decides it over the number. */
export const rollPassed = (roll: TableRoll, dc: number): boolean =>
	roll.outcome ? roll.outcome === AUTO_OUTCOME.succeed : roll.total >= dc;

/** The roll a request asks for, on this sheet — or null when it names nothing the sheet rolls. */
export function requestedRollSpec(
	request: RollRequest,
	sheet: CharacterSheet,
): SheetRollSpec | null {
	if (request.roll === REQUESTED_ROLL.skill) {
		const skill = skillOf(request.id);
		return skill ? skillRoll(skill, sheet) : null;
	}
	const ability = abilityOf(request.id);
	if (!ability) return null;
	return request.roll === REQUESTED_ROLL.savingThrow
		? savingThrowRoll(ability, sheet)
		: abilityCheckRoll(ability, sheet);
}

/** What the table is told of a roll: the five facts the GM's side reads. */
export function tableRollOf(entry: RollLogEntry): TableRoll {
	const natural = naturalOf(entry);
	return {
		total: Number.isFinite(entry.total) ? entry.total : 0,
		...(natural === undefined ? {} : { natural }),
		advantage: entry.advantage,
		mod: entry.mod,
		...(entry.outcome ? { outcome: entry.outcome } : {}),
	};
}

/** Is this the roll of that name? By its catalog key when it has one — the text is in a language. */
export const isRollNamed = (entry: RollLogEntry, name: RollName): boolean =>
	name.key ? entry.labelKey === name.key : entry.label === name.text;
