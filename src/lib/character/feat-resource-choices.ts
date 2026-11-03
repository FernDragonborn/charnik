import { rowName, type ContentGraph, type LoadedRow } from '../content/loader';
import { getSpellAccess } from '../content/spellAccess';
import type { ActiveEffect } from '../effects/token-parser';
import type { Character } from './schema';
import { featSpellGrants } from './feat-spells';

export function featResourceChoices(
	character: Character,
	graph: ContentGraph,
	feat: LoadedRow | undefined,
): NonNullable<ActiveEffect['resourceChoices']> {
	if (feat?.type !== 'feat') return [];
	const grants = featSpellGrants(feat.data.spell_choice);
	const choices: NonNullable<ActiveEffect['resourceChoices']> = [];
	for (const taken of character.build.featSpells) {
		if (taken.feat !== feat.effectiveId) continue;
		const list = graph
			.list('class', { system: character.system })
			.find((row) => row.id === taken.list);
		if (!list) continue;
		const access = getSpellAccess(graph).spellIdsForClass(list.effectiveId);
		for (const grant of grants.filter((entry) => entry.level > 0)) {
			const spells = [...new Set(taken.spells ?? [])]
				.map((ref) => graph.get(ref))
				.filter(
					(row) =>
						row?.type === 'spell' &&
						row.data.level === grant.level &&
						row.systems.includes(character.system) &&
						access.includes(row.effectiveId),
				)
				.slice(0, grant.count);
			for (const [index, spell] of spells.entries()) {
				if (!spell) continue;
				choices.push({
					key: `${taken.feat}.${taken.key}:${grant.level}:${index}`,
					spell: spell.effectiveId,
					name: rowName(spell),
				});
			}
		}
	}
	return choices;
}
