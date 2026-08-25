/*
 * The bridge between the app's data and the roller's vocabulary: what a line can be told about,
 * gathered from the character's active effects, the shipped effect catalog and the damage types the
 * app can draw. Kept apart from `roller-vocabulary.ts` so THAT stays pure and testable on plain
 * objects — this is the only file in the roller that knows a content graph exists.
 */
import { get } from 'svelte/store';
import { DAMAGE_TYPES } from '$lib/components/damage-glyphs';
import type { ContentGraph } from '$lib/content/loader';
import { localesOf, namesByLocale } from '$lib/content/names';
import { FALLBACK_LOCALE, _, locale } from '$lib/i18n';
import type { NamedRollSource } from './roller-vocabulary';

/** A damage type's names: the key (which is also its English name) plus whatever the UI language
 *  calls it, so "силова" finds `force` under a Ukrainian UI. Only the ACTIVE locale, not every
 *  installed one — svelte-i18n hands out one catalog at a time, and the language you type in is the
 *  one you are reading. The caller rebuilds these on a locale switch. */
function damageTypeNames(type: string): Record<string, string> {
	const ui = get(locale) ?? FALLBACK_LOCALE;
	const translate = get(_);
	return { [FALLBACK_LOCALE]: type, [ui]: translate(`damageType.${type}`, { default: type }) };
}

/** An effect currently ON the character — the play-state shape, reduced to what a roller needs. */
export interface ActiveRollSource {
	label: string;
	effects: string[];
}

/**
 * Everything a roller line can name, active effects first.
 *
 * The catalog comes from the `effect` content type — the same rows the sheet's "+" picker offers —
 * so a homebrew effect a user drops into a CSV is typeable in the roller with no code change. Damage
 * types come from the glyph list, which is the set the app can DRAW; a type it has never heard of
 * still works, it just arrives as a word the line takes at face value (see `wordPill`).
 *
 * An active effect shadows its catalog row by id, so Bless appears once — with the dot — rather than
 * twice under the same name.
 */
export function rollerSources(
	graph: ContentGraph | null,
	system: string | undefined,
	active: ActiveRollSource[],
): NamedRollSource[] {
	const rows = graph && system ? graph.list('effect', { system }) : [];
	const locales = graph ? localesOf(graph) : ['en'];
	const byName = new Map<string, NamedRollSource>();

	for (const row of rows)
		byName.set(row.id, {
			key: row.id,
			names: namesByLocale(row, locales),
			tokens: row.data.effects,
			active: false,
		});

	for (const effect of active) {
		// an effect added from the catalog carries its row's label, so matching on the name is what
		// re-unites the two — the play-state entry has no id of its own to match on
		const hit = [...byName.values()].find((s) => Object.values(s.names).includes(effect.label));
		const key = hit?.key ?? effect.label.toLowerCase();
		byName.set(key, {
			key,
			names: hit?.names ?? { en: effect.label },
			tokens: effect.effects,
			active: true,
		});
	}

	return [
		...byName.values(),
		...DAMAGE_TYPES.map((type) => ({
			key: type,
			names: damageTypeNames(type),
			tokens: [],
			active: false,
			damageType: true as const,
		})),
	];
}
