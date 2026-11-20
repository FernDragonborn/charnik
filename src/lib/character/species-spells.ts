import type { ContentGraph } from '$lib/content/loader';
import { grantedAtLevel } from '$lib/content/level-gate';
import { getSpellAccess } from '$lib/content/spellAccess';
import { parseToken, splitGuard } from '$lib/effects/token-parser';
import type { Ability } from '$lib/rules/core';
import type { Character } from './schema';
import type { SpellcastingClass } from './spellcasting';

function originRows(character: Character, graph: ContentGraph) {
	const species = graph.get(character.build.species ?? '');
	if (species?.type !== 'species' || !species.systems.includes(character.system)) return [];
	const option = graph.get(character.build.speciesOption ?? '');
	return option?.type === 'species_option' &&
		option.systems.includes(character.system) &&
		option.data.species_id === species.id
		? [species, option]
		: [species];
}

export function speciesCantripChoice(character: Character, graph: ContentGraph) {
	const row = originRows(character, graph).find((origin) => origin.data.swap_cantrip);
	if (!row) return;
	const caster = graph
		.list('class', { system: character.system })
		.find((entry) => entry.id === row.data.swap_cantrip_list);
	if (!caster) return;
	const access = getSpellAccess(graph).spellIdsForClass(caster.effectiveId);
	const spells = graph
		.list('spell', { system: character.system })
		.filter((spell) => spell.data.level === 0 && access.includes(spell.effectiveId));
	const current =
		spells.find(
			(spell) =>
				spell.effectiveId ===
				(character.play.speciesCantrip?.row === row.effectiveId
					? character.play.speciesCantrip.spell
					: undefined),
		) ?? spells.find((spell) => spell.id === row.data.swap_cantrip);
	return current && { row, current, spells, replaces: row.data.swap_cantrip };
}

type StatsFor = (ability: Ability, id: string) => Pick<SpellcastingClass, 'attack' | 'saveDC'>;

export function speciesCasterProfile(
	character: Character,
	graph: ContentGraph,
	level: number,
	statsFor: StatsFor,
): SpellcastingClass | undefined {
	const origin = originRows(character, graph);
	const source = origin.findLast((row) => row.data.spell_abilities?.length);
	const abilities = source?.data.spell_abilities;
	if (!source || !abilities?.length) return;
	const picked = character.build.speciesSpellAbility;
	const ability = picked && abilities.includes(picked) ? picked : abilities[0];
	if (!ability) return;
	const spells = graph.list('spell', { system: character.system });
	const swap = speciesCantripChoice(character, graph);
	const unlocked = origin.flatMap((row) => grantedAtLevel(row.data.spells, level));
	const grantedSpells = [
		...new Set(
			unlocked.flatMap((id) => {
				const spell =
					swap?.replaces === id ? swap.current : spells.find((entry) => entry.id === id);
				return spell ? [spell.effectiveId] : [];
			}),
		),
	];
	if (!grantedSpells.length) return;
	const known = spells.filter((spell) => grantedSpells.includes(spell.effectiveId));
	const cantripCap = known.filter((spell) => spell.data.level === 0).length;
	const pools = origin.flatMap((row) =>
		row.data.effects.flatMap((token) => {
			const resource = parseToken(splitGuard(token).token).resource;
			return resource?.spell ? [resource.id] : [];
		}),
	);
	return {
		classId: source.effectiveId,
		classEffectiveId: source.effectiveId,
		className: source.data.name_en,
		ability,
		...statsFor(ability, source.effectiveId),
		prepareStyle: 'known',
		cantripCap,
		preparedCap: known.length - cantripCap,
		maxSpellLevel: Math.max(0, ...known.map((entry) => entry.data.level)),
		accessSpellIds: grantedSpells,
		isPact: false,
		ritualSource: origin.findLast((row) => row.data.ritual_source)?.data.ritual_source ?? null,
		grantedSpells,
		chosenSpells: grantedSpells,
		innate: { pools, slotPolicy: source.data.spell_slots ?? 'shared' },
	};
}
