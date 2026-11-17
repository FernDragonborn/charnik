/** 5.5e casting against the shipped pack: multiclass slots of the half-casters, which round up, and
 *  Magic Initiate's free cast for a character with no slots. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { castSpell } from './cast';
import type { PlayContext } from './outcome';

const SOURCE = 'SRD 5.2.1';
const spell = (id: string) => `spell:${SOURCE}:${id}`;

describe('5.5e casting', () => {
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

	// SRD 5.2.1, Magic Initiate ▸ Level 1 Spell: "You can cast it once without a spell slot, and you
	// regain the ability to cast it in that way when you finish a Long Rest. You can also cast the
	// spell using any spell slots you have." A Fighter has none.
	it('a Fighter with Magic Initiate casts its level 1 spell once, from the feat, then is refused', () => {
		const feat = `feat:${SOURCE}:magic_initiate`;
		const fighter = newCharacter('mi_probe', 'Magic Initiate probe', '5.5e');
		fighter.build.classes = [classRow({ class: `class:${SOURCE}:fighter`, level: 1 })];
		fighter.build.feats = [feat];
		fighter.build.featSpells = [
			{
				feat,
				key: 'origin',
				list: 'cleric',
				ability: 'wis',
				spells: [spell('guidance'), spell('sacred_flame'), spell('cure_wounds')],
			},
		];
		const sheet = ctx.derive(fighter);
		const pool = sheet.resources.find((resource) => resource.spell === spell('cure_wounds'));
		expect(pool?.max).toBe(1);
		expect(sheet.spellcasting.pools).toEqual([]);

		// the spell row's own button: a cast that names neither a pool nor a slot
		const first = castSpell(fighter, { spell: spell('cure_wounds') }, ctx);
		expect(first.refused).toBeFalsy();
		expect(first.character.play.resourcesSpent[pool?.id ?? '']).toBe(1);
		expect(castSpell(first.character, { spell: spell('cure_wounds') }, ctx).refused).toBeTruthy();
	});

	// Paladin Features and Ranger Features tables, SRD 5.2.1: each has two level 1 slots at class
	// level 1, and the derive agrees for either class alone.
	it('a Paladin 1 / Ranger 1 has spell slots', () => {
		const slotsOf = (classes: [string, number][]): number => {
			const character = newCharacter('half_probe', 'Half-caster probe', '5.5e');
			character.build.classes = classes.map(([id, level]) =>
				classRow({ class: `class:${SOURCE}:${id}`, level }),
			);
			return ctx.derive(character).spellcasting.pools.reduce((sum, pool) => sum + pool.max, 0);
		};
		expect(slotsOf([['paladin', 1]])).toBe(2);
		expect(slotsOf([['ranger', 1]])).toBe(2);
		expect(
			slotsOf([
				['paladin', 1],
				['ranger', 1],
			]),
		).toBeGreaterThan(0);
	});

	// SRD 5.2.1, Multiclassing ▸ Spellcasting ▸ Spell Slots: "Half your levels (round up) in the
	// Paladin and Ranger classes" — so Paladin 1 / Sorcerer 1 is a level 2 spellcaster
	it('a Paladin 1 / Sorcerer 1 has the slots of a level 2 spellcaster', () => {
		const slotsOf = (classes: [string, number][]): string[] => {
			const character = newCharacter('half_probe', 'Half-caster probe', '5.5e');
			character.build.classes = classes.map(([id, level]) =>
				classRow({ class: `class:${SOURCE}:${id}`, level }),
			);
			return ctx.derive(character).spellcasting.pools.map((pool) => `${pool.id}×${pool.max}`);
		};
		expect(
			slotsOf([
				['paladin', 1],
				['sorcerer', 1],
			]),
		).toEqual(slotsOf([['sorcerer', 2]]));
	});
});
