import { describe, it, expect } from 'vitest';
import { makeExprContext, type BuildVars, type PlayVars } from './context';
import { splitGuard, applyEffects, type ActiveEffect, type EffectCtx } from './index';
import { resolveActiveEffects, type ResolveState } from './dag';
import { computed, type Contribution } from '../rules/pipeline';
import type { ExprContext } from './expr';
import { ABILITY_IDS, type Ability } from '../rules/core';

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

/** A resolve over a FIXED ctx (the state is ignored) — the static-snapshot special case. */
const resolve = (
	active: ActiveEffect[],
	ctx: EffectCtx,
	expandCondition: (id: string) => { source: string; tokens: string[] } | undefined = noExpand
) => resolveActiveEffects({ active, makeCtx: () => ctx, expandCondition });

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
		const raging = resolve(
			effects,
			makeExprContext(build, play({ flags: { ...play().flags, is_raging: true } }))
		);
		const tokens = raging.effects.flatMap((e) => e.tokens);
		expect(tokens).toContain('advantage:attack'); // stripped of the guard
		expect(tokens).toContain('resist_immune:bludgeoning');
		expect(tokens).toContain('flat_bonus:ac+1');
		expect(raging.issues).toEqual([]);
	});

	it('drops guarded tokens when the condition is false', () => {
		const calm = resolve(effects, makeExprContext(build, play()));
		const tokens = calm.effects.flatMap((e) => e.tokens);
		expect(tokens).not.toContain('advantage:attack');
		expect(tokens).toContain('flat_bonus:ac+1'); // unguarded survives
	});

	it('records a malformed guard as an issue and keeps the token verbatim (inert, never dropped)', () => {
		const bad: ActiveEffect[] = [
			{ source: 'Broken', layer: 'feature', tokens: ['bogus_var ? flat_bonus:ac+1'] }
		];
		const r = resolve(bad, makeExprContext(build, play()));
		// kept WITH its guard → downstream parses it as `unknown` → an inert note, not an applied effect
		expect(r.effects.flatMap((e) => e.tokens)).toEqual(['bogus_var ? flat_bonus:ac+1']);
		expect(r.issues[0]?.reason).toContain('bad guard');
		expect(r.issues[0]?.token).toBe('bogus_var ? flat_bonus:ac+1');
		// and the seam does NOT apply it as a bonus
		const ac = applyEffects('ac', computed([]), r.effects, makeExprContext(build, play()));
		expect(ac.trace).toEqual([]);
	});

	it('evaluates an enum guard (Unarmored Defense only without armor)', () => {
		const ud: ActiveEffect[] = [
			{ source: 'UD', layer: 'feature', tokens: ['armor_type==none ? set_override:ac:13'] }
		];
		expect(
			resolve(ud, makeExprContext(build, play({ armorType: 'none' }))).effects.flatMap(
				(e) => e.tokens
			)
		).toContain('set_override:ac:13');
		expect(resolve(ud, makeExprContext(build, play({ armorType: 'heavy' }))).effects).toEqual([]);
	});
});

describe('resolveActiveEffects · apply_condition expansion (after guards, SPEC7)', () => {
	const expandFrightened = (id: string) =>
		id === 'frightened' ? { source: 'Frightened', tokens: ['disadvantage:attack'] } : undefined;

	it('expands a passing apply_condition into the condition’s own tokens', () => {
		const effects: ActiveEffect[] = [
			{ source: 'Spell', layer: 'condition', tokens: ['is_raging ? apply_condition:frightened'] }
		];
		const ctx = makeExprContext(build, play({ flags: { ...play().flags, is_raging: true } }));
		const tokens = resolve(effects, ctx, expandFrightened).effects.flatMap((e) => e.tokens);
		expect(tokens).toContain('apply_condition:frightened');
		expect(tokens).toContain('disadvantage:attack'); // from the expansion
	});

	it('does NOT expand a guard-failed apply_condition (guards precede expansion)', () => {
		const effects: ActiveEffect[] = [
			{ source: 'Spell', layer: 'condition', tokens: ['is_raging ? apply_condition:frightened'] }
		];
		const tokens = resolve(
			effects,
			makeExprContext(build, play()),
			expandFrightened
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
		const resolved = resolve(effects, raging);
		const dmg = applyEffects('damage', computed([]), resolved.effects, raging);
		// cha_mod = 4, folded as a flat contribution
		expect(dmg.trace.some((c) => c.source === 'Zealot' && c.amount === 4)).toBe(true);
	});
});

describe('resolveActiveEffects · dependency order (the DAG)', () => {
	/** A live ctx over the resolve state — what derive wires up for real (here in miniature). */
	const liveCtx = (state: ResolveState): ExprContext => ({
		number: (name) => {
			const abil = /^([a-z]{3})_(mod|score)$/.exec(name);
			const ab = ABILITY_IDS.find((a) => a === abil?.[1]);
			if (ab !== undefined) return abil?.[2] === 'mod' ? state.mods[ab] : state.scores[ab];
			if (name === 'hp_max') return state.hpMax.value;
			return undefined;
		},
		boolean: (name) =>
			name.startsWith('has_condition.')
				? state.conditions.has(name.slice('has_condition.'.length))
				: false,
		enum: () => undefined
	});
	const strBase: Partial<Record<Ability, Contribution[]>> = {
		str: [{ source: 'Base score', layer: 'base', op: 'add', amount: 10 }]
	};

	it('a score-writing effect resolves BEFORE an expression that reads the score', () => {
		const active: ActiveEffect[] = [
			// declared in "wrong" order on purpose: the reader first, the writer second
			{ source: 'Brute', layer: 'feature', tokens: ['flat_bonus:damage+str_mod'] },
			{ source: 'Belt of Strength', layer: 'item', tokens: ['set_override:str:20'] }
		];
		const r = resolveActiveEffects({
			active,
			makeCtx: liveCtx,
			expandCondition: noExpand,
			abilityBase: strBase
		});
		expect(r.abilities.str.value).toBe(20); // set_override applied through the pipeline (A10)
		expect(r.abilities.str.trace.some((c) => c.source === 'Belt of Strength')).toBe(true);
		const dmg = applyEffects('damage', computed([]), r.effects, r.ctx);
		expect(dmg.trace.find((c) => c.source === 'Brute')?.amount).toBe(5); // reads STR 20 → +5
		expect(r.issues).toEqual([]);
	});

	it('a guard reading a written score sees the resolved value', () => {
		const active: ActiveEffect[] = [
			{ source: 'Trigger', layer: 'feature', tokens: ['str_score>=15 ? advantage:attack'] },
			{ source: 'Belt', layer: 'item', tokens: ['flat_bonus:str+8'] }
		];
		const r = resolveActiveEffects({
			active,
			makeCtx: liveCtx,
			expandCondition: noExpand,
			abilityBase: strBase // base 10 alone would fail the guard; 10+8 passes
		});
		expect(r.effects.flatMap((e) => e.tokens)).toContain('advantage:attack');
	});

	it('clamps the folded score to the 0..30 pipeline cap', () => {
		const active: ActiveEffect[] = [
			{ source: 'Typo', layer: 'item', tokens: ['flat_bonus:str+1000000'] }
		];
		const r = resolveActiveEffects({
			active,
			makeCtx: liveCtx,
			expandCondition: noExpand,
			abilityBase: strBase
		});
		expect(r.abilities.str.value).toBe(30);
	});

	it('flags a self-fulfilling condition as a dependency cycle (inert, surfaced, no fixpoint)', () => {
		const active: ActiveEffect[] = [
			{ source: 'Loop', layer: 'condition', tokens: ['has_condition.x ? apply_condition:x'] }
		];
		const r = resolveActiveEffects({
			active,
			makeCtx: liveCtx,
			expandCondition: () => ({ source: 'X', tokens: ['flat_bonus:ac+5'] })
		});
		expect(r.state.conditions.has('x')).toBe(false); // never bootstraps itself
		expect(r.issues.some((i) => i.reason.includes('dependency cycle'))).toBe(true);
		// the token stays visible (inert, guard intact) — never silently dropped
		expect(r.effects.flatMap((e) => e.tokens)).toContain('has_condition.x ? apply_condition:x');
		expect(r.effects.flatMap((e) => e.tokens)).not.toContain('flat_bonus:ac+5');
	});

	it('resolves a two-effect chain: a condition raising a value another guard reads', () => {
		// rage (unguarded) raises hp_max by 10; a second effect keys off hp_max ≥ 60
		const active: ActiveEffect[] = [
			{ source: 'Ward', layer: 'feature', tokens: ['hp_max>=60 ? flat_bonus:ac+1'] },
			{ source: 'Raging', layer: 'condition', tokens: ['apply_condition:rage'] }
		];
		const r = resolveActiveEffects({
			active,
			makeCtx: liveCtx,
			expandCondition: (id) =>
				id === 'rage' ? { source: 'Rage', tokens: ['flat_bonus:hp_max+10'] } : undefined,
			hpMaxBase: () => [{ source: 'Hit dice', layer: 'base', op: 'add', amount: 55 }]
		});
		expect(r.state.hpMax.value).toBe(65); // 55 base + 10 from the expanded rage
		expect(r.effects.flatMap((e) => e.tokens)).toContain('flat_bonus:ac+1'); // guard saw 65
	});
});
