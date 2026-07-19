import { describe, it, expect } from 'vitest';
import {
	rollEffectsFor,
	autoOutcome,
	conditionIdOf,
	effectTag,
	pipClick,
	groupEffects,
	parseResourceEffect,
	rechargeLabel,
	durationToRounds,
	netAdvantage,
	remainingRounds,
	isEffectExpired,
	type EffectInstance
} from './helpers';
import { collectFacts } from '$lib/effects/apply';

// rollEffectsFor reads the sheet's typed-facts object (D7), built from the RESOLVED effect list
// (never raw play.effects — B21); collectFacts is that one conversion.
const fx = (...tokens: string[]) => collectFacts([{ source: 'Test', layer: 'condition', tokens }]);

describe('pipClick — one click-to-set model (available left, spent right)', () => {
	it('clicking an available pip spends it + everything to its right', () => {
		expect(pipClick(0, 2, 3)).toBe(1); // [F F F] click rightmost available → 1 spent
		expect(pipClick(0, 0, 3)).toBe(3); // [F F F] click leftmost → all spent
		expect(pipClick(1, 1, 3)).toBe(2); // [F F S] click pip 1 → 2 spent
	});
	it('clicking a spent pip restores it + everything to its left', () => {
		expect(pipClick(3, 2, 3)).toBe(0); // [S S S] click rightmost spent → all restored
		expect(pipClick(3, 0, 3)).toBe(2); // [S S S] click leftmost spent → 1 restored
	});
	it('is the same formula the spell-slot handler already used (regression guard)', () => {
		const slot = (full: number, spent: number, i: number) =>
			i < full - spent ? full - i : full - i - 1;
		for (let full = 1; full <= 5; full++)
			for (let spent = 0; spent <= full; spent++)
				for (let i = 0; i < full; i++) expect(pipClick(spent, i, full)).toBe(slot(full, spent, i));
	});
});

describe('autoOutcome — forced roll result (paralyzed → auto-fail STR/DEX saves)', () => {
	it('returns fail for a matched auto_fail target, null for an unmatched roll', () => {
		expect(autoOutcome(fx('auto_fail:save.str'), 'save.str')).toBe('fail');
		expect(autoOutcome(fx('auto_fail:save.str'), 'save.dex')).toBeNull();
		expect(autoOutcome(fx('auto_fail:save.str'), 'skill.athletics')).toBeNull();
	});
	it('fans out through the `saves` group but not to skills or attacks', () => {
		expect(autoOutcome(fx('auto_fail:saves'), 'save.wis')).toBe('fail');
		expect(autoOutcome(fx('auto_fail:saves'), 'skill.stealth')).toBeNull();
	});
	it('returns succeed for auto_succeed, with auto_fail winning a contradictory pair', () => {
		expect(autoOutcome(fx('auto_succeed:save.wis'), 'save.wis')).toBe('succeed');
		expect(autoOutcome(fx('auto_fail:save.wis', 'auto_succeed:save.wis'), 'save.wis')).toBe('fail');
	});
	it('is null when no forced-outcome effect is present', () => {
		expect(autoOutcome(fx('advantage:save.dex'), 'save.dex')).toBeNull();
	});
});

describe('conditionIdOf — the condition an effect applies (G2 info channel)', () => {
	const inst = (...effects: string[]) => ({ effects });
	it('extracts the id from an apply_condition token', () => {
		expect(conditionIdOf(inst('apply_condition:prone'))).toBe('prone');
		expect(conditionIdOf(inst('flat_bonus:ac+1', 'apply_condition:frightened'))).toBe('frightened');
	});
	it('is null for an effect that applies no condition', () => {
		expect(conditionIdOf(inst('flat_bonus:ac+2'))).toBeNull();
		expect(conditionIdOf(inst())).toBeNull();
	});
});

describe('effectTag — auto_fail / auto_succeed render readably in the panel', () => {
	it('tags the forced-outcome kinds', () => {
		expect(effectTag('auto_fail:save.str')).toBe('auto-fail · STR save');
		expect(effectTag('auto_succeed:save.wis')).toBe('auto-succeed · WIS save');
	});
});

describe('rollEffectsFor — advantage + bonus dice a roll picks up', () => {
	it('adds Bless (+1d4) and Bane (−1d4) group tokens to any save', () => {
		const r = rollEffectsFor(fx('flat_bonus:saves+1d4', 'flat_bonus:saves-1d4'), 'save.dex');
		expect(r.advantage).toBe(false);
		expect(r.bonusDice).toEqual([
			{ sides: 4, count: 1, sign: 1 },
			{ sides: 4, count: 1, sign: -1 }
		]);
	});

	it('fans "skills" group advantage out to a specific skill, not to saves', () => {
		expect(rollEffectsFor(fx('advantage:skills'), 'skill.stealth').advantage).toBe(true);
		expect(rollEffectsFor(fx('advantage:skills'), 'save.dex').advantage).toBe(false);
	});

	it('matches an exact target and ignores a different one', () => {
		expect(rollEffectsFor(fx('advantage:save.dex'), 'save.dex').advantage).toBe(true);
		expect(rollEffectsFor(fx('advantage:save.dex'), 'save.con').advantage).toBe(false);
	});

	it('ignores flat numeric bonuses (those fold into the modifier, not the dice)', () => {
		expect(rollEffectsFor(fx('flat_bonus:save.dex+2'), 'save.dex').bonusDice).toEqual([]);
	});
});

describe('effectTag — readable tags for the effects panel', () => {
	it('prettifies dotted flat_bonus targets', () => {
		expect(effectTag('flat_bonus:ac+2')).toBe('AC +2');
		expect(effectTag('flat_bonus:save.dex+1')).toBe('DEX save +1');
		expect(effectTag('flat_bonus:skill.stealth-1')).toBe('Stealth −1');
	});
	it('short-forms the other vocab kinds', () => {
		expect(effectTag('set_override:ac:13')).toBe('AC = 13');
		expect(effectTag('resist_immune:resist:fire')).toBe('resist · fire');
		expect(effectTag('apply_condition:poisoned')).toBe('Poisoned');
	});
});

const eff = (over: Partial<EffectInstance> & { iid: string; label: string }): EffectInstance => ({
	effects: [],
	positive: false,
	...over
});

describe('groupEffects — Buffs / Debuffs / Resources split', () => {
	const bless = eff({
		iid: 'bless',
		label: 'Bless',
		effects: ['flat_bonus:saves+1d4'],
		positive: true
	});
	const bane = eff({
		iid: 'bane',
		label: 'Bane',
		effects: ['flat_bonus:saves-1d4'],
		positive: false
	});
	const arcane = eff({
		iid: 'ar',
		label: 'Arcane Recovery',
		effects: ['grant_resource:arcane_recovery:1:long'], // snake id (E3)
		positive: true // still lands in Resources, not Buffs
	});
	const g = groupEffects([bless, bane, arcane]);

	it('puts positive non-resource effects in buffs', () => {
		expect(g.buffs.map((e) => e.iid)).toEqual(['bless']);
	});
	it('puts negative non-resource effects in debuffs', () => {
		expect(g.debuffs.map((e) => e.iid)).toEqual(['bane']);
	});
	it('routes grant_resource effects to resources regardless of the positive flag', () => {
		expect(g.resources).toHaveLength(1);
		expect(g.resources[0]).toMatchObject({ id: 'arcane_recovery', max: 1, recharge: 'long' });
	});
});

describe('parseResourceEffect + rechargeLabel', () => {
	it('resolves a fully-specified grant_resource token', () => {
		const r = parseResourceEffect(
			eff({
				iid: 'cd',
				label: 'Channel Divinity',
				effects: ['grant_resource:channel_divinity:2:short'] // snake id (E3)
			})
		);
		expect(r).toMatchObject({
			name: 'Channel Divinity',
			id: 'channel_divinity',
			max: 2,
			recharge: 'short'
		});
	});
	it('returns null for a non-resource effect', () => {
		expect(
			parseResourceEffect(eff({ iid: 'x', label: 'Bless', effects: ['flat_bonus:ac+2'] }))
		).toBeNull();
	});
	it('labels recharges', () => {
		expect(rechargeLabel('long')).toBe('long rest');
		expect(rechargeLabel('short')).toBe('short rest');
	});
});

describe('rollEffectsFor — disadvantage + flat (EFX-1)', () => {
	it('collects disadvantage for the matching key', () => {
		const out = rollEffectsFor(fx('disadvantage:skill.stealth'), 'skill.stealth');
		expect(out.disadvantage).toBe(true);
		expect(out.advantage).toBe(false);
	});
	it('sums flat bonuses for attack/damage keys', () => {
		expect(rollEffectsFor(fx('flat_bonus:attack+2'), 'attack').flat).toBe(2);
		expect(rollEffectsFor(fx('flat_bonus:damage+2', 'flat_bonus:damage+1'), 'damage').flat).toBe(3);
	});
	it('netAdvantage: advantage and disadvantage cancel to a straight roll', () => {
		expect(netAdvantage({ advantage: true, disadvantage: false })).toBe(1);
		expect(netAdvantage({ advantage: false, disadvantage: true })).toBe(-1);
		expect(netAdvantage({ advantage: true, disadvantage: true })).toBe(0);
		expect(netAdvantage({ advantage: false, disadvantage: false })).toBe(0);
	});
});

describe('effect expiry math (EFX-4)', () => {
	const e = (durationRounds?: number, startedRound?: number): EffectInstance => ({
		iid: 'x',
		label: 'X',
		effects: [],
		positive: true,
		...(durationRounds != null ? { durationRounds } : {}),
		...(startedRound != null ? { startedRound } : {})
	});
	it('remainingRounds counts down from the start round and floors at 0', () => {
		expect(remainingRounds(e(3, 2), 2)).toBe(3);
		expect(remainingRounds(e(3, 2), 4)).toBe(1);
		expect(remainingRounds(e(3, 2), 9)).toBe(0);
		expect(remainingRounds(e(), 5)).toBeNull(); // indefinite
	});
	it('isEffectExpired flips exactly when the duration is used up', () => {
		expect(isEffectExpired(e(2, 1), 2)).toBe(false);
		expect(isEffectExpired(e(2, 1), 3)).toBe(true);
		expect(isEffectExpired(e(), 99)).toBe(false); // indefinite never expires
	});
});

describe('durationToRounds — spell duration text → rounds (1 round = 6 s)', () => {
	it('maps rounds / minutes / hours / days', () => {
		expect(durationToRounds('1 round')).toBe(1);
		expect(durationToRounds('1 minute')).toBe(10);
		expect(durationToRounds('Concentration, up to 10 minutes')).toBe(100);
		expect(durationToRounds('8 hours')).toBe(4800);
		expect(durationToRounds('1 day')).toBe(14400);
	});
	it('returns null for durations that are not round-mappable', () => {
		expect(durationToRounds('Instantaneous')).toBeNull();
		expect(durationToRounds('Until dispelled')).toBeNull();
		expect(durationToRounds('')).toBeNull();
	});
});
