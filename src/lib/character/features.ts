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
import { optionsOf, readPick, type OptionRow } from '../content/options';
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
export interface ActiveClassFeature<Entry extends ClassEntryLike = ClassEntryLike> {
	entry: Entry;
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
export function* activeClassFeatures<Entry extends ClassEntryLike>(
	classes: readonly Entry[],
	graph: ContentGraph,
	system: string,
	{ extraLevels = 0 }: { extraLevels?: number } = {},
): Generator<ActiveClassFeature<Entry>> {
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

/**
 * The options a character HOLDS of one class feature, in the order they were picked. The one
 * reading of `build.options`: the gather folds these rows' tokens, the sheet lists them, and a
 * caster's rituals are read off them, so the three cannot disagree about what was chosen. An id
 * that names no row any more is left out here and reported by the gather.
 */
export function heldOptions(
	graph: ContentGraph,
	feature: LoadedRowByType<'class_feature'>,
	picks: Character['build']['options'],
): HeldOption[] {
	const stored = picks[feature.id] ?? [];
	if (!stored.length) return [];
	const offered = optionsOf(graph, feature);
	return stored.flatMap((pick) => {
		const { id, answer } = readPick(pick);
		const row = offered.find((option) => option.id === id);
		return row ? [{ row, ...(answer ? { answer } : {}) }] : [];
	});
}

/**
 * Every option one class entry holds, through the features it has reached — subclass features
 * gated to the subclass it chose. What a held option grants its class (a ritual source, an extra
 * cantrip) is read off these rows, so that reading and the sheet's listing share one gate.
 */
export function* heldClassOptions(
	entry: Character['build']['classes'][number],
	graph: ContentGraph,
	character: Pick<Character, 'system' | 'build'>,
): Generator<HeldOption> {
	const asked = [{ classId: entry.class, subclassId: entry.subclass ?? null, level: entry.level }];
	for (const f of activeClassFeatures(asked, graph, character.system))
		yield* heldOptions(graph, f.row, character.build.options);
}

/** One option held: the row, and the answer this pick of it was given where the row asks one. */
export interface HeldOption {
	row: OptionRow;
	answer?: string;
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

/** The ways a player narrows the Features panel in one press. An OPEN enum rather than a checkbox
 *  per idea: the three axes the data carries are the level a feature was gained at, the section it
 *  belongs to and the class that granted it, so a preset is a predicate over those and a fourth one
 *  is a member here rather than a new mechanism. A preset WRITES the per-feature hidden list; it
 *  never layers over it. */
export const FEATURE_PRESET = {
	/** Everything back. */
	all: 'all',
	/** Only what the highest class level granted — room to learn what you just gained. */
	newest: 'newest',
	/** Only one class's features; species, background and feats are not a class's to filter. */
	class: 'class',
} as const;
export type FeaturePreset = (typeof FEATURE_PRESET)[keyof typeof FEATURE_PRESET];

/** One thing a character HAS, as the sheet reads it. `row` carries its own localized name and prose,
 *  so nothing here composes a sentence; `at` is the class level a feature was gained at, absent for
 *  anything a level does not grant. */
export interface CharacterFeature {
	section: FeatureSection;
	row: LoadedRow;
	at?: number;
	/** The class that granted it, for a multiclass sheet where "level 3" alone says nothing. */
	className?: string;
	/** What this pick of an option was answered with — the cantrip an Agonizing Blast names. */
	answer?: LoadedRow;
}

/** What identifies one feature on the sheet — its row, and for an option taken once per answer,
 *  that answer too, since two Agonizing Blasts are two features a player pins and hides apart. */
export const featureKey = (f: CharacterFeature): string =>
	f.answer ? `${f.row.effectiveId}.${f.answer.id}` : f.row.effectiveId;

/** The row an answer names: a cantrip id, in the option's own edition. */
function answerRow(graph: ContentGraph, option: OptionRow, answer: string): LoadedRow | undefined {
	return graph
		.list('spell')
		.find((spell) => spell.id === answer && spell.systems.some((s) => option.systems.includes(s)));
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
	for (const f of activeClassFeatures(classes, graph, character.system)) {
		const className = String(f.classRow.data.name_en);
		out.push({ section: FEATURE_SECTION.classFeatures, row: f.row, at: f.level, className });
		// what was chosen of it reads as a feature of its own, straight after the feature that asked
		for (const held of heldOptions(graph, f.row, b.options)) {
			const answer = held.answer ? answerRow(graph, held.row, held.answer) : undefined;
			out.push({
				section: FEATURE_SECTION.classFeatures,
				row: held.row,
				at: f.level,
				className,
				...(answer ? { answer } : {}),
			});
		}
	}
	out.sort((a, b2) => (a.at ?? 0) - (b2.at ?? 0));

	push(FEATURE_SECTION.speciesTraits, b.species);
	push(FEATURE_SECTION.speciesTraits, b.speciesOption);
	push(FEATURE_SECTION.background, b.background);
	for (const ref of b.feats) push(FEATURE_SECTION.feats, ref);
	return out;
}
