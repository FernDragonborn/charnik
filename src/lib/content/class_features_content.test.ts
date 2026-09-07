import { describe, it, expect } from 'vitest';
import { type ContentGraph } from './loader';
import { loadPacks } from '../../test-support/real-content';
import { ABILITIES, newCharacter, characterSchema, type Character } from '../character/schema';
import { deriveSheet } from '../character/derive';
import { rollEffectsFor } from '../combat/roll';
import { attackNotes, computeAttacks } from '../combat/helpers';
import { expertiseBudget, halfFeatAbilities } from '../build/derive';
import { EFFECT_KIND, parseToken, splitGuard } from '../effects/token-parser';

/*
 * Guards SHIPPED class-feature effect tokens (EFX-E4 authoring): a barbarian must derive the Rage
 * uses pool from `barbarian_rage`'s authored `grant_resource:rage:step(...)`. Pins the RAW use
 * counts per level in BOTH editions — including the 5.1-only `20->inf` → ∞ (the ∞-render case).
 * Reads the real shipped files, so a wiped/typo'd token fails here.
 */
const loadEdition = (pack: string): Promise<ContentGraph> => loadPacks(pack);

function charOf(source: string, system: '5e' | '5.5e', classId: string, level: number): Character {
	const c = newCharacter('grog', 'Grog', system);
	c.build.classes = [{ class: `class:${source}:${classId}`, level }];
	return characterSchema.parse(c);
}
const barbarian = (source: string, system: '5e' | '5.5e', level: number) =>
	charOf(source, system, 'barbarian', level);

/** How many attacks one Attack action makes, for a single-class character of that level. */
function attacksOf(
	graph: ContentGraph,
	source: string,
	system: '5e' | '5.5e',
	classId: string,
	level: number,
): number {
	return deriveSheet(charOf(source, system, classId, level), graph).attacksPerAction.value;
}

function rollFormula(
	graph: ContentGraph,
	source: string,
	system: '5e' | '5.5e',
	classId: string,
	level: number,
	rollId: string,
): string | undefined {
	const sheet = deriveSheet(charOf(source, system, classId, level), graph);
	return sheet.facts.rolls.find((r) => r.id === rollId)?.formula;
}

function rageMax(
	graph: ContentGraph,
	source: string,
	system: '5e' | '5.5e',
	level: number,
): number {
	const sheet = deriveSheet(barbarian(source, system, level), graph);
	return sheet.resources.find((r) => r.id === 'rage')?.max ?? -1;
}

describe('shipped class features · Rage resource (EFX-E4)', () => {
	it('5.5e (SRD 5.2.1): Rage uses step 1→2, 3→3, 6→4, 12→5, 17→6, capped at 6', async () => {
		const g = await loadEdition('srd-2024');
		expect(rageMax(g, 'SRD 5.2.1', '5.5e', 1)).toBe(2);
		expect(rageMax(g, 'SRD 5.2.1', '5.5e', 6)).toBe(4);
		expect(rageMax(g, 'SRD 5.2.1', '5.5e', 20)).toBe(6); // no unlimited in 2024
	});

	it('5e (SRD 5.1): same ladder but level 20 = Unlimited (∞)', async () => {
		const g = await loadEdition('srd-2014');
		expect(rageMax(g, 'SRD 5.1', '5e', 1)).toBe(2);
		expect(rageMax(g, 'SRD 5.1', '5e', 12)).toBe(5);
		expect(rageMax(g, 'SRD 5.1', '5e', 20)).toBe(Infinity); // 20->inf terminal
	});

	it('recharge per edition: 2024 Rage regains one on a short rest (short_one), 2014 on a long rest', async () => {
		const rechargeOf = (g: ContentGraph, source: string, system: '5e' | '5.5e') =>
			deriveSheet(barbarian(source, system, 3), g).resources.find((r) => r.id === 'rage')?.recharge;
		// SRD 5.2.1: "regain one expended use when you finish a Short Rest, all on a Long Rest"
		// `short_one` on disk IS "short rest, one use back" in the model (rules/recharge.ts)
		expect(rechargeOf(await loadEdition('srd-2024'), 'SRD 5.2.1', '5.5e')).toEqual({
			trigger: 'short',
			amount: '1',
		});
		// SRD 5.1: "must finish a long rest before you can rage again"
		expect(rechargeOf(await loadEdition('srd-2014'), 'SRD 5.1', '5e')).toEqual({
			trigger: 'long',
			amount: 'all',
		});
	});
});

describe('shipped class features · Persistent Rage regain at combat start', () => {
	it('5.5e: Barb 15 grants the once/long-rest gate + a restore_resource:rage option gated to combat start', async () => {
		const g = await loadEdition('srd-2024');
		const c = barbarian('SRD 5.2.1', '5.5e', 15);
		const out = deriveSheet(c, g);
		// the "once per Long Rest" gate resource
		const gate = out.resources.find((r) => r.id === 'persistent_rage');
		expect(gate?.max).toBe(1);
		expect(gate?.recharge).toEqual({ trigger: 'long', amount: 'all' });
		// the regain option restores ALL rage, spends the gate, and is greyed OUTSIDE combat
		const opt = out.resourceOptions.find((o) => o.id === 'barbarian_persistent_rage_regain');
		expect(opt?.resourceId).toBe('persistent_rage');
		expect(opt?.action).toBe('restore_resource:rage');
		expect(opt?.available).toBe(false); // not at initiative
		// at initiative (first combat round) the window opens
		c.play.inCombat = true;
		c.play.round = 1;
		const inCombat = deriveSheet(c, g).resourceOptions.find(
			(o) => o.id === 'barbarian_persistent_rage_regain',
		);
		expect(inCombat?.available).toBe(true);
	});

	it('5.5e: a barbarian below level 15 has neither the gate nor the regain option', async () => {
		const s = deriveSheet(barbarian('SRD 5.2.1', '5.5e', 5), await loadEdition('srd-2024'));
		expect(s.resources.some((r) => r.id === 'persistent_rage')).toBe(false);
		expect(s.resourceOptions.some((o) => o.id === 'barbarian_persistent_rage_regain')).toBe(false);
	});
});

describe('shipped class feature · Uncanny Metabolism MULTI-action regain at combat start', () => {
	it('5.5e: Monk 2 gets the once/long gate + a combat-start option that regains focus AND heals (MA die + level)', async () => {
		const g = await loadEdition('srd-2024');
		const c = charOf('SRD 5.2.1', '5.5e', 'monk', 2);
		const out = deriveSheet(c, g);
		const gate = out.resources.find((r) => r.id === 'uncanny_metabolism');
		expect(gate?.max).toBe(1);
		expect(gate?.recharge).toEqual({ trigger: 'long', amount: 'all' });
		// the MULTI-action: `;`-separated → regain all focus THEN heal Martial-Arts-die (d6 @ L2) + level
		const opt = out.resourceOptions.find((o) => o.id === 'monk_uncanny_metabolism_regain');
		expect(opt?.resourceId).toBe('uncanny_metabolism');
		expect(opt?.action).toBe('restore_resource:focus;heal:1d6+2');
		expect(opt?.actionType).toBe('free');
		expect(opt?.available).toBe(false); // not at initiative
		c.play.inCombat = true;
		c.play.round = 1;
		const inCombat = deriveSheet(c, g).resourceOptions.find(
			(o) => o.id === 'monk_uncanny_metabolism_regain',
		);
		expect(inCombat?.available).toBe(true);
	});

	it('5.5e: the Martial-Arts die in the multi-action heal scales with monk level (d10 + 11 at L11)', async () => {
		const opt = deriveSheet(
			charOf('SRD 5.2.1', '5.5e', 'monk', 11),
			await loadEdition('srd-2024'),
		).resourceOptions.find((o) => o.id === 'monk_uncanny_metabolism_regain');
		expect(opt?.action).toBe('restore_resource:focus;heal:1d10+11');
	});
});

describe('shipped Rage damage is scoped to Strength, per edition (RAGE-SCOPE)', () => {
	// The bonus rides the ROLL path, matched against the attack's own scopes — a weapon's tags, its
	// id, and the ability it resolved from. So the assertion is the same one the sheet makes when a
	// player presses an attack: does this bonus reach THIS attack?
	const rageDamage = (sheet: ReturnType<typeof deriveSheet>, scopes: string[]) =>
		rollEffectsFor(sheet.facts, 'damage', new Set(scopes)).flat;

	const raging = (g: ContentGraph, source: string, system: '5e' | '5.5e', level: number) => {
		const c = barbarian(source, system, level);
		c.play.effects = [
			{ iid: 'r1', label: 'Rage', effects: ['apply_condition:rage'], positive: true },
		];
		return deriveSheet(characterSchema.parse(c), g);
	};

	it('2014: "a melee weapon attack using Strength" — both halves, or nothing', async () => {
		const s = raging(await loadEdition('srd-2014'), 'SRD 5.1', '5e', 1);
		expect(rageDamage(s, ['melee', 'str', 'greataxe'])).toBe(2); // a greataxe swung with STR
		expect(rageDamage(s, ['melee', 'dex', 'rapier'])).toBe(0); // finesse taken with DEX
		expect(rageDamage(s, ['ranged', 'dex', 'shortbow'])).toBe(0); // Crawford: melee only
		expect(rageDamage(s, ['melee', 'str', 'unarmed_strike'])).toBe(2); // fists are a melee attack
	});

	it('2024: "an attack using Strength", weapon or Unarmed Strike — no melee half', async () => {
		const s = raging(await loadEdition('srd-2024'), 'SRD 5.2.1', '5.5e', 1);
		expect(rageDamage(s, ['melee', 'str', 'greataxe'])).toBe(2);
		expect(rageDamage(s, ['melee', 'dex', 'rapier'])).toBe(0);
		expect(rageDamage(s, ['melee', 'str', 'unarmed_strike'])).toBe(2);
		// a thrown weapon still resolves from Strength, and 2024 dropped the word "melee"
		expect(rageDamage(s, ['thrown', 'str', 'handaxe'])).toBe(2);
	});

	it('scales with barbarian level, and reaches no attack at all when not raging', async () => {
		const g = await loadEdition('srd-2024');
		expect(rageDamage(raging(g, 'SRD 5.2.1', '5.5e', 9), ['str'])).toBe(3);
		expect(rageDamage(raging(g, 'SRD 5.2.1', '5.5e', 16), ['str'])).toBe(4);
		const calm = deriveSheet(barbarian('SRD 5.2.1', '5.5e', 16), g);
		expect(rageDamage(calm, ['melee', 'str', 'greataxe'])).toBe(0);
	});
});

describe('shipped Rage buff · Enter Rage (N2 shape 2)', () => {
	// Derive a barbarian WITH the rage condition applied (what "Enter Rage" → apply_effect:rage does).
	const raging = (g: ContentGraph, source: string, system: '5e' | '5.5e', level: number) => {
		const c = barbarian(source, system, level);
		c.play.effects = [
			{ iid: 'r1', label: 'Rage', effects: ['apply_condition:rage'], positive: true },
		];
		return deriveSheet(characterSchema.parse(c), g);
	};

	it.each([['srd-2024', 'SRD 5.2.1', '5.5e'] as const, ['srd-2014', 'SRD 5.1', '5e'] as const])(
		'%s: a barbarian has an "Enter Rage" bonus-action option that spends a rage use',
		async (dir, source, system) => {
			const sheet = deriveSheet(barbarian(source, system, 1), await loadEdition(dir));
			const opt = sheet.resourceOptions.find((o) => o.id === 'barbarian_rage_enter');
			expect(opt?.resourceId).toBe('rage');
			expect(opt?.action).toBe('apply_effect:rage');
			expect(opt?.actionType).toBe('bonus_action');
			expect(opt?.cost).toBe(1);
		},
	);

	it.each([['srd-2024', 'SRD 5.2.1', '5.5e'] as const, ['srd-2014', 'SRD 5.1', '5e'] as const])(
		'%s: raging grants b/p/s resistance + advantage on Strength saves',
		async (dir, source, system) => {
			const s = raging(await loadEdition(dir), source, system, 1);
			expect([...s.damageSensitivities.resist].sort()).toEqual([
				'bludgeoning',
				'piercing',
				'slashing',
			]);
			expect(s.facts.advantage.some((a) => a.target === 'save.str')).toBe(true);
		},
	);

	it('5.5e: rage damage bonus scales +2 → +3 (L9) → +4 (L16) as a damage roll fact', async () => {
		const g = await loadEdition('srd-2024');
		const rageDamage = (level: number) =>
			raging(g, 'SRD 5.2.1', '5.5e', level).facts.numeric.find((f) => f.target === 'damage')
				?.amount;
		expect(rageDamage(1)).toBe(2);
		expect(rageDamage(9)).toBe(3);
		expect(rageDamage(16)).toBe(4);
	});
});

describe('shipped feat · Savage Attacker damage-reroll marker (N2)', () => {
	it('grants a data-driven `damage_reroll` fact labelled from the feat name (2024 origin feat)', async () => {
		const g = await loadEdition('srd-2024');
		const c = charOf('SRD 5.2.1', '5.5e', 'fighter', 1);
		c.build.feats = ['feat:SRD 5.2.1:savage_attacker'];
		const sheet = deriveSheet(c, g);
		// the combat layer reads THIS to offer the once-per-turn reroll; the source is the feat's own
		// name (name_en), so the button label is data-driven — no id/string hardcoded in code.
		expect(sheet.facts.damageReroll.map((d) => d.source)).toEqual(['Savage Attacker']);
	});
});

describe('shipped class feature · Perfect Focus auto-regain on initiative (regain_on_initiative)', () => {
	it('5.5e: Monk 15 carries a regain_on_initiative fact restoring Focus up to 4', async () => {
		const s = deriveSheet(charOf('SRD 5.2.1', '5.5e', 'monk', 15), await loadEdition('srd-2024'));
		expect(s.facts.initiativeRegain).toContainEqual({
			id: 'focus',
			upTo: 4,
			source: 'Perfect Focus',
		});
	});
	it('5.5e: a monk below level 15 has no initiative-regain', async () => {
		const s = deriveSheet(charOf('SRD 5.2.1', '5.5e', 'monk', 5), await loadEdition('srd-2024'));
		expect(s.facts.initiativeRegain).toEqual([]);
	});
});

/*
 * Survivor's Heroic Rally is the shipped `on_event` hook: a turn-start heal that only exists while
 * the character is Bloodied and standing. Both halves are content — the trigger and the guard — so a
 * wiped token or a reworded guard fails HERE rather than in a fight.
 */
describe('shipped class feature · Survivor / Heroic Rally (on_event turn-start heal)', () => {
	const champion = (source: string, system: '5e' | '5.5e', hp: number): Character => {
		const c = charOf(source, system, 'fighter', 18);
		const [only] = c.build.classes;
		if (only) only.subclass = `subclass:${source}:champion`;
		c.build.abilities = { str: 10, dex: 10, con: 16, int: 10, wis: 10, cha: 10 };
		c.play.hp = { current: hp, max: 100, temp: 0 };
		return c;
	};
	const hook = async (system: '5e' | '5.5e', pack: string, source: string, hp: number) =>
		deriveSheet(champion(source, system, hp), await loadEdition(pack)).facts.onEvent;

	it('5.5e: bloodied and standing → a turn-start heal of 5 + CON mod', async () => {
		expect(await hook('5.5e', 'srd-2024', 'SRD 5.2.1', 20)).toContainEqual({
			event: 'turn_start',
			action: 'heal:8',
			source: 'Survivor',
		});
	});
	it('5e: the same feature, same shape — the 2014 wording says half HP, which IS bloodied', async () => {
		expect(await hook('5e', 'srd-2014', 'SRD 5.1', 20)).toContainEqual({
			event: 'turn_start',
			action: 'heal:8',
			source: 'Survivor',
		});
	});
	it('above half HP, or down at 0, the hook is not there at all — the guard, not the executor, decides', async () => {
		expect(await hook('5.5e', 'srd-2024', 'SRD 5.2.1', 90)).toEqual([]);
		expect(await hook('5.5e', 'srd-2024', 'SRD 5.2.1', 0)).toEqual([]);
	});
});

/*
 * Bardic Inspiration is BOTH a die (grant_roll) and a uses-POOL (grant_resource) — the pool was the
 * gap that blocked Superior Inspiration. Font of Inspiration re-grants the SAME max with a faster
 * recharge, which only lands because pushResource breaks an equal-max tie on recharge generosity.
 */
describe('shipped class feature · Bardic Inspiration pool + Font of Inspiration recharge', () => {
	const bard = (source: string, system: '5e' | '5.5e', level: number, cha: number) => {
		const c = charOf(source, system, 'bard', level);
		c.build.abilities.cha = cha;
		return c;
	};
	const pool = (s: ReturnType<typeof deriveSheet>) =>
		s.resources.find((r) => r.id === 'bardic_inspiration');

	for (const [system, source, dir] of [
		['5.5e', 'SRD 5.2.1', 'srd-2024'],
		['5e', 'SRD 5.1', 'srd-2014'],
	] as const) {
		it(`${system}: uses = CHA modifier, on a LONG rest before Font of Inspiration`, async () => {
			const s = deriveSheet(bard(source, system, 4, 16), await loadEdition(dir));
			expect(pool(s)?.max).toBe(3); // CHA 16 → +3
			expect(pool(s)?.recharge).toEqual({ trigger: 'long', amount: 'all' });
		});

		it(`${system}: minimum ONE use even with a negative CHA modifier`, async () => {
			const s = deriveSheet(bard(source, system, 4, 8), await loadEdition(dir));
			expect(pool(s)?.max).toBe(1); // RAW "minimum of once", not −1
		});

		it(`${system}: Font of Inspiration (level 5) flips the recharge to SHORT at the same max`, async () => {
			const s = deriveSheet(bard(source, system, 5, 16), await loadEdition(dir));
			expect(pool(s)?.max).toBe(3); // unchanged — the feature only changes recovery
			expect(pool(s)?.recharge).toEqual({ trigger: 'short', amount: 'all' });
		});
	}

	it('5.5e: Superior Inspiration (18) regains up to TWO on initiative', async () => {
		const s = deriveSheet(bard('SRD 5.2.1', '5.5e', 18, 16), await loadEdition('srd-2024'));
		expect(s.facts.initiativeRegain).toContainEqual({
			id: 'bardic_inspiration',
			upTo: 2,
			source: 'Superior Inspiration',
		});
	});

	it('5e: Superior Inspiration (20) regains up to ONE — "if you have none left, regain one"', async () => {
		const s = deriveSheet(bard('SRD 5.1', '5e', 20, 16), await loadEdition('srd-2014'));
		expect(s.facts.initiativeRegain).toContainEqual({
			id: 'bardic_inspiration',
			upTo: 1,
			source: 'Superior Inspiration',
		});
	});
});

describe('shipped feature rollables · grant_roll scaling dice (EFX-E4/ROLL)', () => {
	it('5.5e: Sneak Attack Nd6, Bardic Inspiration + Martial Arts dice scale by class level', async () => {
		const g = await loadEdition('srd-2024');
		expect(rollFormula(g, 'SRD 5.2.1', '5.5e', 'rogue', 6, 'sneak_attack')).toBe('3d6'); // ceil(6/2)
		expect(rollFormula(g, 'SRD 5.2.1', '5.5e', 'bard', 5, 'bardic_inspiration')).toBe('1d8');
		expect(rollFormula(g, 'SRD 5.2.1', '5.5e', 'monk', 11, 'martial_arts')).toBe('1d10'); // 2024: d6-start
	});

	it('5e: Martial Arts die starts a step lower than 2024 (d4 vs d6)', async () => {
		const g = await loadEdition('srd-2014');
		expect(rollFormula(g, 'SRD 5.1', '5e', 'rogue', 20, 'sneak_attack')).toBe('10d6');
		expect(rollFormula(g, 'SRD 5.1', '5e', 'monk', 1, 'martial_arts')).toBe('1d4'); // 2014: d4-start
		expect(rollFormula(g, 'SRD 5.1', '5e', 'monk', 11, 'martial_arts')).toBe('1d8');
	});
});

describe('shipped Monk resource + spend-options (piece 3)', () => {
	it.each([
		['srd-2024', 'SRD 5.2.1', '5.5e', 'focus'] as const,
		['srd-2014', 'SRD 5.1', '5e', 'ki'] as const,
	])(
		'%s: a monk 5 has %s points = level, with Flurry/Patient/Step options at cost 1',
		async (dir, source, system, resourceId) => {
			const g = await loadEdition(dir);
			const sheet = deriveSheet(charOf(source, system, 'monk', 5), g);
			expect(sheet.resources.find((r) => r.id === resourceId)?.max).toBe(5); // = monk level
			const opts = sheet.resourceOptions.filter((o) => o.resourceId === resourceId);
			expect(opts.map((o) => o.id).sort()).toEqual([
				'flurry_of_blows',
				'patient_defense',
				'step_of_the_wind',
			]);
			expect(opts.every((o) => o.cost === 1 && o.actionType === 'bonus_action')).toBe(true);
			// UBUG-11: the option MAKES the two strikes through the ordinary attack path. A `note:` here
			// would be the shipped row describing what the app can do rather than doing it.
			expect(opts.find((o) => o.id === 'flurry_of_blows')?.action).toBe('attack:unarmed_strike:2');
		},
	);
});

describe('shipped 2024 Exhaustion ladder (EFX-EXH)', () => {
	it('scales the d20-test penalty (−2×level) and speed (−5×level) off play.exhaustion', async () => {
		const g = await loadEdition('srd-2024');
		const at = (level: number) => {
			const c = barbarian('SRD 5.2.1', '5.5e', 5);
			c.play.exhaustion = level;
			return deriveSheet(characterSchema.parse(c), g);
		};
		const base = at(0);
		const ex3 = at(3);
		// exhaustion 3 → −6 on every d20 test (a save here) and −15 ft speed (RAW 2024)
		expect(ex3.abilities.con.save.value).toBe(base.abilities.con.save.value - 6);
		expect(ex3.skills.athletics.value).toBe(base.skills.athletics.value - 6);
		expect(ex3.speed.value).toBe(base.speed.value - 15);
	});

	it('5e (SRD 5.1): cumulative ladder — L1 disadv on ability checks, L2 speed partial, L5 speed 0', async () => {
		const g = await loadEdition('srd-2014');
		const at = (level: number) => {
			const c = charOf('SRD 5.1', '5e', 'barbarian', 5);
			c.play.exhaustion = level;
			return deriveSheet(characterSchema.parse(c), g);
		};
		const base = at(0);
		// L1: disadvantage on ability checks → the passive form of a skill drops 5 (RAW ±5), speed intact
		expect(at(1).passives.athletics.value).toBe(base.passives.athletics.value - 5);
		expect(at(1).speed.value).toBe(base.speed.value); // halve is L2, not yet
		// L2: speed partial (30 → 15)
		expect(at(2).speed.value).toBe(Math.floor(base.speed.value / 2));
		// L5: speed reduced to 0 (set_override beats the L2 halve)
		expect(at(5).speed.value).toBe(0);
	});
});

describe('shipped feat effects (real content)', () => {
	it('2024 Alert adds the proficiency bonus to initiative', async () => {
		const g = await loadEdition('srd-2024');
		const sheetWith = (feats: string[]) => {
			const c = newCharacter('grog', 'Grog', '5.5e');
			c.build.classes = [{ class: 'class:SRD 5.2.1:fighter', level: 5 }]; // PB +3 at level 5
			c.build.feats = feats;
			return deriveSheet(characterSchema.parse(c), g);
		};
		const base = sheetWith([]);
		const alert = sheetWith(['feat:SRD 5.2.1:alert']);
		expect(alert.initiative.value).toBe(base.initiative.value + 3); // + proficiency bonus
	});

	it('2024 Defense fighting style grants +1 AC only while wearing armor', async () => {
		const g = await loadEdition('srd-2024');
		const ac = (feats: string[], armored: boolean) => {
			const c = newCharacter('grog', 'Grog', '5.5e');
			c.build.classes = [{ class: 'class:SRD 5.2.1:fighter', level: 1 }];
			c.build.feats = feats;
			if (armored)
				c.build.inventory = [
					{ item: 'item:SRD 5.2.1:leather_armor', qty: 1, equipped: true, attuned: false },
				];
			return deriveSheet(characterSchema.parse(c), g).ac;
		};
		const withDef = ac(['feat:SRD 5.2.1:defense'], true);
		const noDef = ac([], true);
		expect(withDef.value).toBe(noDef.value + 1); // +1 AC while armored
		expect(withDef.trace.some((t) => t.note === 'flat_bonus:ac+1')).toBe(true);
		// unarmored → the armor_type guard is false → no bonus
		const unarmored = ac(['feat:SRD 5.2.1:defense'], false);
		expect(unarmored.trace.some((t) => t.note === 'flat_bonus:ac+1')).toBe(false);
	});

	it('2024 half-feats carry their ability_choice (Grappler STR/DEX, Epic Boons any)', async () => {
		const g = await loadEdition('srd-2024');
		const choiceOf = (id: string) => {
			const row = g.get(`feat:SRD 5.2.1:${id}`);
			return row?.type === 'feat' ? halfFeatAbilities(row.data.ability_choice) : null;
		};
		expect(choiceOf('grappler')).toEqual(['str', 'dex']);
		expect(choiceOf('boon_of_combat_prowess')).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
		expect(choiceOf('alert')).toEqual([]); // not a half-feat
	});

	it('§C: Skilled carries skill_choice=3 (the choice-grant count); other feats have none', async () => {
		const g = await loadEdition('srd-2024');
		const skillChoiceOf = (id: string) => {
			const row = g.get(`feat:SRD 5.2.1:${id}`);
			return row?.type === 'feat' ? row.data.skill_choice : null;
		};
		expect(skillChoiceOf('skilled')).toBe(3);
		expect(skillChoiceOf('alert')).toBeUndefined();
	});

	it('§B: Great Weapon Fighting encodes a two-handed/versatile-melee damage floor (min_die 3)', async () => {
		const g = await loadEdition('srd-2024');
		const row = g.get('feat:SRD 5.2.1:great_weapon_fighting');
		const tokens = row?.type === 'feat' ? row.data.effects : [];
		// "treat any 1 or 2 as a 3" = min_die floor 3; the OR (two-handed OR versatile) = two AND-scoped
		// tokens (min_die takes the max of whichever matches). Both require melee.
		expect(tokens).toContain('min_die:damage:two_handed,melee:3');
		expect(tokens).toContain('min_die:damage:versatile,melee:3');
	});
});

describe('N4a · shipped expertise_slots grants (real content)', () => {
	const budgetAt =
		(g: ContentGraph, source: string, system: '5e' | '5.5e') => (classId: string, level: number) =>
			expertiseBudget(
				[{ classId: `class:${source}:${classId}`, subclassId: null, level }],
				g,
				system,
			);

	it('2024: Rogue 2@L1 +2@L6, Bard 2@L2 +2@L9, Ranger 2@L9', async () => {
		const b = budgetAt(await loadEdition('srd-2024'), 'SRD 5.2.1', '5.5e');
		expect(b('rogue', 1)).toBe(2);
		expect(b('rogue', 5)).toBe(2);
		expect(b('rogue', 6)).toBe(4);
		expect(b('bard', 2)).toBe(2);
		expect(b('bard', 9)).toBe(4);
		expect(b('ranger', 8)).toBe(0);
		expect(b('ranger', 9)).toBe(2);
	});
	it('2014: Rogue 2@L1 +2@L6, Bard 2@L3 +2@L10 (no Ranger expertise)', async () => {
		const b = budgetAt(await loadEdition('srd-2014'), 'SRD 5.1', '5e');
		expect(b('rogue', 1)).toBe(2);
		expect(b('rogue', 6)).toBe(4);
		expect(b('bard', 3)).toBe(2);
		expect(b('bard', 10)).toBe(4);
		expect(b('ranger', 20)).toBe(0);
	});
	it('a multiclass sums each class independently (Rogue 6 / Bard 10 → 4 + 4 = 8)', async () => {
		const g = await loadEdition('srd-2024');
		const budget = expertiseBudget(
			[
				{ classId: 'class:SRD 5.2.1:rogue', subclassId: null, level: 6 },
				{ classId: 'class:SRD 5.2.1:bard', subclassId: null, level: 10 },
			],
			g,
			'5.5e',
		);
		expect(budget).toBe(8); // Rogue L6 (2+2) + Bard 2024 L10 (2+2)
	});
});

describe('shipped Extra Attack · the Attack action makes more than one (EXTRA-ATTACK)', () => {
	it('srd-2024: the ladder is three rows, and each RAISES the count', async () => {
		const g = await loadEdition('srd-2024');
		const fighter = (level: number) => attacksOf(g, 'SRD 5.2.1', '5.5e', 'fighter', level);
		expect([fighter(4), fighter(5), fighter(10), fighter(11), fighter(19), fighter(20)]).toEqual([
			1, 2, 2, 3, 3, 4,
		]);
	});

	it('srd-2014: the fighter carries its whole ladder in one row', async () => {
		const g = await loadEdition('srd-2014');
		const fighter = (level: number) => attacksOf(g, 'SRD 5.1', '5e', 'fighter', level);
		expect([fighter(4), fighter(5), fighter(11), fighter(20)]).toEqual([1, 2, 3, 4]);
	});

	it.each([
		['srd-2024', 'SRD 5.2.1', '5.5e', ['barbarian', 'fighter', 'monk', 'paladin', 'ranger']],
		['srd-2014', 'SRD 5.1', '5e', ['barbarian', 'fighter', 'monk', 'paladin', 'ranger']],
	] as const)(
		'%s: every class that grants it at 5 gets two attacks',
		async (dir, src, sys, ids) => {
			const g = await loadEdition(dir);
			for (const id of ids) expect([id, attacksOf(g, src, sys, id, 5)]).toEqual([id, 2]);
		},
	);

	it('does NOT stack across classes — a fighter 5 / barbarian 5 still attacks twice', async () => {
		const g = await loadEdition('srd-2024');
		const c = newCharacter('grog', 'Grog', '5.5e');
		c.build.classes = [
			{ class: 'class:SRD 5.2.1:fighter', level: 5 },
			{ class: 'class:SRD 5.2.1:barbarian', level: 5 },
		];
		expect(deriveSheet(characterSchema.parse(c), g).attacksPerAction.value).toBe(2);
	});

	it('a class that never grants it stays at one', async () => {
		const g = await loadEdition('srd-2024');
		expect(attacksOf(g, 'SRD 5.2.1', '5.5e', 'wizard', 20)).toBe(1);
	});
});

describe("shipped 2014 casting counts · read off that edition's own class tables", () => {
	// The numbers come from the SRD 5.1 class tables, so they are asserted LITERALLY here: this is
	// the failure class that passes every other gate — a parser that slips one column produces a
	// plausible ladder, and nothing but a per-class assert against the book catches it.
	const capsOf = async (classId: string, level: number) => {
		const sheet = deriveSheet(
			charOf('SRD 5.1', '5e', classId, level),
			await loadEdition('srd-2014'),
		);
		const c = sheet.spellcasting.classes[0];
		return { cantrips: c?.cantripCap, prepared: c?.preparedCap };
	};

	it('a bard reads its own table, not zero and not a formula', async () => {
		expect(await capsOf('bard', 1)).toEqual({ cantrips: 2, prepared: 4 });
		expect(await capsOf('bard', 10)).toEqual({ cantrips: 4, prepared: 14 });
		expect(await capsOf('bard', 20)).toEqual({ cantrips: 4, prepared: 22 });
	});

	it('the other known-casters carry both counts', async () => {
		expect(await capsOf('sorcerer', 1)).toEqual({ cantrips: 4, prepared: 2 });
		expect(await capsOf('sorcerer', 20)).toEqual({ cantrips: 6, prepared: 15 });
		expect(await capsOf('warlock', 1)).toEqual({ cantrips: 2, prepared: 2 });
		expect(await capsOf('warlock', 20)).toEqual({ cantrips: 4, prepared: 15 });
		// a ranger has no cantrips at all, and no spells until level 2
		expect((await capsOf('ranger', 5)).cantrips).toBe(0);
		expect((await capsOf('ranger', 5)).prepared).toBe(4);
	});

	it('a prepared caster takes its cantrips from the table and its prepared count from the formula', async () => {
		// 2014 has no "prepared spells" column — that is a 2024 invention — so the formula still owns
		// the second half, and only the cantrip cap changes here.
		expect((await capsOf('cleric', 1)).cantrips).toBe(3);
		expect((await capsOf('cleric', 10)).cantrips).toBe(5);
		expect((await capsOf('druid', 1)).cantrips).toBe(2);
		expect((await capsOf('wizard', 1)).cantrips).toBe(3);
		expect((await capsOf('wizard', 20)).cantrips).toBe(5);
	});
});

describe('shipped proficiency grants · PROF-GRANT', () => {
	/** A single-class character of that level, with the species/subrace refs a species grant needs. */
	const sheetOf = async (
		dir: string,
		src: string,
		sys: '5e' | '5.5e',
		classId: string,
		level: number,
	) => deriveSheet(charOf(src, sys, classId, level), await loadEdition(dir));

	it.each([
		['srd-2014', 'SRD 5.1', '5e' as const, 'monk_diamond_soul'],
		['srd-2024', 'SRD 5.2.1', '5.5e' as const, 'monk_disciplined_survivor'],
	])(
		'%s: a level-14 monk is proficient with EVERY save (%s) via %s',
		async (dir, src, sys, feature) => {
			// named, so the assert below cannot be satisfied by some OTHER row growing the same token
			const row = (await loadEdition(dir)).list('class_feature').find((f) => f.id === feature);
			expect(row?.data.effects).toContain('grant_proficiency:saves');
			const before = await sheetOf(dir, src, sys, 'monk', 13);
			const after = await sheetOf(dir, src, sys, 'monk', 14);
			// the monk's own two (str/dex) are proficient at 1 — the point is the other four turning on
			expect(ABILITIES.filter((a) => before.abilities[a].saveProficient)).toEqual(['str', 'dex']);
			expect(ABILITIES.every((a) => after.abilities[a].saveProficient)).toBe(true);
		},
	);

	it('2014 Slippery Mind grants Wisdom saves; 2024 grants Wisdom AND Charisma', async () => {
		const s14 = await sheetOf('srd-2014', 'SRD 5.1', '5e', 'rogue', 15);
		expect(s14.abilities.wis.saveProficient).toBe(true);
		expect(s14.abilities.cha.saveProficient).toBe(false);
		const s24 = await sheetOf('srd-2024', 'SRD 5.2.1', '5.5e', 'rogue', 15);
		expect(s24.abilities.wis.saveProficient).toBe(true);
		expect(s24.abilities.cha.saveProficient).toBe(true);
	});

	it('2014 Life Domain grants heavy armour, so plate stops blocking a cleric from casting', async () => {
		const g = await loadEdition('srd-2014');
		const cleric = (subclass?: string) => {
			const c = newCharacter('pike', 'Pike', '5e');
			c.build.classes = [
				{ class: 'class:SRD 5.1:cleric', level: 1, ...(subclass ? { subclass } : {}) },
			];
			c.build.inventory = [{ item: 'item:SRD 5.1:plate', qty: 1, equipped: true, attuned: false }];
			return deriveSheet(characterSchema.parse(c), g).spellcasting.armorBlock;
		};
		// non-vacuous: the same plate on a domainless cleric still blocks (cleric = light/medium)
		expect(cleric()?.category).toBe('heavy');
		expect(cleric('subclass:SRD 5.1:lifedomain')).toBeUndefined();
	});

	it('2014 Dwarven Combat Training makes a warhammer proficient for any class', async () => {
		const g = await loadEdition('srd-2014');
		const notesFor = (speciesId: string) => {
			const c = newCharacter('grog', 'Grog', '5e');
			c.build.classes = [{ class: 'class:SRD 5.1:wizard', level: 1 }]; // no martial weapons
			c.build.species = `species:SRD 5.1:${speciesId}`;
			c.build.inventory = [
				{ item: 'item:SRD 5.1:warhammer', qty: 1, equipped: true, attuned: false },
			];
			const parsed = characterSchema.parse(c);
			const warhammer = computeAttacks(parsed, deriveSheet(parsed, g), g).find(
				(a) => a.name === 'Warhammer',
			);
			return attackNotes(warhammer!);
		};
		expect(notesFor('human')).toContain('Not proficient'); // non-vacuous: the weapon IS gated
		expect(notesFor('dwarf')).not.toContain('Not proficient');
	});

	it.each([
		['srd-2014', 'SRD 5.1', '5e' as const],
		['srd-2024', 'SRD 5.2.1', '5.5e' as const],
	])(
		'%s: Jack of All Trades halves your proficiency onto every skill you lack',
		async (dir, src, sys) => {
			const g = await loadEdition(dir);
			const bard = (level: number) => deriveSheet(charOf(src, sys, 'bard', level), g);
			const before = bard(1);
			const after = bard(2); // Jack of All Trades arrives at 2 in both editions
			// a skill the bard has no proficiency in: none at 1, half at 2
			expect([before.skills.arcana.prof, after.skills.arcana.prof]).toEqual(['none', 'partial']);
			// PB is +2 at these levels, so half is +1 on the check — and the trace names the feature
			expect(after.skills.arcana.value - before.skills.arcana.value).toBe(1);
			expect(after.skills.arcana.trace.some((t) => t.source === 'Jack of All Trades')).toBe(true);
			// and RAW's "that doesn't already include your proficiency bonus" is the ladder's MAX, not a
			// second rule: a skill the player picked stays proficient rather than being dragged to half
			const picked = newCharacter('scanlan', 'Scanlan', sys);
			picked.build.classes = [{ class: `class:${src}:bard`, level: 2 }];
			picked.build.skills = ['athletics'];
			const sheet = deriveSheet(characterSchema.parse(picked), g);
			expect([sheet.skills.athletics.prof, sheet.skills.arcana.prof]).toEqual([
				'proficient',
				'partial',
			]);
		},
	);

	it('2014 Keen Senses and Menacing put the skill on the sheet', async () => {
		const g = await loadEdition('srd-2014');
		const of = (speciesId: string, skill: 'perception' | 'intimidation') => {
			const c = newCharacter('vax', 'Vax', '5e');
			c.build.classes = [{ class: 'class:SRD 5.1:wizard', level: 1 }];
			c.build.species = `species:SRD 5.1:${speciesId}`;
			return deriveSheet(characterSchema.parse(c), g).skills[skill].prof;
		};
		expect(of('elf', 'perception')).toBe('proficient');
		expect(of('half_orc', 'intimidation')).toBe('proficient');
	});
});

describe('shipped species options · the 2024 in-species choices', () => {
	/** A character of that species with that option chosen. */
	const sheetOf = async (speciesId: string, optionId: string) => {
		const graph = await loadPacks('srd-2024');
		const c = newCharacter('kaz', 'Kaz', '5.5e');
		c.build.classes = [{ class: 'class:SRD 5.2.1:fighter', level: 1 }];
		c.build.species = `species:SRD 5.2.1:${speciesId}`;
		c.build.speciesOption = `species_option:SRD 5.2.1:${optionId}`;
		return deriveSheet(characterSchema.parse(c), graph);
	};

	it('a draconic ancestry resists the damage type its own table column names', async () => {
		expect((await sheetOf('dragonborn', 'dragonborn_silver')).damageSensitivities.resist).toContain(
			'cold',
		);
		expect((await sheetOf('dragonborn', 'dragonborn_green')).damageSensitivities.resist).toContain(
			'poison',
		);
		// non-vacuous: a different ancestry does NOT bring the other one along
		expect(
			(await sheetOf('dragonborn', 'dragonborn_green')).damageSensitivities.resist,
		).not.toContain('cold');
	});

	it('a Giant Ancestry benefit is a pool of Proficiency-Bonus uses, back on a long rest', async () => {
		const sheet = await sheetOf('goliath', 'goliath_stones_endurance');
		expect(sheet.resources.find((r) => r.id === 'goliath_stones_endurance')).toMatchObject({
			max: 2, // PB at level 1
			recharge: { trigger: 'long' },
		});
	});

	it('every shipped species option that names a mechanic carries a KNOWN token', async () => {
		const graph = await loadPacks('srd-2024');
		for (const row of graph.list('species_option'))
			for (const raw of row.data.effects ?? [])
				expect(parseToken(raw).kind, `${row.id}: "${raw}"`).not.toBe('unknown');
	});
});

describe('shipped Reliable Talent · a rogue stops rolling under 10 where it counts', () => {
	it.each([
		['srd-2014', 'SRD 5.1', '5e' as const],
		['srd-2024', 'SRD 5.2.1', '5.5e' as const],
	])('%s: the floor applies to a proficient check and to no other', async (dir, src, sys) => {
		const graph = await loadEdition(dir);
		const c = newCharacter('vax', 'Vax', sys);
		c.build.classes = [{ class: `class:${src}:rogue`, level: 11 }];
		c.build.skills = ['stealth'];
		const sheet = deriveSheet(characterSchema.parse(c), graph);
		// the scope the roll site passes is "this check adds your proficiency bonus"
		const floorOn = (skill: string, prof: boolean) =>
			rollEffectsFor(sheet.facts, `skill.${skill}`, new Set(prof ? ['proficient'] : [])).minDie;
		expect(floorOn('stealth', true)).toBe(10);
		expect(floorOn('arcana', false)).toBeUndefined(); // untrained — RAW gives it nothing
		// and it is the ROGUE's, not everyone's
		const bard = newCharacter('scanlan', 'Scanlan', sys);
		bard.build.classes = [{ class: `class:${src}:bard`, level: 11 }];
		bard.build.skills = ['stealth'];
		const bardSheet = deriveSheet(characterSchema.parse(bard), graph);
		expect(
			rollEffectsFor(bardSheet.facts, 'skill.stealth', new Set(['proficient'])).minDie,
		).toBeUndefined();
	});
});

describe('the effect vocabulary has consumers · a kind built and never used is a mechanism nobody sees', () => {
	/** Kinds with no shipped row, and the reason each is legitimately empty. Three times this cycle a
	 *  kind was built, documented with a named example, and shipped with nothing using it — the suite
	 *  stayed green and the player saw nothing. Pinning the set turns that from a lucky find into a
	 *  failing test: gaining a user is a deliberate edit here, and LOSING the last one fails loudly. */
	const EXPECTED_WITHOUT_USERS = {
		// L3 handler references are user-authored by definition — the SRD will never carry one
		plugin: 'user-authored by definition',
		// RAW almost never auto-SUCCEEDS; its mirror `auto_fail` has 16 users, all conditions
		auto_succeed: 'RAW forces failure, not success',
		// its only SRD consumer is 2014 Great Weapon Fighting ("reroll the die and must use the new
		// roll" — genuinely NOT 2024's `min_die`), and 2014 fighting styles are prose inside one
		// class-feature row rather than rows of their own, so there is nothing to author it onto
		reroll: '2014 fighting styles are not rows yet',
	};

	it('every other kind in the vocabulary has at least one shipped row', async () => {
		const used = new Set<string>();
		for (const dir of ['srd-2014', 'srd-2024']) {
			const graph = await loadPacks(dir);
			for (const row of graph.rows)
				for (const raw of (row.data as { effects?: string[] }).effects ?? [])
					used.add(parseToken(splitGuard(raw).token).kind);
		}
		const unused = Object.values(EFFECT_KIND)
			.filter((k) => !used.has(k))
			.sort();
		expect(unused).toEqual(Object.keys(EXPECTED_WITHOUT_USERS).sort());
	});
});
