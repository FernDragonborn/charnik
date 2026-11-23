/** A state whose text says "ability checks" or "<Ability> checks" reaches the bare check the
 *  Abilities panel rolls, the skills built on it, and initiative — a Dexterity check in both SRDs. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from '#lib/character/schema.ts';
import { deriveSheet } from '#lib/character/derive.ts';
import type { ContentGraph } from '#lib/content/loader.ts';
import { abilityCheckRoll } from './sheet-roll-specs';
import { netAdvantage, sheetRollEffects } from './roll';

const editions = [
	{ system: '5e', source: 'SRD 5.1', pack: 'srd-2014' },
	{ system: '5.5e', source: 'SRD 5.2.1', pack: 'srd-2024' },
] as const;

describe.each(editions)(
	'a bare ability check under a state · $system',
	({ system, source, pack }) => {
		let graph: ContentGraph;
		beforeAll(async () => {
			graph = await loadPacks(pack);
		});

		/** What a state does to two d20s: the one a tap on the STR tile of the Abilities panel rolls, and
		 *  a roll the same state's own row is known to reach — the proof that the state is on. */
		const under = (state: string, control: string): { check: number; control: number } => {
			const character: Character = newCharacter('check_probe', 'Check probe', system);
			character.build.classes = [classRow({ class: `class:${source}:barbarian`, level: 3 })];
			character.play.effects = [
				{ iid: 'state', label: state, positive: false, source: state, effects: [] },
			];
			const sheet = deriveSheet(character, graph);
			const { target } = abilityCheckRoll('str', sheet);
			const key = typeof target === 'string' ? target : target.key;
			return {
				check: netAdvantage(sheetRollEffects(character, sheet, key)),
				control: netAdvantage(sheetRollEffects(character, sheet, control)),
			};
		};

		// both SRDs, Rage: "You have advantage on Strength checks and Strength saving throws"
		it('Rage gives advantage on a Strength check', () => {
			const rage = under(`effect:${source}:rage`, 'save.str');
			expect(rage.control).toBeGreaterThan(0);
			expect(rage.check).toBeGreaterThan(0);
			expect(under(`effect:${source}:rage`, 'skill.athletics').control).toBeGreaterThan(0);
			expect(under(`effect:${source}:rage`, 'skill.acrobatics').control).toBe(0);
		});

		// both SRDs, Poisoned: "disadvantage on attack rolls and ability checks"
		it('Poisoned gives disadvantage on a Strength check', () => {
			const poisoned = under(`condition:${source}:poisoned`, 'attack');
			expect(poisoned.control).toBeLessThan(0);
			expect(poisoned.check).toBeLessThan(0);
			expect(under(`condition:${source}:poisoned`, 'initiative').control).toBeLessThan(0);
		});

		// both SRDs, Frightened: "disadvantage on ability checks and attack rolls"
		it('Frightened gives disadvantage on a Strength check', () => {
			const frightened = under(`condition:${source}:frightened`, 'attack');
			expect(frightened.control).toBeLessThan(0);
			expect(frightened.check).toBeLessThan(0);
		});
	},
);
