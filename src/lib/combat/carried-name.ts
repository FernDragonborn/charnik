/*
 * What a carried row is called, on every surface that lists it — the play sheet's inventory and the
 * builder's alike, so one item is not "Longsword +2" on one screen and the book's heading on the
 * other.
 */
import type { LoadedRowOf } from '$lib/content/loader';
import { localizedName } from '$lib/content/detail';
import { instanceName, type InstanceNaming } from '$lib/content/item-instance';
import { splitList } from '$lib/content/schemas';
import type { Translate } from '$lib/i18n';
import { damageTypeLabel } from './attacks';

/** The instance's own name ("Longsword +2", "Belt of Hill Giant Strength"), else the row's — and a
 *  WORD answer said beside it, "Ring of Resistance (Fire)", since the word is the reader's vocabulary
 *  rather than a name the content gives. */
export function carriedName(
	naming: InstanceNaming,
	row: LoadedRowOf<'item'>,
	answers: { base?: string | undefined; bonus?: number | undefined; choice?: string | undefined },
	translate: Translate,
): string {
	const name = instanceName(naming, row, answers) ?? localizedName(row, naming.locale);
	const word =
		answers.choice && splitList(row.data.choice_options).includes(answers.choice)
			? damageTypeLabel(answers.choice, translate)
			: '';
	return word ? `${name} (${word})` : name;
}
