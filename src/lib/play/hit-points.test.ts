/*
 * The hit-point actions driven with no view-model and no screen: a character, an intent, and the
 * character that comes back. What the sheet's own tests cannot show is asserted here — that the
 * input is never written to, and that the rules which follow a change in hit points hold inside the
 * action rather than in whatever happened to be watching.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { rngSequence } from '../../test-support/rng';
import { newCharacter, type Character } from '$lib/character/schema';
import { deriveSheet } from '$lib/character/derive';
import type { ContentGraph } from '$lib/content/loader';
import {
	heal,
	hitPointMaximum,
	revive,
	rollConcentrationSave,
	rollDeathSave,
	setDeathSavePip,
	settleHitPoints,
	takeDamage,
} from './hit-points';
import type { PlayContext } from './outcome';

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

/** Freeze a value all the way down, so an action that writes to its input throws. */
function frozen<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		Object.values(value).forEach(frozen);
	}
	return value;
}

/** The d20 face a raw draw lands on is `1 + floor(draw * 20)`. */
const face = (n: number) => (n - 1) / 20;

describe.each(['5e', '5.5e'] as const)('hit-point actions · %s', (system) => {
	const { source } = EDITIONS[system];
	const ctx = (...draws: number[]): PlayContext => ({
		derive: (character) => deriveSheet(character, graphs[system]),
		...(draws.length ? { rng: rngSequence(...draws) } : {}),
	});
	const maxOf = (c: Character) => hitPointMaximum(c, deriveSheet(c, graphs[system]));

	/** A level-5 fighter at full hit points, frozen. */
	function fighter(edit: (c: Character) => void = () => {}): Character {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [{ class: `class:${source}:fighter`, level: 5 }];
		c.build.abilities = { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
		c.play.hp.current = maxOf(c);
		edit(c);
		return frozen(c);
	}

	it('a hit soaks temp HP first, records itself, and leaves its input alone', () => {
		const c = fighter((x) => (x.play.hp.temp = 4));
		const full = c.play.hp.current;
		const out = takeDamage(c, { parts: [{ amount: 10, type: null }], crit: false }, ctx());
		expect(out.character.play.hp).toMatchObject({ current: full - 6, temp: 0 });
		expect(out.log.map((line) => line.name.key)).toEqual(['combat.log.damageTaken']);
		expect(c.play.hp).toMatchObject({ current: full, temp: 4 });
	});

	it('a hit while concentrating leaves a save owed, at the DC the edition caps', () => {
		const spell = `spell:${source}:bless`;
		const c = fighter((x) => {
			x.play.hp = { current: 200, max: 200, temp: 0 };
			x.play.concentration = spell;
		});
		const hit = (amount: number) =>
			takeDamage(c, { parts: [{ amount, type: null }], crit: false }, ctx()).concentrationSave;
		expect(hit(6)).toEqual({ dc: 10, spell });
		expect(hit(70)).toEqual({ dc: system === '5.5e' ? 30 : 35, spell });
	});

	it('damage at 0 HP is a death-save failure, two for a critical, and the third kills', () => {
		const c = fighter((x) => {
			x.play.hp.current = 0;
			x.play.deathSaves = { successes: 0, failures: 1 };
		});
		const out = takeDamage(c, { parts: [{ amount: 1, type: null }], crit: true }, ctx());
		expect(out.character.play.deathSaves.failures).toBe(3);
		expect(out.character.play.death).toEqual({ cause: 'death_saves' });
		expect(out.notices.map((notice) => notice.text.key)).toEqual([
			'combat.notice.deathFailureFromDamage',
			'combat.notice.died',
		]);
	});

	it('a remainder as large as the maximum kills outright', () => {
		const c = fighter((x) => (x.play.hp.current = 3));
		const out = takeDamage(
			c,
			{ parts: [{ amount: 3 + maxOf(c), type: null }], crit: false },
			ctx(),
		);
		expect(out.character.play.death).toEqual({ cause: 'massive_damage' });
	});

	it('healing out of 0 HP resets the death-save track inside the action', () => {
		const c = fighter((x) => {
			x.play.hp.current = 0;
			x.play.deathSaves = { successes: 1, failures: 2 };
		});
		const out = heal(c, { amount: 5 }, ctx());
		expect(out.character.play.hp.current).toBe(5);
		expect(out.character.play.deathSaves).toEqual({ successes: 0, failures: 0 });
		expect(out.log[0]?.name.values).toEqual({ restored: 5 });
	});

	it('a death save reads the die: 20 stands you up, 1 is two failures, three successes stabilise', () => {
		const down = fighter((x) => {
			x.play.hp.current = 0;
			x.play.deathSaves = { successes: 2, failures: 1 };
		});
		const stoodUp = rollDeathSave(down, ctx(face(20))).character.play;
		expect(stoodUp.hp.current).toBe(1);
		expect(stoodUp.deathSaves).toEqual({ successes: 0, failures: 0 });

		const died = rollDeathSave(down, ctx(face(1))).character.play;
		expect(died.death).toEqual({ cause: 'death_saves' });

		const stable = rollDeathSave(down, ctx(face(12)));
		expect(stable.character.play.deathSaves).toEqual({ successes: 0, failures: 0 });
		expect(stable.character.play.hp.current).toBe(0);
		expect(stable.log[0]?.rolled?.total).toBe(12);
	});

	it('the third pip by hand means what the rolled one means', () => {
		const down = fighter((x) => {
			x.play.hp.current = 0;
			x.play.deathSaves = { successes: 2, failures: 2 };
		});
		expect(
			setDeathSavePip(down, { kind: 'successes', index: 2 }).character.play.deathSaves,
		).toEqual({ successes: 0, failures: 0 });
		expect(setDeathSavePip(down, { kind: 'failures', index: 2 }).character.play.death).toEqual({
			cause: 'death_saves',
		});
	});

	it('a missed concentration save ends the spell and takes its effect down', () => {
		const spell = `spell:${source}:bless`;
		const c = fighter((x) => {
			x.play.concentration = spell;
			x.play.effects = [{ iid: 'a', label: 'Bless', source: spell, effects: [], positive: true }];
		});
		const missed = rollConcentrationSave(c, { dc: 25 }, ctx(face(2)));
		expect(missed.character.play.concentration).toBeNull();
		expect(missed.character.play.effects).toEqual([]);
		const held = rollConcentrationSave(c, {}, ctx(face(20)));
		expect(held.character).toBe(c);
	});

	it('revival clears death, floors hit points at 1 and takes one level of exhaustion', () => {
		const c = fighter((x) => {
			x.play.hp.current = 0;
			x.play.death = { cause: 'exhaustion' };
			x.play.exhaustion = 6;
			x.play.deathSaves = { successes: 0, failures: 3 };
		});
		const play = revive(c).character.play;
		expect(play).toMatchObject({ death: null, exhaustion: 5 });
		expect(play.hp.current).toBe(1);
		expect(play.deathSaves).toEqual({ successes: 0, failures: 0 });
	});

	it('current hit points are pulled down to a maximum that dropped', () => {
		const c = fighter((x) => (x.play.hp = { current: 40, max: 12, temp: 0 }));
		const sheet = deriveSheet(c, graphs[system]);
		expect(settleHitPoints(c, sheet).play.hp.current).toBe(12);
		const level = fighter();
		expect(settleHitPoints(level, deriveSheet(level, graphs[system]))).toBe(level);
	});
});

/*
 * SRD 5.1 — "if you revert as a result of dropping to 0 hit points, any excess damage carries over
 * to your normal form." Only the 2014 form has hit points of its own.
 */
describe('hit-point actions · a hit that breaks a form', () => {
	it('carries the excess to the character, counted against their own maximum', () => {
		const wolf = 'monster:SRD 5.1:wolf';
		const c = newCharacter('fern', 'Fern', '5e');
		c.build.classes = [{ class: 'class:SRD 5.1:druid', level: 4 }];
		c.build.abilities = { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10 };
		const derive = (character: Character) => deriveSheet(character, graphs['5e']);
		const own = hitPointMaximum(c, derive(c));
		c.play.form = { id: 'wild_shape', monster: wolf, hpBefore: own };
		c.play.effects = [{ iid: 'w', label: 'Wolf', source: wolf, effects: [], positive: true }];
		c.play.hp.current = 1;
		const out = takeDamage(
			frozen(c),
			{ parts: [{ amount: 10, type: null }], crit: false },
			{ derive },
		);
		expect(out.character.play.form).toBeNull();
		expect(out.character.play.effects).toEqual([]);
		// 10 damage with 1 hit point left: revert and take 9 — and NOT clamped to the wolf's maximum
		expect(out.character.play.hp.current).toBe(own - 9);
		expect(out.notices[0]).toMatchObject({
			text: { key: 'combat.notice.formBroken' },
			description: { values: { excess: 9 } },
			rows: { name: wolf },
		});
	});
});
