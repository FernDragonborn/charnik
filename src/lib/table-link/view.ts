/*
 * A character as the table sees it: the cut of a sheet a player's app sends to the GM's.
 *
 * The player's app derives its own sheet and sends the RESULT, traces included, so the GM's app
 * renders numbers that explain themselves and derives nothing from a peer's tokens. What is left
 * out is left out here, before anything leaves: no notes, no inventory, no build, no portrait.
 */
import type { CharacterSheet } from '$lib/character/derive';
import type { Character } from '$lib/character/schema';
import { ABILITY_IDS } from '$lib/rules/core';
import type { Computed } from '$lib/rules/pipeline';
import { hitPointMaximum } from '$lib/play/hit-points';
import { LABEL_MAX, LIST_MAX, NAME_MAX, type TableView } from './wire-schema';

/** A computed value without the clamp it was folded under, which only a re-fold reads. */
const explained = ({ value, trace, notes }: Computed): TableView['ac'] => ({
	value,
	trace,
	...(notes ? { notes } : {}),
});

const explainedEach = (values: Record<string, Computed>): Record<string, TableView['ac']> =>
	Object.fromEntries(Object.entries(values).map(([id, value]) => [id, explained(value)]));

export function tableViewOf(character: Character, sheet: CharacterSheet): TableView {
	const { play } = character;
	const abilities = Object.fromEntries(
		ABILITY_IDS.map((ability) => {
			const { score, check, save, saveProficient } = sheet.abilities[ability];
			return [
				ability,
				{ score: score.value, check: explained(check), save: explained(save), saveProficient },
			];
		}),
	) as TableView['abilities'];
	return {
		name: character.build.name.slice(0, NAME_MAX),
		system: character.system,
		level: sheet.level,
		proficiencyBonus: sheet.proficiencyBonus,
		hp: {
			current: play.hp.current,
			max: hitPointMaximum(character, sheet),
			temp: play.hp.temp,
		},
		deathSaves: { ...play.deathSaves },
		dead: !!play.death,
		exhaustion: play.exhaustion,
		concentration: play.concentration,
		conditions: [...sheet.facts.conditions],
		effects: play.effects.slice(0, LIST_MAX).map((effect) => effect.label.slice(0, LABEL_MAX)),
		ac: explained(sheet.ac),
		initiative: explained(sheet.initiative),
		speed: explained(sheet.speed),
		abilities,
		skills: explainedEach(sheet.skills),
		passives: explainedEach(sheet.passives),
		damageSensitivities: {
			resist: [...sheet.damageSensitivities.resist],
			immune: [...sheet.damageSensitivities.immune],
			vulnerable: [...sheet.damageSensitivities.vulnerable],
		},
		conditionImmunities: [...sheet.conditionImmunities],
	};
}
