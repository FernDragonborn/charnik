/*
 * The hit's line, as the dice tray says a damage line: an amount, then the type that owns it.
 *
 * Pure. What is typed is read here, and the type menu's rows are ordered here; the names and the
 * matching are the tray's own (`$lib/dice/roller-vocabulary`), so a type is found on this line by
 * the same words, in the same languages, as on a roller line.
 */
import { matchCandidates, type RollerCandidate } from '$lib/dice/roller-vocabulary';
import type { SensitivityBucket } from '$lib/combat/helpers';

/** How a defense is marked beside a damage type. Text, not icons: they are the game's own signs. */
export const DEFENCE_MARK: Record<Exclude<SensitivityBucket, null>, string> = {
	immune: '∅',
	resist: '½',
	vulnerable: '×2',
};

/** What is typed on the line: the amount, and the start of a type's name after it. */
export interface TypedHit {
	/** Null while no digit is typed — the line may hold only the start of a type's name. */
	amount: number | null;
	word: string;
}

/** Read `12 fi` as twelve and the word `fi`. Digits lead; whatever follows them is the word. */
export function readTypedHit(text: string): TypedHit {
	const [, digits = '', word = ''] = /^\s*(\d*)\s*(.*?)\s*$/.exec(text) ?? [];
	return { amount: digits ? Number(digits) : null, word };
}

/** One row of the type menu. `key` is null on the row that takes the type back off. */
export interface TypeRow {
	key: string | null;
	label: string;
	/** Where in the label the typed word sits, or −1 when it matched another language or the key. */
	at: number;
	length: number;
}

/** What the type menu is drawn from, whatever is typed. */
export interface TypeMenu {
	/** The types as the tray names them, in the reader's language. */
	candidates: readonly RollerCandidate[];
	/** Every type's key, in the order an unfiltered menu lists them. */
	order: readonly string[];
	/** The types this sheet has a defense for. */
	defended: ReadonlySet<string>;
	/** What the row that takes the type back off is called. */
	untyped: string;
}

/**
 * The type menu's rows. With nothing typed it is every type in `order` — the sheet's defended types
 * first, since those change the number — and the row that says "untyped" last, which is the way
 * back out of a type. With a word typed it is the types that word finds, defended ones leading, and
 * no "untyped": that row is a choice, never a search result.
 */
export function typeRows(word: string, menu: TypeMenu): TypeRow[] {
	const { candidates, order, defended, untyped } = menu;
	if (!word.trim()) {
		const labels = new Map(candidates.map((candidate) => [candidate.key, candidate.label]));
		return [
			...order.map((key) => ({ key, label: labels.get(key) ?? key, at: -1, length: 0 })),
			{ key: null, label: untyped, at: -1, length: 0 },
		];
	}
	const found = matchCandidates(word, [...candidates], candidates.length).map(
		({ candidate, at, length }) => ({ key: candidate.key, label: candidate.label, at, length }),
	);
	// a stable partition: the matcher's own order holds inside each half
	return [
		...found.filter((row) => defended.has(row.key)),
		...found.filter((row) => !defended.has(row.key)),
	];
}

/** What the first row would finish the typed word as — the grey completion after the caret. Empty
 *  when the word is not the START of that row's name: a completion has to continue what is there. */
export const completionOf = (word: string, rows: readonly TypeRow[]): string => {
	const [first] = rows;
	return first && word && first.at === 0 ? first.label.slice(word.length) : '';
};
