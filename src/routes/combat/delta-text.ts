/*
 * A play act's delta as the short phrases its log line shows under it: "HP 9 → 52 · d10 spent
 * 2 → 0". The delta is facts; the words are made here, in the reader's language, when the line is
 * read — never written into `log.jsonl` (the reason `RollLogEntry.noteParts` is facts).
 */
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { isRecord, type PlayChange, type PlayDelta } from '$lib/play/delta';

/** What the phrases need besides the delta: the catalog, and names the play state holds as ids. */
export interface DeltaWords {
	t(key: string, values: Record<string, string | number>): string;
	resource(id: string): string;
	item(ref: string): string;
}

/** A count that is absent is none of it — the spent maps drop a key that returns to zero. */
const countOf = (value: unknown): number => (typeof value === 'number' ? value : 0);

const nameOfRow = (row: unknown, key: string): string => {
	const value: unknown = isRecord(row) ? row[key] : undefined;
	return typeof value === 'string' ? value : '';
};

function rowPhrase(change: PlayChange, name: string, words: DeltaWords): string {
	if (change.from === undefined) return words.t('combat.delta.added', { name });
	if (change.to === undefined) return words.t('combat.delta.removed', { name });
	return words.t('combat.delta.changed', { name });
}

/** A row of a list: what the row is called, read off the row itself. */
function rowName(change: PlayChange, words: DeltaWords): string | null {
	const [root, field] = change.path;
	const row = change.to ?? change.from;
	if (root === 'build' && field === 'inventory') return words.item(nameOfRow(row, 'item'));
	if (field === 'effects') return nameOfRow(row, 'label');
	return null;
}

/** A count the player reads, by the field it sits in, with the words for its key. */
const COUNTS: Record<string, (key: string, words: DeltaWords) => [string, Record<string, string>]> =
	{
		hitDiceSpent: (key) => ['combat.delta.hitDice', { die: key }],
		spellSlotsSpent: (key) =>
			key === PACT_SLOT_KEY
				? ['combat.delta.pactSlots', {}]
				: ['combat.delta.slots', { level: key }],
		resourcesSpent: (key, words) => ['combat.delta.resource', { name: words.resource(key) }],
	};
const HP_KEYS: Record<string, string> = { current: 'combat.delta.hp', temp: 'combat.delta.tempHp' };

function phrase(change: PlayChange, words: DeltaWords): string | null {
	const [, field = '', key = ''] = change.path;
	// a reorder moves no number a player reads; the clock a rest moves is said by the rest itself
	if (key.endsWith('order') || field === 'round') return null;
	const name = rowName(change, words);
	if (name !== null) return rowPhrase(change, name, words);
	const moved = { from: countOf(change.from), to: countOf(change.to) };
	const hp = field === 'hp' ? HP_KEYS[key] : undefined;
	if (hp) return words.t(hp, moved);
	const count = COUNTS[field];
	if (count && key) {
		const [catalog, values] = count(key, words);
		return words.t(catalog, { ...moved, ...values });
	}
	if (field === 'exhaustion') return words.t('combat.delta.exhaustion', moved);
	if (typeof change.from === 'number' || typeof change.to === 'number')
		return words.t('combat.delta.other', { ...moved, field: change.path.slice(1).join('.') });
	return null;
}

/** The phrases, in the order the delta holds them; a change nobody reads as a number is left out. */
export function deltaPhrases(delta: PlayDelta, words: DeltaWords): string[] {
	return delta.flatMap((change) => {
		const said = phrase(change, words);
		return said === null ? [] : [said];
	});
}
