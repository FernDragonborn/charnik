/*
 * The spells a class feature gives — a Domain's, an Oath's, a Patron's — read off its `spells` column
 * and never stored, and what a character has once those join the spells they chose.
 */
import type { ContentGraph } from '../content/loader';
import { SPELLS_AS } from '../content/schemas';
import { grantedAtLevel } from '../content/level-gate';
import type { Character } from './schema';
import { activeClassFeatures } from './features';

/** The spells a class's features hand it at its level, as this edition's spell rows. */
export interface FeatureSpells {
	prepared: string[];
	list: string[];
}

export function featureSpellsFor(
	entry: Character['build']['classes'][number],
	graph: ContentGraph,
	character: Pick<Character, 'system'>,
): FeatureSpells {
	const out: FeatureSpells = { prepared: [], list: [] };
	const spells = graph.list('spell', { system: character.system });
	const asked = [{ classId: entry.class, subclassId: entry.subclass ?? null, level: entry.level }];
	for (const { row } of activeClassFeatures(asked, graph, character.system))
		for (const id of grantedAtLevel(row.data.spells, entry.level)) {
			const spell = spells.find((s) => s.id === id);
			if (spell)
				out[row.data.spells_as === SPELLS_AS.list ? 'list' : 'prepared'].push(spell.effectiveId);
		}
	return out;
}

type SpellEntry = Character['build']['spells'][number];

/**
 * The spells a character has: the ones chosen, and the ones a feature keeps always prepared — the
 * second never stored, so a subclass changed or a level lost takes them with it. A chosen spell a
 * feature now grants is always prepared too, and stops counting against the class's number. The one
 * reading every surface that lists, prepares or casts a character's spells goes through.
 */
export function spellEntries(
	character: Pick<Character, 'build'>,
	sheet: { spellcasting: { classes: readonly { grantedSpells: readonly string[] }[] } } | null,
): SpellEntry[] {
	const granted = new Set(sheet?.spellcasting.classes.flatMap((c) => c.grantedSpells) ?? []);
	const out = character.build.spells.map((entry) =>
		granted.has(entry.spell) ? { ...entry, alwaysPrepared: true } : entry,
	);
	for (const spell of granted)
		if (!out.some((entry) => entry.spell === spell))
			out.push({ spell, prepared: true, alwaysPrepared: true });
	return out;
}
