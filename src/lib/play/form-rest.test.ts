/** A long rest taken in a 2014 Wild Shape gives back the druid's own hit points, whether the form
 *  ends inside the rest or outlasts it. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { assumeForm } from './form-shift';
import { rest } from './rests';
import type { PlayContext } from './outcome';

describe('a long rest taken in a 2014 Wild Shape', () => {
	let graph: ContentGraph;
	const ctx: PlayContext = {
		derive: (character: Character) => deriveSheet(character, graph),
		locale: 'en',
		get graph() {
			return graph;
		},
	};
	beforeAll(async () => {
		graph = await loadPacks('srd-2014');
	});

	it('leaves the druid at full hit points, not at what they had before the form', () => {
		const druid = newCharacter('druid_probe', 'Druid probe', '5e');
		druid.build.classes = [classRow({ class: 'class:SRD 5.1:druid', level: 4 })];
		druid.build.abilities = { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10 };
		const ownMaximum = ctx.derive(druid).maxHp.value;
		druid.play.hp.current = 5;

		const shaped = assumeForm(
			druid,
			{ form: 'wild_shape', monster: 'monster:SRD 5.1:wolf', label: 'Wolf' },
			ctx,
		);
		expect(shaped.character.play.form?.hpBefore).toBe(5);

		// a level-4 druid's form lasts 2 hours, so the 8-hour rest outlasts it and the druid gets up
		// in their own shape — SRD 5.1, Resting ▸ Long Rest: "a character regains all lost hit points"
		const rested = rest(shaped.character, { kind: 'long' }, ctx).character;
		expect(rested.play.form).toBeNull();
		expect(rested.play.hp.current).toBe(ownMaximum);
	});

	it('restores the hit points waiting under a form that outlasts the rest', () => {
		const druid = newCharacter('archdruid_probe', 'Druid probe', '5e');
		druid.build.classes = [classRow({ class: 'class:SRD 5.1:druid', level: 18 })];
		druid.build.abilities = { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10 };
		const ownMaximum = ctx.derive(druid).maxHp.value;
		druid.play.hp.current = 5;

		const shaped = assumeForm(
			druid,
			{ form: 'wild_shape', monster: 'monster:SRD 5.1:wolf', label: 'Wolf' },
			ctx,
		);
		// nine hours of form against an eight-hour rest
		const rested = rest(shaped.character, { kind: 'long' }, ctx).character;
		expect(rested.play.form?.hpBefore).toBe(ownMaximum);
	});
});
