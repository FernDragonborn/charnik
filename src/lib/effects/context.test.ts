import { describe, it, expect } from 'vitest';
import { makeExprContext, withSpellcastingMod, type BuildVars, type PlayVars } from './context';
import { parseToken, resolveEffectValue, EFFECT_KIND, type ActiveEffect } from './token-parser';
import { applyEffects, collectFacts, matchesTarget } from './apply';
import { computed } from '../rules/pipeline';

const build: BuildVars = {
	level: 7,
	proficiencyBonus: 3,
	abilityMods: { str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: -1 },
	abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
	classLevels: { fighter: 5, rogue: 2 },
	spellcastingMod: 0,
	baseSpeed: 30
};
const ctx = makeExprContext(build);

describe('makeExprContext · build variables', () => {
	it('resolves the build numeric vars', () => {
		expect(ctx.number('level')).toBe(7);
		expect(ctx.number('proficiency_bonus')).toBe(3);
		expect(ctx.number('dex_mod')).toBe(2);
		expect(ctx.number('str_score')).toBe(16);
		expect(ctx.number('class_level.fighter')).toBe(5);
		expect(ctx.number('base_speed')).toBe(30);
	});

	it('returns 0 for an absent class level (SPEC4), undefined for play vars omitted', () => {
		expect(ctx.number('class_level.wizard')).toBe(0);
		expect(ctx.number('resource.ki')).toBe(0); // no play state → 0
		expect(ctx.boolean('is_raging')).toBe(false);
		expect(ctx.enum('armor_type')).toBeUndefined();
	});

	it('does NOT hand back inherited Object.prototype members for hostile dotted ids', () => {
		// `class_level.constructor` etc. — a bare index would return a FUNCTION, which reads
		// truthy in guards and NaN→0 in arithmetic; own-property-or-absent keeps SPEC4 honest
		expect(ctx.number('class_level.constructor')).toBe(0);
		expect(ctx.number('class_level.__proto__')).toBe(0);
		expect(ctx.number('resource.toString')).toBe(0);
		expect(ctx.boolean('is_toString')).toBe(false);
	});
});

describe('withSpellcastingMod · per-class scoping (SPEC4)', () => {
	it('overrides only spellcasting_mod, passing every other variable through', () => {
		const scoped = withSpellcastingMod(ctx, 4);
		expect(scoped.number('spellcasting_mod')).toBe(4);
		expect(ctx.number('spellcasting_mod')).toBe(0); // base untouched
		expect(scoped.number('level')).toBe(7);
		expect(scoped.boolean('is_raging')).toBe(false);
	});

	it('reads a THUNK mod live — a later state change is reflected (the DAG relies on this)', () => {
		// the DAG mutates ability mods mid-resolve; a captured number would go stale, a thunk re-reads
		let modNow = 2;
		const scoped = withSpellcastingMod(ctx, () => modNow);
		expect(scoped.number('spellcasting_mod')).toBe(2);
		modNow = 5;
		expect(scoped.number('spellcasting_mod')).toBe(5); // re-evaluated, not frozen at 2
	});
});

describe('makeExprContext · play variables (EXPR-3 half)', () => {
	const withPlay = (over: Partial<PlayVars> = {}) =>
		makeExprContext(build, {
			hp: 10,
			hpMax: 30,
			tempHp: 4,
			exhaustion: 2,
			flags: { is_raging: true },
			conditions: new Set(['frightened']),
			resources: { ki: 3 },
			resourceMax: { ki: 6 },
			armorType: 'heavy',
			size: 'large',
			...over
		});

	it('resolves the raw play numbers and flags', () => {
		const c = withPlay();
		expect(c.number('hp')).toBe(10);
		expect(c.number('hp_max')).toBe(30);
		expect(c.number('temp_hp')).toBe(4);
		expect(c.number('exhaustion')).toBe(2);
		expect(c.boolean('is_raging')).toBe(true);
		expect(c.boolean('has_condition.frightened')).toBe(true);
		expect(c.number('resource.ki')).toBe(3);
		expect(c.number('resource_max.ki')).toBe(6);
		expect(c.enum('armor_type')).toBe('heavy');
	});

	it('computes hp_percent as a floored integer', () => {
		expect(withPlay().number('hp_percent')).toBe(33); // floor(10/30*100)
		expect(withPlay({ hp: 30 }).number('hp_percent')).toBe(100);
	});

	it('guards hp_percent against division by zero (hpMax 0 → 0, never NaN)', () => {
		expect(withPlay({ hp: 0, hpMax: 0 }).number('hp_percent')).toBe(0);
	});

	it('an absent condition / resource stays fail-closed (false / 0)', () => {
		const c = withPlay();
		expect(c.boolean('has_condition.poisoned')).toBe(false);
		expect(c.number('resource.rage')).toBe(0);
	});
});

describe('resolveEffectValue · literal vs expression', () => {
	it('passes a literal amount/dice straight through', () => {
		expect(resolveEffectValue(parseToken('flat_bonus:ac+2'), ctx)).toEqual({ amount: 2 });
		expect(resolveEffectValue(parseToken('flat_bonus:save.dex-1'), ctx)).toEqual({ amount: -1 });
		expect(resolveEffectValue(parseToken('flat_bonus:damage+1d6'), ctx)).toEqual({
			diceFormula: '1d6'
		});
	});

	it('evaluates an expression value, flooring the numeric result (5e round-down)', () => {
		expect(resolveEffectValue(parseToken('flat_bonus:ac+ceil(level/2)'), ctx)).toEqual({
			amount: 4
		});
		expect(resolveEffectValue(parseToken('flat_bonus:saves+max(1,cha_mod)'), ctx)).toEqual({
			amount: 1
		});
		// division floors at the final stat value: 7/2 = 3.5 → 3
		expect(resolveEffectValue(parseToken('flat_bonus:ac+level/2'), ctx)).toEqual({ amount: 3 });
	});

	it('evaluates a dice-count expression to a roller formula (Sneak Attack)', () => {
		// class_level.rogue = 2 → ceil(2/2)=1 → 1d6
		expect(
			resolveEffectValue(parseToken('flat_bonus:damage+ceil(class_level.rogue/2)d6'), ctx)
		).toEqual({
			diceFormula: '1d6'
		});
	});

	it('degrades a malformed expression to an error (→ inert note)', () => {
		const r = resolveEffectValue(parseToken('flat_bonus:ac+bogus_var'), ctx);
		expect(r.error).toBeTruthy();
		// and with no ctx an expression cannot resolve
		expect(resolveEffectValue(parseToken('flat_bonus:ac+level'), undefined).error).toBeTruthy();
	});

	it('handles a negated expression value', () => {
		// exhaustion is a play var → 0 here → -2*0 = 0
		expect(resolveEffectValue(parseToken('flat_bonus:speed-2*exhaustion'), ctx)).toEqual({
			amount: 0
		});
	});
});

describe('applyEffects · expression contributions fold through the seam', () => {
	it('folds a resolved expression bonus into the stat value + trace', () => {
		const base = computed([{ source: 'base', layer: 'base', op: 'add', amount: 10 }]);
		const effects: ActiveEffect[] = [
			{ source: 'Scaling Ward', layer: 'feature', tokens: ['flat_bonus:ac+ceil(level/2)'] }
		];
		const out = applyEffects('ac', base, effects, ctx);
		expect(out.value).toBe(14); // 10 + ceil(7/2)=4
		expect(out.trace.some((c) => c.source === 'Scaling Ward' && c.amount === 4)).toBe(true);
	});

	it('surfaces an unresolved expression as an inert note, not a fold', () => {
		const base = computed([{ source: 'base', layer: 'base', op: 'add', amount: 10 }]);
		const effects: ActiveEffect[] = [
			{ source: 'Broken', layer: 'feature', tokens: ['flat_bonus:ac+nope_var'] }
		];
		const out = applyEffects('ac', base, effects, ctx);
		expect(out.value).toBe(10); // unchanged
		expect(out.notes?.some((n) => n.includes('unresolved'))).toBe(true);
	});
});

describe('collectFacts · resource pools with expression max (Ki = monk level)', () => {
	it('resolves a computed pool max against the ctx', () => {
		const monkCtx = makeExprContext({ ...build, classLevels: { monk: 6 } });
		const effects: ActiveEffect[] = [
			{ source: 'Monk', layer: 'feature', tokens: ['grant_resource:ki:class_level.monk:short'] }
		];
		const res = collectFacts(effects, monkCtx).resources;
		expect(res).toHaveLength(1);
		expect(res[0]).toMatchObject({ id: 'ki', max: 6, recharge: 'short' });
	});

	it('keeps a literal-max pool working (backward compatible)', () => {
		const effects: ActiveEffect[] = [
			{ source: 'Barbarian', layer: 'feature', tokens: ['grant_resource:rage:3:long'] }
		];
		expect(collectFacts(effects, ctx).resources[0]).toMatchObject({
			id: 'rage',
			max: 3,
			recharge: 'long'
		});
	});
});

describe('L1 · d20_tests group target', () => {
	it('fans out to every d20-based roll but not to non-rolls', () => {
		expect(matchesTarget('d20_tests', 'save.str')).toBe(true);
		expect(matchesTarget('d20_tests', 'skill.stealth')).toBe(true);
		expect(matchesTarget('d20_tests', 'attack')).toBe(true);
		expect(matchesTarget('d20_tests', 'initiative')).toBe(true);
		expect(matchesTarget('d20_tests', 'ac')).toBe(false);
		expect(matchesTarget('d20_tests', 'speed')).toBe(false);
		expect(matchesTarget('d20_tests', 'passive.perception')).toBe(false);
	});

	it('applies a uniform 2024-exhaustion penalty to all d20 tests via one token', () => {
		const exhaustedCtx = makeExprContext(build, {
			hp: 10,
			hpMax: 30,
			tempHp: 0,
			exhaustion: 3,
			flags: {},
			conditions: new Set(),
			resources: {},
			resourceMax: {},
			armorType: 'none',
			size: 'medium'
		});
		const effects: ActiveEffect[] = [
			{ source: 'Exhaustion', layer: 'condition', tokens: ['flat_bonus:d20_tests+(-2*exhaustion)'] }
		];
		const base = (n: number) => computed([{ source: 'b', layer: 'base', op: 'add', amount: n }]);
		expect(applyEffects('save.dex', base(5), effects, exhaustedCtx).value).toBe(-1); // 5 − 6
		expect(applyEffects('initiative', base(2), effects, exhaustedCtx).value).toBe(-4); // 2 − 6
		expect(applyEffects('ac', base(15), effects, exhaustedCtx).value).toBe(15); // not a d20 test
	});
});

describe('L1 · roll-manipulation vocab (reroll / min_die)', () => {
	it('parses reroll and min_die into target + value', () => {
		expect(parseToken('reroll:damage:2')).toMatchObject({
			kind: EFFECT_KIND.reroll,
			target: 'damage',
			amount: 2
		});
		expect(parseToken('min_die:skill.stealth:10')).toMatchObject({
			kind: EFFECT_KIND.minDie,
			target: 'skill.stealth',
			amount: 10
		});
		expect(parseToken('reroll:damage').kind).toBe('unknown'); // malformed → inert, not dropped
	});

	it('surfaces them as structured roll-mod facts (recognized, not inert, not folded)', () => {
		const effects: ActiveEffect[] = [
			{ source: 'GWF', layer: 'feature', tokens: ['reroll:damage:2'] },
			{ source: 'Reliable Talent', layer: 'feature', tokens: ['min_die:skills:10'] }
		];
		const facts = collectFacts(effects);
		expect(facts.rerolls).toEqual([{ target: 'damage', value: 2 }]);
		expect(facts.minDie).toEqual([{ target: 'skills', value: 10 }]);
		expect(facts.unknown).toEqual([]);
	});
});
