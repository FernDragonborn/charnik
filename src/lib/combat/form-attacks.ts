/*
 * The attacks of a FORM: while a character is in one, the stat block's attacks are theirs and their
 * own weapons are not — "your game statistics are replaced", in both editions' Wild Shape.
 *
 * A stat block states each attack whole — its bonus to hit and its damage already include the
 * creature's own modifiers — in the monster row's `attacks` column:
 * `<name>:<to hit>:<reach or range>:<dice> <type>[, <dice> <type>]`, joined by `; `. So the row is
 * read, never recomputed from the form's scores.
 */
import { activeForm, type MonsterRow } from '$lib/character/forms';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { computeAttacks, parseDamageParts, type Attack } from './attacks';

/** The prefix a form attack's id carries, so it can never collide with a weapon's content id. */
const FORM_ATTACK_PREFIX = 'form_attack';

/** A stat block's attacks as attack rows. An entry the grammar cannot read is skipped rather than
 *  shown as a row that rolls nothing. */
function formAttacks(row: MonsterRow): Attack[] {
	const out: Attack[] = [];
	for (const [index, entry] of (row.data.attacks ?? '').split(';').entries()) {
		const [name = '', toHit = '', reach = '', damage = ''] = entry.split(':').map((s) => s.trim());
		const bonus = Number(toHit);
		if (!name || toHit === '' || !Number.isInteger(bonus)) continue;
		out.push({
			id: `${FORM_ATTACK_PREFIX}:${row.id}:${index}`,
			name,
			toHit: bonus,
			// the column separates damage types with a comma; a damage string separates them with `;`
			damageParts: parseDamageParts(damage.replaceAll(',', ';')),
			// the reach or range is the one thing the column says about the attack beyond its numbers,
			// and it does not say WHICH of the two it is — so it is printed as written, under no word
			meta: { kinds: [], propertyRows: [], ...(reach ? { property: ['', reach] } : {}) },
			scopes: [],
		});
	}
	return out;
}

/** The attack rows a character has RIGHT NOW: the form's while they are in one, their own weapons
 *  and fists otherwise. The play sheet reads this; the builder, where nobody is shaped, reads
 *  `computeAttacks`. */
export function sheetAttacks(
	character: Character,
	sheet: CharacterSheet,
	graph: ContentGraph,
	locale = 'en',
): Attack[] {
	const form = activeForm(character, graph);
	return form ? formAttacks(form.row) : computeAttacks(character, sheet, graph, locale);
}
