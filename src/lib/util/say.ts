/*
 * A sentence the app decided on somewhere with no locale, said later where there is one.
 *
 * The loader, the derive and the effects module all find faults in places that must stay pure and
 * locale-free, and the panel that shows them is re-read whenever the language changes — so what
 * travels is the catalog KEY and the values in it, never a finished sentence. This is the leaf both
 * sides share: the shape, and the one function that turns it into words.
 */
import type { Translate } from '$lib/i18n';

/** One value inside a said sentence: a literal (an id, a column, a count), another catalog word, or
 *  a list of candidates, which needs the reader's own "or" between them. */
export type SaidValue =
	string | number | { catalog: string; id: string } | { options: readonly string[] };

/** Which sentence, and what goes into it. */
export interface SaidText {
	key: string;
	values?: Record<string, SaidValue>;
	/** What to say when the catalog has no entry — a homebrew column's own name, title-cased. Without
	 *  one a missing key renders as the key, which is right for a sentence WE author and wrong for a
	 *  vocabulary the content is allowed to extend. */
	fallback?: string;
}

/** A word that may be the app's own vocabulary or the row's own text. A content value passes through
 *  untranslated — no catalog knows what a user's pack calls its mastery — and a `SaidText` reads from
 *  the catalog. */
export type Said = string | SaidText;

/** How a locale writes a candidate and the word between two of them — its own quotation marks, not
 *  the ones this file happens to type. One place, because the loader's issues and the effects
 *  module's both reach for them. */
const OR_KEY = 'contentIssue.or';
const OPTION_KEY = 'contentIssue.option';

/** A said sentence in the reader's language. Without a translator the KEY comes back, which is what
 *  a node test sees: the copy has exactly one home, and it is not the module that found the fault. */
export function sayText(text: SaidText, translate?: Translate): string {
	if (!translate) return text.fallback ?? text.key;
	const values: Record<string, string | number> = {};
	for (const [name, value] of Object.entries(text.values ?? {}))
		values[name] = typeof value === 'object' ? sayValue(value, translate) : value;
	return translate(text.key, { values, ...(text.fallback ? { default: text.fallback } : {}) });
}

/** Say a word that may simply be data. */
export const say = (word: Said, translate?: Translate): string =>
	typeof word === 'string' ? word : sayText(word, translate);

function sayValue(
	value: { catalog: string; id: string } | { options: readonly string[] },
	translate: Translate,
): string {
	return 'options' in value
		? value.options
				.map((option) => translate(OPTION_KEY, { values: { option }, default: `“${option}”` }))
				.join(translate(OR_KEY, { default: ' or ' }))
		: translate(`${value.catalog}.${value.id}`, { default: value.id });
}
