/** A Warlock multiclass pays with either kind of slot. SRD 5.1, Multiclassing ▸ Pact Magic: "you can
 *  use the spell slots you gain from the Pact Magic feature to cast spells you know or have prepared
 *  from classes with the Spellcasting class feature, and you can use the spell slots you gain from
 *  the Spellcasting class feature to cast warlock spells you know." */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { classRow, newCharacter, type Character } from '#lib/character/schema.ts';
import { deriveSheet } from '#lib/character/derive.ts';
import type { ContentGraph } from '#lib/content/loader.ts';
import { castablePactLevel, PACT_SLOT_KEY } from '#lib/rules/spellcasting.ts';
import { castSpell } from './cast';
import type { PlayContext } from './outcome';

const S = 'SRD 5.1';

describe('a Wizard 1 / Warlock 2 casting a 1st-level spell', () => {
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
	const caster = () => {
		const c = newCharacter('pact_probe', 'Pact probe', '5e');
		c.build.classes = [
			classRow({ class: `class:${S}:wizard`, level: 1 }),
			classRow({ class: `class:${S}:warlock`, level: 2 }),
		];
		c.build.abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 16 };
		return c;
	};
	const burningHands = `spell:${S}:burning_hands`;

	it('may choose a Pact Magic slot while leveled slots are left', () => {
		const c = caster();
		const pools = ctx.derive(c).spellcasting.pools;
		expect(castablePactLevel(1, pools, c.play.spellSlotsSpent)).toBe(1);
		const cast = castSpell(c, { spell: burningHands, pact: true }, ctx);
		expect(cast.refused).toBeFalsy();
		expect(cast.character.play.spellSlotsSpent).toEqual({ [PACT_SLOT_KEY]: 1 });
	});

	it('takes a Pact Magic slot once the leveled ones are spent', () => {
		const c = caster();
		c.play.spellSlotsSpent = { '1': 2 };
		const cast = castSpell(c, { spell: burningHands }, ctx);
		expect(cast.refused).toBeFalsy();
		expect(cast.character.play.spellSlotsSpent[PACT_SLOT_KEY]).toBe(1);
	});
});
