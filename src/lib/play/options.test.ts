/*
 * Using a feature's spend-option as an action, with no view-model, over the shipped classes: nothing
 * is paid unless everything can be, a verb that needs the host says so in `asks`, and an option is
 * reachable by its id alone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { rngSequence } from '../../test-support/rng';
import { newCharacter, type Character, classRow } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import { enterOrLeaveCombat, startNextTurn } from './events';
import { activateOption, activateOptionById, runAction } from './options';
import { PLAY_REQUEST, type PlayContext } from './outcome';
import { resourceLeft } from './resources';
import { castSpell } from './cast';
import { diceShortRest, rest } from './rests';
import { shortRestSlotGroups } from './rest-slot-recovery';
import { consumeAttackEffects, removeEffects } from './effects';
import { settlePlay } from './settle';
import { rollEffectsFor } from '$lib/combat/roll';

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

const EFFECT_ROUNDS = 10;

describe.each(['5e', '5.5e'] as const)('option actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const derive = (character: Character) => deriveSheet(character, graphs[system]);
	const ctx = (...draws: number[]): PlayContext => ({
		derive,
		locale: 'en',
		// read when asked: the packs are loaded after this block is collected
		get graph() {
			return graphs[system];
		},
		...(draws.length ? { rng: rngSequence(...draws) } : {}),
	});

	function build(cls: string, level: number, edit: (c: Character) => void = () => {}): Character {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [classRow({ class: `class:${source}:${cls}`, level })];
		c.build.abilities = { str: 14, dex: 14, con: 14, int: 10, wis: 16, cha: 10 };
		c.play.hp.current = 5;
		c.play.inCombat = true;
		c.play.round = 1;
		edit(c);
		return c;
	}
	const secondWind = (c: Character) => {
		const option = derive(c).resourceOptions.find((o) => o.resourceId === 'second_wind');
		if (!option) throw new Error('a fighter has Second Wind');
		return option;
	};

	it('Second Wind heals, and pays its use and its Bonus Action — by the option’s id alone', () => {
		const c = build('fighter', 3);
		const option = secondWind(c);
		const use = { option: option.id, resource: option.resourceId, effectRounds: EFFECT_ROUNDS };
		// a d10 landing on 6, plus the fighter's level
		const out = activateOptionById(c, use, ctx(5 / 10));
		expect(out.character.play.hp.current).toBe(5 + 6 + 3);
		expect(out.character.play.turn.bonus).toBe(1);
		expect(resourceLeft(out.character, derive(out.character), 'second_wind')).toBe(
			resourceLeft(c, derive(c), 'second_wind') - 1,
		);
		expect(out.log[0]?.name.key).toBe('combat.log.heal');
		expect(activateOptionById(c, { ...use, option: 'no_such_option' }, ctx()).refused).toBe(true);
	});

	it('nothing is paid when the turn slot is spent, the pool is empty, or the window is shut', () => {
		const option = secondWind(build('fighter', 3));
		const use = { option, effectRounds: EFFECT_ROUNDS };
		const noSlot = build('fighter', 3, (x) => (x.play.turn.bonus = 1));
		const noPool = build('fighter', 3, (x) => (x.play.resourcesSpent = { second_wind: 9 }));
		for (const blocked of [noSlot, noPool]) {
			const out = activateOption(blocked, use, ctx());
			expect(out.refused).toBe(true);
			expect(out.character).toBe(blocked);
		}
		const shut = activateOption(
			build('fighter', 3),
			{ ...use, option: { ...option, available: false } },
			ctx(),
		);
		expect(shut.notices[0]?.text).toMatchObject({ key: 'combat.notice.notAvailable' });
	});

	it('class reactions work without a pool and spend the reaction once', () => {
		const monk = build('monk', 4);
		const option = derive(monk).resourceOptions.find((o) => o.id === 'monk_slow_fall_reduce');
		if (!option) throw new Error('a level 4 monk has Slow Fall');
		const use = { option, effectRounds: EFFECT_ROUNDS };
		const out = activateOption(monk, use, ctx());
		expect(out.log[0]?.rolled?.total).toBe(20);
		expect(out.character.play.turn.reaction).toBe(1);
		expect(out.character.play.resourcesSpent).toEqual({});
		expect(activateOption(out.character, use, ctx()).refused).toBe(true);
	});

	it('Arcane Recovery restores only selected slot levels and spends one use', () => {
		const wizard = build('wizard', 4);
		wizard.play.spellSlotsSpent = { '1': 2, '2': 1 };
		const recovery = shortRestSlotGroups(wizard, derive(wizard), graphs[system]);
		expect(recovery[0]).toMatchObject({ id: 'arcane_recovery', budget: 2 });
		const recover = (slots: Record<string, number>) =>
			rest(wizard, { kind: 'short', choice: { recoverSlots: { arcane_recovery: slots } } }, ctx());
		expect(recover({ '1': 1, '2': 1 }).character).toBe(wizard);
		const rested = recover({ '2': 1 });
		expect(rested.character.play.spellSlotsSpent).toEqual({ '1': 2, '2': 0 });
		expect(rested.character.play.resourcesSpent.arcane_recovery).toBe(1);
		expect(shortRestSlotGroups(rested.character, derive(rested.character), graphs[system])).toEqual(
			[],
		);
	});

	it('Magical Cunning restores half the 2024 Pact Magic pool only when spent', () => {
		const warlock = build('warlock', 4);
		const option = derive(warlock).resourceOptions.find(
			(o) => o.id === 'warlock_magical_cunning_recover',
		);
		if (system === '5e') {
			expect(option).toBeUndefined();
			return;
		}
		if (!option) throw new Error('a level 4 warlock has Magical Cunning');
		const use = { option, effectRounds: EFFECT_ROUNDS };
		expect(activateOption(warlock, use, ctx()).character).toBe(warlock);
		warlock.play.spellSlotsSpent = { pact: 2 };
		const outcome = activateOption(warlock, use, ctx());
		expect(outcome.character.play.spellSlotsSpent.pact).toBe(1);
		expect(outcome.character.play.resourcesSpent.magical_cunning).toBe(1);
	});

	it('Tactical Mind spends Second Wind only if the check succeeds', () => {
		const fighter = build('fighter', 2);
		const option = derive(fighter).resourceOptions.find(
			(o) => o.id === 'fighter_tactical_mind_roll',
		);
		if (system === '5e') {
			expect(option).toBeUndefined();
			return;
		}
		if (!option) throw new Error('a level 2 fighter has Tactical Mind');
		const use = { option, effectRounds: EFFECT_ROUNDS };
		const trial = activateOption(fighter, use, ctx(0.5));
		expect(trial.asks).toEqual([{ kind: PLAY_REQUEST.confirmSpend, total: 6 }]);
		expect(trial.character).toBe(fighter);
		const out = activateOption(fighter, { ...use, confirmed: true }, ctx());
		expect(out.log).toEqual([]);
		expect(out.character.play.resourcesSpent.second_wind).toBe(1);
		expect(out.character.play.turn.bonus).toBe(0);
	});

	it('a 2014 bard can choose Song of Rest once when spending Hit Dice', () => {
		const bard = build('bard', 2);
		const choice = { healFrom: 'bard_song_of_rest' };
		const outcome = diceShortRest(bard, { ...choice, hitDice: { d8: 1 } }, ctx(0, 0));
		expect(outcome.character.play.hp.current).toBe(system === '5e' ? 9 : 8);
		expect(outcome.log.filter((line) => line.name.text === 'Song of Rest')).toHaveLength(
			system === '5e' ? 1 : 0,
		);
		const noDice = diceShortRest(bard, { ...choice, hitDice: {} }, ctx());
		expect(noDice.character.play.hp.current).toBe(5);
	});

	it('Reckless Attack scopes Strength advantage by edition and ends at the next turn', () => {
		const barbarian = build('barbarian', 2);
		const option = derive(barbarian).resourceOptions.find(
			(o) => o.id === 'barbarian_reckless_attack_enter',
		);
		if (!option) throw new Error('a level 2 barbarian has Reckless Attack');
		const active = activateOption(
			barbarian,
			{ option, effectRounds: EFFECT_ROUNDS },
			ctx(),
		).character;
		const sheet = derive(active);
		expect(
			rollEffectsFor(sheet.facts, 'attack', new Set(['melee', 'str', 'own_turn'])).advantage,
		).toBe(true);
		expect(
			rollEffectsFor(sheet.facts, 'attack', new Set(['ranged', 'str', 'own_turn'])).advantage,
		).toBe(system === '5.5e');
		expect(rollEffectsFor(sheet.facts, 'attack', new Set(['melee', 'str'])).advantage).toBe(
			system === '5.5e',
		);
		expect(sheet.incomingAttacks).toHaveLength(1);
		const next = startNextTurn(active, { effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(derive(next).incomingAttacks).toHaveLength(0);
	});

	it('Steady Aim requires no movement and consumes advantage on the next attack only', () => {
		const rogue = build('rogue', 3);
		const id = 'rogue_steady_aim_use';
		const option = derive(rogue).resourceOptions.find((o) => o.id === id);
		if (system === '5e') {
			expect(option).toBeUndefined();
			return;
		}
		if (!option) throw new Error('a level 3 rogue has Steady Aim');
		const moved = build('rogue', 3, (r) => (r.play.turn.move = 5));
		expect(derive(moved).resourceOptions.find((o) => o.id === id)?.available).toBe(false);
		const active = activateOption(rogue, { option, effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(derive(active).speed.value).toBe(0);
		expect(rollEffectsFor(derive(active).facts, 'attack').advantage).toBe(true);
		const used = consumeAttackEffects(active, ctx()).character;
		expect(rollEffectsFor(derive(used).facts, 'attack').advantage).toBe(false);
		expect(derive(used).speed.value).toBe(0);
		const next = startNextTurn(used, { effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(derive(next).speed.value).toBe(derive(rogue).speed.value);
	});

	it('Hunter’s Prey switches through rests only in 2024, where the override lives in play', () => {
		const ranger = build('ranger', 3, (c) => {
			c.build.classes = [
				classRow({
					class: `class:${source}:ranger`,
					subclass: `subclass:${source}:hunter`,
					level: 3,
				}),
			];
			c.build.options.hunter_hunters_prey = ['hunter_colossus_slayer'];
		});
		expect(derive(ranger).facts.rolls.find((roll) => roll.id === 'colossus_slayer')?.limit).toBe(
			'turn',
		);
		const choice = { options: { hunter_hunters_prey: 'hunter_horde_breaker' } };
		const rested = rest(ranger, { kind: 'short', choice }, ctx()).character;
		expect(rested.build).toEqual(ranger.build);
		expect(rested.play.restOptions?.hunter_hunters_prey).toBe(
			system === '5.5e' ? 'hunter_horde_breaker' : undefined,
		);
		expect(derive(rested).resourceOptions.some((o) => o.id === 'hunter_horde_breaker_attack')).toBe(
			system === '5.5e',
		);
	});

	it('Frenzy follows the berserker’s edition', () => {
		const id = system === '5e' ? 'pathoftheberserker' : 'path_of_the_berserker';
		const barbarian = build('barbarian', 3, (c) => {
			c.build.classes = [
				classRow({
					class: `class:${source}:barbarian`,
					subclass: `subclass:${source}:${id}`,
					level: 3,
				}),
			];
		});
		const use = (c: Character, id: string) => {
			const option = derive(c).resourceOptions.find((candidate) => candidate.id === id);
			if (!option) throw new Error(`missing ${id}`);
			return activateOption(c, { option, effectRounds: EFFECT_ROUNDS }, ctx()).character;
		};
		if (system === '5.5e') {
			const raging = use(barbarian, 'barbarian_rage_enter');
			const reckless = use(raging, 'barbarian_reckless_attack_enter');
			expect(derive(reckless).facts.rolls.find((roll) => roll.id === 'frenzy')?.formula).toBe(
				'2d6',
			);
			return;
		}
		const active = use(barbarian, 'barbarian_frenzy_enter');
		const canAttack = (c: Character) =>
			derive(c).resourceOptions.find((o) => o.id === 'barbarian_frenzy_attack')?.available;
		expect(canAttack(active)).toBe(false);
		const next = startNextTurn(active, { effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(canAttack(next)).toBe(true);
		const rage = next.play.effects.find((effect) => effect.source?.endsWith(':rage'));
		if (!rage) throw new Error('Frenzy starts a Rage');
		const ended = removeEffects(next, [rage.iid], ctx()).character;
		expect(ended.play.exhaustion).toBe(1);
		expect(canAttack(ended)).toBe(false);
	});

	it('a Rage ends when its barbarian drops, and a 2014 Frenzy leaves its Exhaustion', () => {
		const id = system === '5e' ? 'pathoftheberserker' : 'path_of_the_berserker';
		const barbarian = build('barbarian', 3, (c) => {
			c.build.classes = [
				classRow({
					class: `class:${source}:barbarian`,
					subclass: `subclass:${source}:${id}`,
					level: 3,
				}),
			];
		});
		const enter = system === '5e' ? 'barbarian_frenzy_enter' : 'barbarian_rage_enter';
		const option = derive(barbarian).resourceOptions.find((candidate) => candidate.id === enter);
		if (!option) throw new Error(`missing ${enter}`);
		const raging = activateOption(
			barbarian,
			{ option, effectRounds: EFFECT_ROUNDS },
			ctx(),
		).character;
		const isRage = (source: string | undefined) => !!source?.endsWith(':rage');
		expect(raging.play.effects.some((effect) => isRage(effect.source))).toBe(true);
		const hp = { ...raging.play.hp, current: 0 };
		const down = settlePlay({ ...raging, play: { ...raging.play, hp } }, ctx()).character;
		expect(down.play.effects.some((effect) => isRage(effect.source))).toBe(false);
		expect(down.play.effects).toEqual([]);
		expect(down.play.exhaustion).toBe(system === '5e' ? 1 : 0);
	});

	it('uses character level and the chosen ability for spells from species traits', () => {
		const tiefling = build('fighter', 3, (c) => {
			c.build.species = `species:${source}:tiefling`;
			if (system === '5.5e') {
				c.build.speciesOption = `species_option:${source}:tiefling_infernal`;
				c.build.speciesSpellAbility = 'wis';
			}
		});
		const spell = `spell:${source}:hellish_rebuke`;
		const sheet = derive(tiefling);
		expect(sheet.spellcasting.classes[0]).toMatchObject({
			ability: system === '5e' ? 'cha' : 'wis',
			grantedSpells: expect.arrayContaining([spell, `spell:${source}:thaumaturgy`]),
		});
		expect(sheet.spellcasting.classes[0]?.grantedSpells).not.toContain(`spell:${source}:darkness`);
		expect(castSpell(tiefling, { spell }, ctx()).refused).toBe(true);
		const cast = castSpell(tiefling, { spell, pool: 'innate_hellish_rebuke' }, ctx());
		expect(cast.character.play.resourcesSpent.innate_hellish_rebuke).toBe(1);
		expect(cast.asks?.[0]).toMatchObject({ slotLevel: system === '5e' ? 2 : 1 });
		expect(cast.character.play.spellSlotsSpent).toEqual({});
	});

	it('a 2014 High Elf knows the wizard cantrip it chose, cast with Intelligence', () => {
		if (system === '5.5e') return;
		const elf = (cantrip?: string) =>
			build('fighter', 1, (c) => {
				c.build.species = `species:${source}:elf`;
				c.build.speciesOption = `species_option:${source}:high_elf`;
				if (cantrip) c.build.speciesCantrip = cantrip;
			});
		expect(derive(elf()).spellcasting.classes).toEqual([]);
		const fireBolt = `spell:${source}:fire_bolt`;
		expect(derive(elf(fireBolt)).spellcasting.classes[0]).toMatchObject({
			ability: 'int',
			grantedSpells: [fireBolt],
		});
		// a cantrip off the wizard list is no answer
		expect(derive(elf(`spell:${source}:sacred_flame`)).spellcasting.classes).toEqual([]);
	});

	it('a 2024 High Elf can replace its lineage cantrip on a long rest only', () => {
		if (system === '5e') return;
		const elf = build('fighter', 3, (c) => {
			c.build.species = `species:${source}:elf`;
			c.build.speciesOption = `species_option:${source}:elf_high_elf`;
		});
		const fireBolt = `spell:${source}:fire_bolt`;
		const original = `spell:${source}:prestidigitation`;
		const has = (c: Character, ref: string) =>
			derive(c).spellcasting.classes[0]?.grantedSpells.includes(ref);
		expect(has(elf, original)).toBe(true);
		const choice = { speciesCantrip: fireBolt };
		expect(has(rest(elf, { kind: 'short', choice }, ctx()).character, original)).toBe(true);
		const rested = rest(elf, { kind: 'long', choice }, ctx()).character;
		expect(has(rested, fireBolt)).toBe(true);
		expect(has(rested, original)).toBe(false);
	});

	it('Divine Smite follows its edition’s slot and resource rules', () => {
		const paladin = build('paladin', 2);
		const sheet = derive(paladin);
		if (system === '5.5e') {
			const spell = `spell:${source}:divine_smite`;
			expect(sheet.spellcasting.classes[0]?.grantedSpells).toContain(spell);
			const cast = castSpell(paladin, { spell, pool: 'paladins_smite' }, ctx());
			expect(cast.refused).not.toBe(true);
			expect(cast.character.play.resourcesSpent.paladins_smite).toBe(1);
			expect(cast.character.play.spellSlotsSpent).toEqual({});
			expect(
				rest(cast.character, { kind: 'long' }, ctx()).character.play.resourcesSpent.paladins_smite,
			).toBe(0);
			return;
		}
		const option = sheet.resourceOptions.find((o) => o.id === 'paladin_divine_smite_fiend_undead');
		if (!option) throw new Error('a level 2 paladin has Divine Smite');
		const use = { option, effectRounds: EFFECT_ROUNDS };
		paladin.play.spellSlotsGained = { '4': 1 };
		const asked = activateOption(paladin, use, ctx());
		expect(asked.character).toBe(paladin);
		expect(asked.asks).toEqual([{ kind: PLAY_REQUEST.slot, levels: [1, 4] }]);
		const out = activateOption(paladin, { ...use, slot: 4 }, ctx(0, 0, 0, 0, 0, 0));
		expect(out.character.play.spellSlotsSpent).toEqual({ '4': 1 });
		expect(out.log[0]?.rolled?.total).toBe(6);
	});

	it('a strike is asked of the host, capped against a typo; a form is asked BEFORE anything is paid', () => {
		const c = build('fighter', 3);
		const strikes = runAction(
			c,
			{ name: 'Flurry', action: 'attack:Unarmed_Strike:200', effectRounds: 0 },
			ctx(),
		);
		expect(strikes.character).toBe(c);
		expect(strikes.asks).toEqual([
			{ kind: PLAY_REQUEST.attack, weapon: 'unarmed_strike', count: 12, name: 'Flurry' },
		]);

		const druid = build('druid', 4);
		const wildShape = derive(druid).resourceOptions.find((o) =>
			o.action.startsWith('assume_form:'),
		);
		if (!wildShape) throw new Error('a druid assumes a form');
		const asked = activateOption(druid, { option: wildShape, effectRounds: EFFECT_ROUNDS }, ctx());
		expect(asked.asks).toEqual([{ kind: PLAY_REQUEST.form, form: 'wild_shape' }]);
		expect(asked.character).toBe(druid);

		const wolf = `monster:${source}:wolf`;
		const taken = activateOption(
			druid,
			{ option: wildShape, effectRounds: EFFECT_ROUNDS, form: { monster: wolf, label: 'Wolf' } },
			ctx(),
		).character;
		expect(taken.play.form?.monster).toBe(wolf);
		expect(taken.play.resourcesSpent.wild_shape).toBe(1);
		// an Action in 2014, a Bonus Action in 2024
		expect(taken.play.turn).toMatchObject(system === '5e' ? { action: 1 } : { bonus: 1 });
	});

	it('verbs run in order on one activation, and a named state refreshes instead of stacking', () => {
		const c = build('barbarian', 3, (x) => (x.play.resourcesSpent = { rage: 2 }));
		const run = {
			name: 'Probe',
			action: 'restore_resource:rage;gain_action;apply_effect:rage',
			effectRounds: 7,
		};
		const once = runAction(c, run, ctx()).character;
		expect(once.play.resourcesSpent.rage).toBe(0);
		expect(once.play.turn.grantedActions).toBe(1);
		const twice = runAction(once, run, ctx()).character;
		expect(twice.play.effects.filter((effect) => effect.source?.endsWith(':rage'))).toHaveLength(1);
		const missing = runAction(c, { ...run, action: 'apply_effect:no_such_state' }, ctx());
		expect(missing.notices[0]?.text).toMatchObject({ key: 'combat.notice.effectMissing' });
	});

	it('a formula that did not resolve is not rolled, and says so where it was pressed', () => {
		const c = build('fighter', 3);
		for (const verb of ['heal', 'roll']) {
			const run = { name: 'Probe', action: `${verb}:1d10+no_such_var`, effectRounds: 0 };
			const out = runAction(c, run, ctx());
			expect(out.character).toBe(c);
			expect(out.log).toEqual([]);
			expect(out.notices[0]).toMatchObject({
				text: { key: 'combat.notice.actionUnresolved', values: { name: 'Probe' } },
				description: { values: { formula: '1d10+no_such_var' } },
			});
		}
		// what the resolver writes — dice, numbers, signs, spaces — still runs
		const healed = runAction(
			c,
			{ name: 'Probe', action: 'heal: 1d4 + 2', effectRounds: 0 },
			ctx(0),
		);
		expect(healed.character.play.hp.current).toBe(5 + 1 + 2);
	});

	it("entering combat starts the fight at the clock's round, and ending a turn starts the next", () => {
		const resting = build('fighter', 3, (x) => {
			x.play.inCombat = false;
			x.play.round = 30;
		});
		const fighting = enterOrLeaveCombat(resting, { effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(fighting.play).toMatchObject({ inCombat: true, round: 30, fightStartRound: 30 });
		const spent = {
			...fighting,
			play: { ...fighting.play, turn: { ...fighting.play.turn, action: 1 } },
		};
		const next = startNextTurn(spent, { effectRounds: EFFECT_ROUNDS }, ctx()).character;
		expect(next.play.round).toBe(31);
		expect(next.play.turn.action).toBe(0);
	});

	/*
	 * SRD 5.1 ▸ Lay on Hands: "you can touch a creature and draw power from the pool to restore a
	 * number of hit points to that creature, up to the maximum amount remaining in your pool"; SRD
	 * 5.2.1 says the same, the creature "could be yourself". The app heals only its own character, so
	 * yourself and another creature are two options on one pool, and the player answers how many.
	 */
	it('Lay on Hands heals yourself by the amount answered, and another creature only spends', () => {
		const c = build('paladin', 5);
		c.build.abilities.con = 10;
		const option = (id: string) => {
			const found = derive(c).resourceOptions.find((o) => o.id === id);
			if (!found) throw new Error(`a paladin has ${id}`);
			return found;
		};
		const left = (x: Character) => resourceLeft(x, derive(x), 'lay_on_hands');
		expect(left(c)).toBe(25);
		const self = option('paladin_lay_on_hands_self');
		expect(
			activateOption(c, { option: self, effectRounds: EFFECT_ROUNDS }, ctx()).asks,
		).toMatchObject([{ kind: PLAY_REQUEST.amount, max: 25 }]);
		const healed = activateOption(
			c,
			{ option: self, effectRounds: EFFECT_ROUNDS, amount: 7 },
			ctx(),
		);
		expect(healed.character.play.hp.current).toBe(5 + 7);
		expect(left(healed.character)).toBe(18);
		const other = activateOption(
			c,
			{ option: option('paladin_lay_on_hands_other'), effectRounds: EFFECT_ROUNDS, amount: 7 },
			ctx(),
		);
		expect(other.character.play.hp.current).toBe(5);
		expect(left(other.character)).toBe(18);
	});

	it('a Channel Divinity effect is offered only to whoever has the feature that grants it', () => {
		const ids = (x: Character) => derive(x).resourceOptions.map((o) => o.id);
		const cleric = build('cleric', 6);
		expect(ids(cleric)).toContain('cleric_turn_undead');
		expect(ids(cleric).some((id) => id.includes('sacred_weapon'))).toBe(false);
		const devotion = build('paladin', 6, (x) => {
			x.build.classes = [
				classRow({
					class: `class:${source}:paladin`,
					level: 6,
					subclass: `subclass:${source}:${system === '5e' ? 'oathofdevotion' : 'oath_of_devotion'}`,
				}),
			];
		});
		expect(ids(devotion).some((id) => id.includes('sacred_weapon'))).toBe(true);
		expect(ids(devotion)).not.toContain('cleric_turn_undead');
	});

	it('Sorcery Points create a spell slot at the table’s cost', () => {
		const sorcerer = build('sorcerer', 5);
		const create = (level: number) => {
			const found = derive(sorcerer).resourceOptions.find(
				(o) => o.id === `sorcerer_create_slot_${level}`,
			);
			if (!found) throw new Error(`no slot ${level}`);
			return found;
		};
		expect([1, 2, 3, 4, 5].map((level) => create(level).cost)).toEqual([2, 3, 5, 6, 7]);
		const out = activateOption(sorcerer, { option: create(3), effectRounds: EFFECT_ROUNDS }, ctx());
		expect(out.character.play.spellSlotsGained).toMatchObject({ '3': 1 });
		expect(resourceLeft(out.character, derive(out.character), 'sorcery_points')).toBe(0);
		// SRD 5.2.1 adds a minimum sorcerer level per slot: 7 for a level 4 slot
		expect(create(4).available).toBe(system === '5e');
	});
});
