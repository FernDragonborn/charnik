/*
 * What a roller line can be told BY NAME — the suggestion menu's contents and the resolver behind a
 * submitted word. Pure: it takes plain projections of the character's active effects, the effect
 * catalog and the known damage types; the dice tray does the graph reading.
 *
 * The one rule the whole module exists for: **the language you TYPE in is not the language the UI is
 * in.** A match runs against EVERY localized name a row carries and against the key itself, so
 * `fire`, `вогонь` and `bless` all land on the same candidate; what the menu SHOWS is the name in the
 * interface locale, so typing `fire` under a Ukrainian UI offers «вогонь». The key is what ends up in
 * the pill and in the log, which is why the record never depends on how it was typed.
 *
 * Ambiguity is never guessed. Two candidates matching one prefix stay two rows in the menu — the spec
 * is explicit that the menu stays open until a person picks (§6), which is the same rule as "never a
 * silently-wrong number", one floor up in the interaction.
 */
import { localizedName } from '$lib/content/names';
import { EFFECT_KIND, parseToken } from '$lib/effects/token-parser';
import { ADVANTAGE_MODE, parseDiceTerm, type AdvantageMode } from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import { PILL_KIND, TOKEN_KIND, type ParsedRollerToken, type RollerResolver } from './roller';

/** A named thing a line can be told about: an effect (active or merely known) or a damage type.
 *  Deliberately ONE shape for both — the spec's menu is one list with two groups, not two lists, and
 *  a candidate that carried its group in its type would make that harder rather than easier. */
export interface NamedRollSource {
	/** The stable key stored in the pill and in the log — a row id, or a damage-type key. */
	key: string;
	/** locale → name. The whole map, not the active one: matching reads all of it. */
	names: Record<string, string>;
	/** Effect tokens, for a source that HAS mechanics. Empty for a damage type. */
	tokens: string[];
	/** On the character right now → sorted above everything else, and marked with the dot. */
	active: boolean;
	/** A damage type rather than a source of dice. */
	damageType?: true;
	/** Sets how the line is READ rather than adding anything to it — the `adv` / `dis` / `neut` rows.
	 *  A source rather than a constant in this file because its NAME is localized like every other
	 *  row's, and the catalog is the bridge's business (`roller-sources.ts`), not the vocabulary's. */
	mode?: AdvantageMode;
}

/** One row of the suggestion menu — and, since picking it is the same act as typing its name in
 *  full, also what the resolver answers with on an exact hit. */
export interface RollerCandidate {
	key: string;
	/** The name in the INTERFACE locale, whatever locale it was typed in. */
	label: string;
	/** Every name it answers to, lowercased: all its localized names AND the key. Carried on the row
	 *  rather than recomputed, because matching is the hot path and the map is gone by then. */
	aliases: string[];
	/** What picking it does. A pill for a die / modifier / damage type; an advantage token for a
	 *  source whose whole contribution is "you have advantage". */
	insert: ParsedRollerToken;
	/** What the menu shows on the left — exactly what will be inserted, sign included. The sign is
	 *  part of it on purpose: Bless gives `+1d4` and Bane `−1d4`, and without the sign written on
	 *  both, two opposite effects are one row typed twice (§6). */
	preview: string;
	active: boolean;
}

/** A source's first ROLL contribution, as the token it inserts. Only the first: an effect that
 *  touches several targets (Bless is attack AND saves) contributes the same die to each, and the
 *  line the cursor is in already says which roll it is going into (§8 — a mod belongs to its line). */
function contributionOf(source: NamedRollSource, label: string): ParsedRollerToken | null {
	if (source.mode) return { kind: TOKEN_KIND.advantage, mode: source.mode };
	if (source.damageType)
		return {
			kind: TOKEN_KIND.pill,
			pill: { kind: PILL_KIND.damageType, text: label, type: source.key },
		};
	for (const token of source.tokens) {
		const parsed = parseToken(token);
		if (parsed.kind === EFFECT_KIND.advantage)
			return { kind: TOKEN_KIND.advantage, mode: ADVANTAGE_MODE.advantage };
		if (parsed.kind === EFFECT_KIND.disadvantage)
			return { kind: TOKEN_KIND.advantage, mode: ADVANTAGE_MODE.disadvantage };
		if (parsed.kind !== EFFECT_KIND.flatBonus) continue;
		const die = parsed.dice ? parseDiceTerm(parsed.dice) : null;
		if (die)
			return {
				kind: TOKEN_KIND.pill,
				pill: {
					kind: PILL_KIND.dice,
					text: label,
					count: die.count,
					sides: die.sides,
					sign: die.sign < 0 ? -1 : 1,
					source: label,
				},
			};
		if (parsed.amount !== undefined && parsed.amount !== 0)
			return {
				kind: TOKEN_KIND.pill,
				pill: { kind: PILL_KIND.flat, text: label, amount: parsed.amount, source: label },
			};
	}
	return null;
}

/** What a mode row DOES, written out. Never the abbreviation: `adv` is jargon this app made up, and a
 *  menu is where you learn what a thing is, not where you are quizzed on its short form (the parser
 *  still takes `adv`, and typing it finds this row by prefix anyway). */
const MODE_PREVIEW: Record<AdvantageMode, string> = {
	[ADVANTAGE_MODE.advantage]: 'advantage',
	[ADVANTAGE_MODE.disadvantage]: 'disadvantage',
	[ADVANTAGE_MODE.neither]: 'neutral',
};

/** What a candidate writes into the line, as text. A damage type has nothing to preview — its name
 *  IS the whole of it — so its chip is empty and the row is just the name; a MODE row is the same
 *  case, since its name is what it does. */
function previewOf(source: NamedRollSource, insert: ParsedRollerToken): string {
	if (insert.kind === TOKEN_KIND.advantage) return source.mode ? '' : MODE_PREVIEW[insert.mode];
	if (insert.kind !== TOKEN_KIND.pill) return '';
	const pill = insert.pill;
	if (pill.kind === PILL_KIND.dice)
		return `${pill.sign < 0 ? '−' : '+'}${pill.count}d${pill.sides}`;
	if (pill.kind === PILL_KIND.flat) return signed(pill.amount);
	return '';
}

/** Project the sources into menu rows for one interface locale. A source with no contribution at all
 *  is dropped — a menu row that inserts nothing is a dead end. */
export function rollerCandidates(sources: NamedRollSource[], locale: string): RollerCandidate[] {
	const out: RollerCandidate[] = [];
	for (const source of sources) {
		const label = localizedName(source.names, locale) || source.key;
		const insert = contributionOf(source, label);
		if (!insert) continue;
		out.push({
			key: source.key,
			label,
			// the key is an alias because content ids are what a fast typist and a shared macro use,
			// and because a row with no translation into the active locale must still be reachable
			aliases: [
				...new Set([source.key, ...Object.values(source.names)].map((s) => s.toLowerCase())),
			],
			insert,
			preview: previewOf(source, insert),
			active: source.active,
		});
	}
	return out;
}

/** Whether a row inserts a damage TYPE rather than dice. Read off the insert instead of carried as a
 *  flag: the type is already what the row does, and a second field saying so is a second thing to
 *  keep true. The dice tray uses it to decide which rows a LINE may be told at all. */
export const isDamageType = (candidate: RollerCandidate): boolean =>
	candidate.insert.kind === TOKEN_KIND.pill && candidate.insert.pill.kind === PILL_KIND.damageType;

/** How well a typed word fits a name. Lower is better; the ranks are the spec's own reading order —
 *  a name that STARTS with what you typed beats one where some word inside it starts with it, which
 *  beats a match buried mid-word (`tri` → "Blessing of the Trickster" is rank 1, not a miss). 3 is
 *  "no match". */
const rankOf = (alias: string, query: string): number => {
	if (alias.startsWith(query)) return 0;
	if (alias.split(/[\s'’\-_]+/).some((w) => w.startsWith(query))) return 1;
	return alias.includes(query) ? 2 : 3;
};

/** A candidate that matched, with where in its LABEL the match sits so the menu can embolden it.
 *  `at` is −1 when the hit came from another language or from the key: there is nothing to highlight
 *  in a label that does not contain what was typed, and inventing a highlight would misreport why
 *  the row is there. */
export interface RollerMatch {
	candidate: RollerCandidate;
	at: number;
	length: number;
}

/**
 * The menu for a partially typed word: damage types first, then active effects, then everything else
 * known, each group by relevance and then alphabetically. No group headings — the spec marks activity
 * with a dot instead, because a heading over a one-row group costs more than it explains.
 *
 * Types lead because the only line they are ever OFFERED on is a damage line (the tray hands this
 * the vocabulary that line may be told), and on a damage line the type is the thing you are missing —
 * the dice are already there. On a test line the list is effects, because there is nothing else in it.
 *
 * Matched by NAME, never by fuzzy distance: "did you mean" is right for an error message
 * (`suggestClosest`) and wrong for a live menu, where an unrelated row landing under the cursor is
 * how a wrong effect gets inserted with one Tab.
 */
export function matchCandidates(
	query: string,
	candidates: RollerCandidate[],
	limit = 8,
): RollerMatch[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const hits: (RollerMatch & { rank: number })[] = [];
	for (const candidate of candidates) {
		const rank = Math.min(...candidate.aliases.map((a) => rankOf(a, q)));
		if (rank > 2) continue;
		hits.push({ candidate, rank, at: candidate.label.toLowerCase().indexOf(q), length: q.length });
	}
	hits.sort(
		(a, b) =>
			Number(isDamageType(b.candidate)) - Number(isDamageType(a.candidate)) ||
			Number(b.candidate.active) - Number(a.candidate.active) ||
			a.rank - b.rank ||
			a.candidate.label.localeCompare(b.candidate.label),
	);
	return hits.slice(0, limit).map(({ candidate, at, length }) => ({ candidate, at, length }));
}

/** The resolver a line uses when a token is SUBMITTED: an exact name, in any language the data
 *  carries, becomes that candidate's token. Exact only — a partial word is the menu's business, and
 *  completing it here would be the guess §6 forbids. An exact name shared by two candidates is left
 *  unresolved for the same reason: the menu is still open, and picking is the player's. */
export function candidateResolver(candidates: RollerCandidate[]): RollerResolver {
	return (word) => {
		const q = word.trim().toLowerCase();
		const hits = candidates.filter((c) => c.aliases.includes(q));
		if (hits.length === 1) return hits[0]?.insert ?? null;
		// a name two candidates share is not a word the line may absorb: picking one of them would roll a
		// number the player did not ask for, so it lands as a BLOCKING pill that says which word it was
		if (hits.length > 1)
			return {
				kind: TOKEN_KIND.pill,
				pill: { kind: PILL_KIND.raw, text: word.trim(), ambiguous: true },
			};
		return null;
	};
}
