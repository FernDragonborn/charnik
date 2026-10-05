/*
 * Casting as an action, with no view-model, over both editions' shipped spells: a cast is paid for
 * whole or refused whole, it takes concentration and leaves its effect in one step, and its rolls
 * come back as something asked of the host.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character, classRow } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { castSpell } from './cast';
import { addEffect } from './effects';
import { PLAY_REQUEST, type PlayContext } from './outcome';

const EDITIONS = {
	'5e': { pack: 'srd-2014', source: 'SRD 5.1' },
	'5.5e': { pack: 'srd-2024', source: 'SRD 5.2.1' },
} as const;
type System = keyof typeof EDITIONS;

const graphs = {} as Record<System, ContentGraph>;
beforeAll(async () => {
	graphs['5e'] = await loadPacks('srd-2014');
	graphs['5.5e'] = await loadPacks('srd-2024');
});

describe.each(['5e', '5.5e'] as const)('cast actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const spell = (id: string) => `spell:${source}:${id}`;
	const derive = (character: Character) => deriveSheet(character, graphs[system]);
	const ctx: PlayContext = {
		derive,
		locale: 'en',
		// read when asked: the packs are loaded after this block is collected
		get graph() {
			return graphs[system];
		},
	};

	/** A caster of one class at 30 hit points, out of combat. */
	function caster(cls: string, level: number, edit: (c: Character) => void = () => {}): Character {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [classRow({ class: `class:${source}:${cls}`, level })];
		c.build.abilities = { str: 10, dex: 14, con: 12, int: 16, wis: 16, cha: 16 };
		c.play.hp = { current: 30, max: 30, temp: 0 };
		edit(c);
		return c;
	}

	it('a cast spends its slot, leaves its effect on its own clock, and asks for its rolls', () => {
		const c = caster('cleric', 5);
		const out = castSpell(c, { spell: spell('bless') }, ctx);
		expect(out.character.play.spellSlotsSpent).toEqual({ '1': 1 });
		expect(out.character.play.concentration).toBe(spell('bless'));
		expect(out.character.play.effects).toMatchObject([
			{ label: 'Bless', source: spell('bless'), durationRounds: 10, positive: true },
		]);
		expect(out.asks).toEqual([
			{ kind: PLAY_REQUEST.cast, spell: spell('bless'), ritual: false, slotLevel: 1 },
		]);
		expect(c.play.effects).toEqual([]);
	});

	it('a chosen slot is honoured or refused, never shifted down, and a refusal pays nothing', () => {
		const c = caster('cleric', 5);
		const up = castSpell(c, { spell: spell('bless'), slot: 3 }, ctx);
		expect(up.character.play.spellSlotsSpent).toEqual({ '3': 1 });
		expect(up.asks?.[0]).toMatchObject({ slotLevel: 3 });

		const none = caster('cleric', 5, (x) => (x.play.spellSlotsSpent = { '1': 9, '2': 9, '3': 9 }));
		const refused = castSpell(none, { spell: spell('bless') }, ctx);
		expect(refused.refused).toBe(true);
		expect(refused.character).toBe(none);
		expect(typeof refused.notices[0]?.text).toBe('string');
	});

	it('in combat a cast costs its casting time, and with none left nothing is spent', () => {
		const acted = caster('cleric', 5, (x) => {
			x.play.inCombat = true;
			x.play.turn = { ...x.play.turn, action: 1 };
		});
		const refused = castSpell(acted, { spell: spell('bless') }, ctx);
		expect(refused.refused).toBe(true);
		expect(refused.character.play.spellSlotsSpent).toEqual({});
	});

	it('a new concentration spell takes the old one down, in one step', () => {
		const first = castSpell(caster('cleric', 5), { spell: spell('bless') }, ctx).character;
		const second = castSpell(first, { spell: spell('shield_of_faith') }, ctx).character;
		expect(second.play.concentration).toBe(spell('shield_of_faith'));
		expect(second.play.effects.map((effect) => effect.source)).toEqual([spell('shield_of_faith')]);
	});

	it('re-casting Aid at full hit points keeps what the first cast gave', () => {
		const c = caster('cleric', 5, (x) => (x.play.hp = { current: 30, temp: 0 }));
		const max = derive(c).maxHp.value;
		const aided = castSpell(c, { spell: spell('aid') }, ctx).character;
		const full = { ...aided, play: { ...aided.play, hp: { ...aided.play.hp, current: max + 5 } } };
		const again = castSpell(full, { spell: spell('aid') }, ctx).character;
		// the old effect goes and the new one lands inside one action: no clamp in between
		expect(again.play.hp.current).toBe(max + 5);
		expect(again.play.effects).toHaveLength(1);
	});

	it('a state that forbids concentration lets the spell be cast and says it holds none', () => {
		const raging = addEffect(
			caster('cleric', 5),
			{ label: 'Rage', tokens: ['blocks_concentration'], durationRounds: 0 },
			ctx,
		).character;
		const out = castSpell(raging, { spell: spell('bless') }, ctx);
		expect(out.character.play.concentration).toBeNull();
		expect(out.notices[0]?.text).toMatchObject({ key: 'combat.notice.noConcentration' });
	});

	it('a warlock casts from the pact slot, at the pact slot’s level', () => {
		const out = castSpell(caster('warlock', 5), { spell: spell('hold_person') }, ctx);
		expect(out.character.play.spellSlotsSpent).toEqual({ [PACT_SLOT_KEY]: 1 });
		expect(out.asks?.[0]).toMatchObject({ slotLevel: 3 });
	});

	it('a ref that is no spell is refused', () => {
		const c = caster('cleric', 5);
		const out = castSpell(c, { spell: `monster:${source}:wolf` }, ctx);
		expect(out.refused).toBe(true);
		expect(out.character).toBe(c);
	});
});
