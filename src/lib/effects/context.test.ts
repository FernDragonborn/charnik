import { describe, it, expect } from 'vitest';
import { makeExprContext, type BuildVars } from './context';
import {
	parseEffect,
	resolveEffectValue,
	applyEffects,
	collectResources,
	type ActiveEffect
} from './index';
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
});

describe('resolveEffectValue · literal vs expression', () => {
	it('passes a literal amount/dice straight through', () => {
		expect(resolveEffectValue(parseEffect('flat_bonus:ac+2'), ctx)).toEqual({ amount: 2 });
		expect(resolveEffectValue(parseEffect('flat_bonus:save.dex-1'), ctx)).toEqual({ amount: -1 });
		expect(resolveEffectValue(parseEffect('flat_bonus:damage+1d6'), ctx)).toEqual({
			diceFormula: '1d6'
		});
	});

	it('evaluates an expression value, flooring the numeric result (5e round-down)', () => {
		expect(resolveEffectValue(parseEffect('flat_bonus:ac+ceil(level/2)'), ctx)).toEqual({
			amount: 4
		});
		expect(resolveEffectValue(parseEffect('flat_bonus:saves+max(1,cha_mod)'), ctx)).toEqual({
			amount: 1
		});
		// division floors at the final stat value: 7/2 = 3.5 → 3
		expect(resolveEffectValue(parseEffect('flat_bonus:ac+level/2'), ctx)).toEqual({ amount: 3 });
	});

	it('evaluates a dice-count expression to a roller formula (Sneak Attack)', () => {
		// class_level.rogue = 2 → ceil(2/2)=1 → 1d6
		expect(
			resolveEffectValue(parseEffect('flat_bonus:damage+ceil(class_level.rogue/2)d6'), ctx)
		).toEqual({
			diceFormula: '1d6'
		});
	});

	it('degrades a malformed expression to an error (→ inert note)', () => {
		const r = resolveEffectValue(parseEffect('flat_bonus:ac+bogus_var'), ctx);
		expect(r.error).toBeTruthy();
		// and with no ctx an expression cannot resolve
		expect(resolveEffectValue(parseEffect('flat_bonus:ac+level'), undefined).error).toBeTruthy();
	});

	it('handles a negated expression value', () => {
		// exhaustion is a play var → 0 here → -2*0 = 0
		expect(resolveEffectValue(parseEffect('flat_bonus:speed-2*exhaustion'), ctx)).toEqual({
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

describe('collectResources · expression max (Ki = monk level)', () => {
	it('resolves a computed pool max against the ctx', () => {
		const monkCtx = makeExprContext({ ...build, classLevels: { monk: 6 } });
		const effects: ActiveEffect[] = [
			{ source: 'Monk', layer: 'feature', tokens: ['grant_resource:ki:class_level.monk:short'] }
		];
		const res = collectResources(effects, monkCtx);
		expect(res).toHaveLength(1);
		expect(res[0]).toMatchObject({ id: 'ki', max: 6, recharge: 'short' });
	});

	it('keeps a literal-max pool working (backward compatible)', () => {
		const effects: ActiveEffect[] = [
			{ source: 'Barbarian', layer: 'feature', tokens: ['grant_resource:rage:3:long'] }
		];
		expect(collectResources(effects, ctx)[0]).toMatchObject({
			id: 'rage',
			max: 3,
			recharge: 'long'
		});
	});
});
