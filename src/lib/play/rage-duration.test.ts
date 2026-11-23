/** How long a 5.5e Rage runs once entered: SRD 5.2.1 lets it be kept up for ten minutes. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from '#lib/character/schema.ts';
import { deriveSheet } from '#lib/character/derive.ts';
import type { ContentGraph } from '#lib/content/loader.ts';
import { activateOptionById } from './option-activation';
import type { PlayContext } from './outcome';

/** A round is six seconds, so ten minutes is a hundred of them. */
const ROUNDS_IN_TEN_MINUTES = 100;

describe('how long a 5.5e Rage may run', () => {
	let graph: ContentGraph;
	const ctx: PlayContext = {
		derive: (character: Character) => deriveSheet(character, graph),
		locale: 'en',
		get graph() {
			return graph;
		},
	};
	beforeAll(async () => {
		graph = await loadPacks('srd-2024');
	});

	// SRD 5.2.1, Barbarian ▸ Rage ▸ Duration: "You can maintain a Rage for up to 10 minutes."
	it('the clock a Rage is entered with reaches ten minutes', () => {
		const barbarian = newCharacter('rage_probe', 'Rage probe', '5.5e');
		barbarian.build.classes = [classRow({ class: 'class:SRD 5.2.1:barbarian', level: 3 })];
		// standing: a Rage ends at 0 hit points, where a bare new character starts
		barbarian.play.hp.current = 20;
		const entered = activateOptionById(
			barbarian,
			{ option: 'barbarian_rage_enter', resource: 'rage', effectRounds: 0 },
			ctx,
		);
		const rage = entered.character.play.effects.find(
			(effect) => effect.source === 'effect:SRD 5.2.1:rage',
		);
		expect(rage).toBeDefined();
		expect(rage?.durationRounds).toBe(ROUNDS_IN_TEN_MINUTES);
	});
});
