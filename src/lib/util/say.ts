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
}

/** How a locale writes a candidate and the word between two of them — its own quotation marks, not
 *  the ones this file happens to type. One place, because the loader's issues and the effects
 *  module's both reach for them. */
const OR_KEY = 'contentIssue.or';
const OPTION_KEY = 'contentIssue.option';

/** A said sentence in the reader's language. Without a translator the KEY comes back, which is what
 *  a node test sees: the copy has exactly one home, and it is not the module that found the fault. */
export function sayText(text: SaidText, translate?: Translate): string {
	if (!translate) return text.key;
	const values: Record<string, string | number> = {};
	for (const [name, value] of Object.entries(text.values ?? {}))
		values[name] = typeof value === 'object' ? sayValue(value, translate) : value;
	return translate(text.key, { values });
}

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
