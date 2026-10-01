/*
 * What an attack is CALLED when it is rolled. A roll's name outlives the language it was made in
 * (`log.jsonl`), so each name here is a catalog key with its values beside the English it reads as —
 * the plain attack, a numbered strike inside an action, and the extra attack a property grants.
 */
import type { SaidValue } from '$lib/util/say';
import type { RollName } from './roll';
import { attackName, type Attack, type ExtraAttackRow } from './attacks';

/** The attack's name as a ROLL records it: the key when this attack is one of the app's own (the
 *  Unarmed Strike), the row's word when it is content. Text stays beside the key as the fallback, so
 *  a log written today still reads on a build that has lost the catalog entry.
 *
 *  Why a key at all: `log.jsonl` outlives the language it was written in, and the one attack whose
 *  name is not data was frozen into whatever language rolled it. */
export const attackRollName = (attack: Attack, t: (key: string) => string): RollName =>
	attack.nameKey ? { text: t(attack.nameKey), key: attack.nameKey } : { text: attack.name };

/** The same name inside a numbered strike ("Unarmed Strike 1/2"), for an action that makes several.
 *  The NUMBER goes in the frame and the name rides as a value, so the name is still resolved when the
 *  line is read — and the frame is a numbering, not a grammatical composition. */
export const numberedAttackRollName = (
	attack: Attack,
	t: (key: string) => string,
	index: number,
	count: number,
): RollName => ({
	text: `${attackName(attack, t)} ${index}/${count}`,
	key: NUMBERED_ATTACK_KEY,
	values: {
		name: attack.nameKey ? catalogWord(attack.nameKey) : attack.name,
		index,
		count,
	},
});

/** An extra attack's name as a roll records it: the weapon, then the property that grants the
 *  attack. Two names in a frame, neither inflected by the other. */
export const extraAttackRollName = (
	attack: Attack,
	extra: ExtraAttackRow,
	t: (key: string) => string,
): RollName => ({
	text: `${attackName(attack, t)} — ${extra.name}`,
	key: EXTRA_ATTACK_KEY,
	values: {
		name: attack.nameKey ? catalogWord(attack.nameKey) : attack.name,
		property: extra.name,
	},
});

/** The mark an extra attack leaves on the turn once it is made — one per weapon and per granting
 *  property, because RAW gives each "only once per turn". */
export const extraAttackMark = (attack: Attack, extra: ExtraAttackRow): string =>
	`extra_attack:${attack.id}:${extra.property}`;

/** A catalog key as a `SaidValue` — `{catalog, id}` is `catalog.id`, so a key splits at its last dot. */
const catalogWord = (key: string): SaidValue => {
	const dot = key.lastIndexOf('.');
	return { catalog: key.slice(0, dot), id: key.slice(dot + 1) };
};

const NUMBERED_ATTACK_KEY = 'combat.log.attackNumbered';
const EXTRA_ATTACK_KEY = 'combat.log.attackExtra';
