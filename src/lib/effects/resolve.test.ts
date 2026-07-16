import { describe, it, expect } from 'vitest';
import { makeExprContext, type BuildVars, type PlayVars } from './context';
import { resolveActiveEffects, splitGuard, applyEffects, type ActiveEffect } from './index';
import { computed } from '../rules/pipeline';

const build: BuildVars = {
	level: 5,
	proficiencyBonus: 3,
	abilityMods: { str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 4 },
	abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 18 },
	classLevels: { barbarian: 5 },
	spellcastingMod: 0,
	baseSpeed: 30
};
const play = (over: Partial<PlayVars> = {}): PlayVars => ({
	hp: 40,
	hpMax: 50,
	tempHp: 0,
	exhaustion: 0,
	flags: {
		is_bloodied: false,
		is_raging: false,
		is_concentrating: false,
		is_wearing_armor: false,
		is_wearing_shield: false
	},
	conditions: new Set(),
	resources: {},
	resourceMax: {},
	armorType: 'none',
	size: 'medium',
	...over
});

const noExpand = () => undefined;

describe('splitGuard', () => {
	it('splits a condition-first guard on the first `?`', () => {
		expect(splitGuard('is_raging ? advantage:attack')).toEqual({
			guard: 'is_raging',
			token: 'advantage:attack'
		});
		expect(splitGuard('flat_bonus:ac+2')).toEqual({ token: 'flat_bonus:ac+2' });
	});
});

describe('resolveActiveEffects · guards', () => {
	const effects: ActiveEffect[] = [
		{
			source: 'Rage',
			layer: 'condition',
			tokens: ['is_raging ? advantage:attack', 'is_raging ? resist_immune:bludgeoning']
		},
		{ source: 'Base', layer: 'feature', tokens: ['flat_bonus:ac+1'] }
	];

	it('keeps guard-passing tokens (stripped) and drops failing ones', () => {
		const raging = resolveActiveEffects(
			effects,
			makeExprContext(build, play({ flags: { ...play().flags, is_raging: true } })),
			noExpand
		);
		const tokens = raging.effects.flatMap((e) => e.tokens);
		expect(tokens).toContain('advantage:attack'); // stripped of the guard
		expect(tokens).toContain('resist_immune:bludgeoning');
		expect(tokens).toContain('flat_bonus:ac+1');
		expect(raging.issues).toEqual([]);
	});

	it('drops guarded tokens when the condition is false', () => {
		const calm = resolveActiveEffects(effects, makeExprContext(build, play()), noExpand);
		const tokens = calm.effects.flatMap((e) => e.tokens);
		expect(tokens).not.toContain('advantage:attack');
		expect(tokens).toContain('flat_bonus:ac+1'); // unguarded survives
	});

	it('records a malformed guard as an issue and drops the token (never throws)', () => {
		const bad: ActiveEffect[] = [
			{ source: 'Broken', layer: 'feature', tokens: ['bogus_var ? flat_bonus:ac+1'] }
		];
		const r = resolveActiveEffects(bad, makeExprContext(build, play()), noExpand);
		expect(r.effects).toEqual([]);
		expect(r.issues[0]).toContain('bad guard');
	});

	it('evaluates an enum guard (Unarmored Defense only without armor)', () => {
		const ud: ActiveEffect[] = [
			{ source: 'UD', layer: 'feature', tokens: ['armor_type==none ? set_override:ac:13'] }
		];
		expect(
			resolveActiveEffects(
				ud,
				makeExprContext(build, play({ armorType: 'none' })),
				noExpand
			).effects.flatMap((e) => e.tokens)
		).toContain('set_override:ac:13');
		expect(
			resolveActiveEffects(ud, makeExprContext(build, play({ armorType: 'heavy' })), noExpand)
				.effects
		).toEqual([]);
	});
});

describe('resolveActiveEffects · apply_condition expansion (after guards, SPEC7)', () => {
	it('expands a passing apply_condition into the condition’s own tokens', () => {
		const effects: ActiveEffect[] = [
			{
				source: 'Spell',
				layer: 'condition',
				tokens: ['has_condition.frightened ? apply_condition:frightened']
			}
		];
		const expand = (id: string) =>
			id === 'frightened' ? { source: 'Frightened', tokens: ['disadvantage:attack'] } : undefined;
		// guard true → the apply_condition survives AND expands
		const ctx = makeExprContext(build, play({ conditions: new Set(['frightened']) }));
		const tokens = resolveActiveEffects(effects, ctx, expand).effects.flatMap((e) => e.tokens);
		expect(tokens).toContain('apply_condition:frightened');
		expect(tokens).toContain('disadvantage:attack'); // from the expansion
	});

	it('does NOT expand a guard-failed apply_condition (guards precede expansion)', () => {
		const effects: ActiveEffect[] = [
			{ source: 'Spell', layer: 'condition', tokens: ['is_raging ? apply_condition:frightened'] }
		];
		const expand = () => ({ source: 'Frightened', tokens: ['disadvantage:attack'] });
		const tokens = resolveActiveEffects(
			effects,
			makeExprContext(build, play()),
			expand
		).effects.flatMap((e) => e.tokens);
		expect(tokens).not.toContain('disadvantage:attack');
	});
});

describe('resolveActiveEffects · guard + value expression combined', () => {
	it('applies a guarded expression bonus only when the condition holds (Zealot CHA to damage)', () => {
		const effects: ActiveEffect[] = [
			{ source: 'Zealot', layer: 'feature', tokens: ['is_raging ? flat_bonus:damage+cha_mod'] }
		];
		const raging = makeExprContext(build, play({ flags: { ...play().flags, is_raging: true } }));
		const resolved = resolveActiveEffects(effects, raging, noExpand);
		const dmg = applyEffects('damage', computed([]), resolved.effects, raging);
		// cha_mod = 4, folded as a flat contribution
		expect(dmg.trace.some((c) => c.source === 'Zealot' && c.amount === 4)).toBe(true);
	});
});
