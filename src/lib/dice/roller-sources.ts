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
import { FALLBACK_LOCALE, LOCALES, json } from '$lib/i18n';
import { ADVANTAGE_MODE, type AdvantageMode } from '$lib/rules/dice';
import type { NamedRollSource } from './roller-vocabulary';

/** What every installed language calls this thing, keyed by locale — the same whole-map shape a
 *  content row carries. EVERY locale, not just the active one: the language the app is IN and the
 *  language you TYPE in are two independent choices, so "силова" has to find `force` under an English
 *  UI exactly as it does under a Ukrainian one. `startI18n` loads all the catalogs for this. */
function uiNames(english: string, messageKey: string): Record<string, string> {
	const lookup = get(json);
	const names: Record<string, string> = { [FALLBACK_LOCALE]: english };
	for (const { id } of LOCALES) {
		const text = lookup(messageKey, id);
		if (typeof text === 'string') names[id] = text;
	}
	return names;
}

/** The words that set how a line is READ. They are the parser's, not content's — but a word nothing
 *  ever offers is folklore, and "take the mode back OFF" would be folklore twice over.
 *
 *  Named in FULL, and the short spellings (`adv`, `dis`, `neut`) are deliberately not aliases: they
 *  are this app's jargon, not anything a player says, and prefix matching finds "advantage" from
 *  `adv` regardless. The parser still takes them when typed straight into a line. */
const MODES: { english: string; mode: AdvantageMode }[] = [
	{ english: 'advantage', mode: ADVANTAGE_MODE.advantage },
	{ english: 'disadvantage', mode: ADVANTAGE_MODE.disadvantage },
	{ english: 'neutral', mode: ADVANTAGE_MODE.neither },
];

/** An effect currently ON the character — the play-state shape, reduced to what a roller needs. */
export interface ActiveRollSource {
	label: string;
	effects: string[];
}

/**
 * Everything a roller line can name, active effects first.
 *
 * The catalog is the `effect` type AND the `condition` type, so a homebrew row a user drops into a
 * CSV is typeable in the roller with no code change. Both, because to a ROLL there is no difference:
 * Poisoned is disadvantage on the attack exactly as Bless is +1d4 on it, and a player reaching for
 * "poisoned" does not know which of our two CSVs it was authored in. (That the two are separate types
 * at all is the merge tracked in PLAN ▸ backlog.) A condition's own tokens are read here, not its
 * `apply_condition:` wrapper — the wrapper says "you have it", and a line wants what it DOES.
 *
 * Damage types come from the glyph list, which is the set the app can DRAW; a type it has never heard
 * of still works, it just arrives as a word the line takes at face value (see `wordPill`).
 *
 * An active effect shadows its catalog row by id, so Bless appears once — with the dot — rather than
 * twice under the same name.
 */
export function rollerSources(
	graph: ContentGraph | null,
	system: string | undefined,
	active: ActiveRollSource[],
): NamedRollSource[] {
	const rows =
		graph && system
			? [...graph.list('effect', { system }), ...graph.list('condition', { system })]
			: [];
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
			// the matched CATALOG row's tokens, not the instance's bake: an applied condition carries
			// only `apply_condition:poisoned`, which says that you have it and nothing a line can use.
			// A custom effect has no row to read, so its own tokens are all there is.
			tokens: hit?.tokens ?? effect.effects,
			active: true,
		});
	}

	return [
		...MODES.map(({ english, mode }) => ({
			key: english,
			names: uiNames(english, `roller.mode.${english}`),
			tokens: [],
			active: false,
			mode,
		})),
		...byName.values(),
		...DAMAGE_TYPES.map((type) => ({
			key: type,
			names: uiNames(type, `damageType.${type}`),
			tokens: [],
			active: false,
			damageType: true as const,
		})),
	];
}
