/*
 * What a character HAS, for reading — the class features their rows grant, listed rather than
 * folded. The gather in `derive-gather.ts` answers a different question and cannot answer this one:
 * it keeps only rows that carry EFFECT TOKENS, so a feature made purely of prose — which is most of
 * them — never reaches the sheet's effect list at all.
 *
 * Pure and graph-aware, no Svelte. ONE owner for the gate, because a gate written twice is a gate
 * that drifts: the level is reached, the feature belongs to this edition, and a subclass feature
 * belongs to the subclass that row actually chose.
 */
import type { ContentGraph, LoadedRow, LoadedRowByType } from '../content/loader';
import type { Character } from './schema';

/** A class row as either half of the app names it: the builder's draft, or a saved character's
 *  `build.classes` entry. The two spell the same three facts differently and nothing else here
 *  cares which one it was handed. */
export interface ClassEntryLike {
	classId: string | null;
	subclassId: string | null;
	level: number;
}

/** One class feature a row actually has, with the row it came from. */
export interface ActiveClassFeature {
	entry: ClassEntryLike;
	classRow: LoadedRowByType<'class'>;
	row: LoadedRowByType<'class_feature'>;
	level: number;
	fromSubclass: boolean;
	/** False for the look-ahead rows — what the next level or two will bring. */
	gained: boolean;
}

/**
 * Every class feature the given rows grant, under the gate the derive itself applies. Deduped by
 * (id, level, subclass) across sources, like the derive does.
 *
 * `extraLevels` is the only difference between its readers — the builder's sheet previews what the
 * next level or two will bring; a cap counts only what is in hand, and so does the play sheet.
 */
export function* activeClassFeatures(
	classes: readonly ClassEntryLike[],
	graph: ContentGraph,
	system: string,
	{ extraLevels = 0 }: { extraLevels?: number } = {},
): Generator<ActiveClassFeature> {
	const seen = new Set<string>();
	for (const entry of classes) {
		if (!entry.classId) continue;
		const classRow = graph.get(entry.classId);
		if (classRow?.type !== 'class') continue;
		const subclassRow = entry.subclassId ? graph.get(entry.subclassId) : undefined;
		const subclassId = subclassRow?.type === 'subclass' ? subclassRow.id : '';
		for (const row of graph.featuresForClass(classRow)) {
			const level = Number(row.data.level);
			if (level > entry.level + extraLevels) continue;
			if (!row.systems.includes(system)) continue;
			const forSubclass = row.data.subclass_id;
			if (forSubclass && forSubclass !== subclassId) continue;
			const key = `${row.data.id}:${level}:${forSubclass ?? ''}`;
			if (seen.has(key)) continue;
			seen.add(key);
			yield {
				entry,
				classRow,
				row,
				level,
				fromSubclass: !!forSubclass,
				gained: level <= entry.level,
			};
		}
	}
}

/** What section a feature is read under. A named member, not a bare string: the panel and the
 *  catalog both switch on it, and the sheet spec is explicit that these are SEPARATE sections and
 *  never one blob (plan.md ▸ Character sheet fields). */
export const FEATURE_SECTION = {
	classFeatures: 'classFeatures',
	speciesTraits: 'speciesTraits',
	background: 'background',
	feats: 'feats',
} as const;
export type FeatureSection = (typeof FEATURE_SECTION)[keyof typeof FEATURE_SECTION];

/** One thing a character HAS, as the sheet reads it. `row` carries its own localized name and prose,
 *  so nothing here composes a sentence; `at` is the class level a feature was gained at, absent for
 *  anything a level does not grant. */
export interface CharacterFeature {
	section: FeatureSection;
	row: LoadedRow;
	at?: number;
	/** The class that granted it, for a multiclass sheet where "level 3" alone says nothing. */
	className?: string;
}

/** Every feature, trait and feat a character has, in reading order: class features by level, then
 *  what their origin gave them. Mirrors the gather's SOURCES exactly, and deliberately not its
 *  filter — the gather keeps only rows carrying effect tokens, and a feature made of prose is still
 *  something the player must be able to read.
 *
 *  A row that no longer resolves is skipped rather than shown as a gap: an unresolved ref is already
 *  reported by the derive's own `missing` list, and saying it twice in two vocabularies helps nobody.
 */
export function characterFeatures(character: Character, graph: ContentGraph): CharacterFeature[] {
	const b = character.build;
	const out: CharacterFeature[] = [];
	const push = (section: FeatureSection, ref: string | undefined) => {
		const row = ref ? graph.get(ref) : undefined;
		if (row) out.push({ section, row });
	};

	const classes = b.classes.map((c) => ({
		classId: c.class,
		subclassId: c.subclass ?? null,
		level: c.level,
	}));
	for (const f of activeClassFeatures(classes, graph, character.system))
		out.push({
			section: FEATURE_SECTION.classFeatures,
			row: f.row,
			at: f.level,
			className: String(f.classRow.data.name_en),
		});
	out.sort((a, b2) => (a.at ?? 0) - (b2.at ?? 0));

	push(FEATURE_SECTION.speciesTraits, b.species);
	push(FEATURE_SECTION.speciesTraits, b.speciesOption);
	push(FEATURE_SECTION.background, b.background);
	for (const ref of b.feats) push(FEATURE_SECTION.feats, ref);
	return out;
}
