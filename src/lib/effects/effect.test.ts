import { describe, it, expect } from 'vitest';
import {
	parseToken,
	splitGuard,
	resolveEffectValue,
	EFFECT_KINDS,
	type ActiveEffect
} from './token-parser';
import { applyEffects, collectFacts, lintEffectTokens } from './apply';
import { makeExprContext, type BuildVars } from './context';
import { EFFECT_KINDS as SCHEMA_EFFECT_KINDS } from '../content/schemas';
import { unarmoredAC, savingThrow } from '../rules/core';

describe('effect vocabulary', () => {
	it('the engine and the content schema list the same kinds (guard against drift)', () => {
		// the two lists are intentionally separate (effects is a removable module) — keep them equal
		expect([...EFFECT_KINDS].sort()).toEqual([...SCHEMA_EFFECT_KINDS].sort());
	});
});

describe('parseToken (bounded vocabulary)', () => {
	it('parses numeric flat bonuses', () => {
		expect(parseToken('flat_bonus:ac+1')).toMatchObject({
			kind: 'flat_bonus',
			target: 'ac',
			amount: 1
		});
		expect(parseToken('flat_bonus:con-2')).toMatchObject({
			kind: 'flat_bonus',
			target: 'con',
			amount: -2
		});
	});
	it('keeps dice bonuses as dice (roll modifier, not a flat number)', () => {
		expect(parseToken('flat_bonus:saves+1d4')).toMatchObject({
			kind: 'flat_bonus',
			target: 'saves',
			dice: '1d4'
		});
	});
	it('parses the non-numeric kinds', () => {
		expect(parseToken('resist_immune:poison')).toMatchObject({
			kind: 'resist_immune',
			target: 'poison'
		});
		expect(parseToken('apply_condition:paralyzed')).toMatchObject({
			kind: 'apply_condition',
			target: 'paralyzed'
		});
		expect(parseToken('grant_resource:rage')).toMatchObject({
			kind: 'grant_resource',
			target: 'rage'
		});
		expect(parseToken('set_override:ac:18')).toMatchObject({
			kind: 'set_override',
			target: 'ac',
			amount: 18
		});
	});
	it('structures resist_immune into a defense bucket + type (bare defaults to resist)', () => {
		expect(parseToken('resist_immune:fire')).toMatchObject({ defense: 'resist', target: 'fire' });
		expect(parseToken('resist_immune:immune:poison')).toMatchObject({
			defense: 'immune',
			target: 'poison'
		});
		expect(parseToken('resist_immune:vulnerable:cold')).toMatchObject({
			defense: 'vulnerable',
			target: 'cold'
		});
	});
	it('structures a full grant_resource pool, leaves a bare one as just an id', () => {
		expect(parseToken('grant_resource:rage:3:long').resource).toEqual({
			id: 'rage',
			max: 3,
			recharge: 'long'
		});
		expect(parseToken('grant_resource:ki').resource).toBeUndefined();
	});
	it('flags unknown / malformed tokens instead of dropping them', () => {
		expect(parseToken('teleport:far').kind).toBe('unknown');
		expect(parseToken('garbage').kind).toBe('unknown');
	});
	it('parses disadvantage like advantage (its own kind + target)', () => {
		expect(parseToken('disadvantage:skill.stealth')).toMatchObject({
			kind: 'disadvantage',
			target: 'skill.stealth'
		});
	});
	it('grant_proficiency carries ONE ladder level and canonicalizes a skill. prefix', () => {
		expect(parseToken('grant_proficiency:stealth')).toMatchObject({
			target: 'stealth',
			proficiency: 'proficient'
		});
		// a `skill.`-prefixed target must not silently drop (audit A6)
		expect(parseToken('grant_proficiency:skill.stealth')).toMatchObject({ target: 'stealth' });
		expect(parseToken('grant_proficiency:expertise:stealth')).toMatchObject({
			target: 'stealth',
			proficiency: 'expertise'
		});
		// saves keep their prefix (derive tells them apart by it)
		expect(parseToken('grant_proficiency:save.con')).toMatchObject({ target: 'save.con' });
	});
});

describe('applyEffects seam', () => {
	const ring: ActiveEffect = {
		source: 'Ring of Protection',
		layer: 'item',
		tokens: ['flat_bonus:ac+1']
	};

	it('on/off invariant: no effects leaves value and trace unchanged', () => {
		const base = unarmoredAC({ dexScore: 14 }); // 12
		const composed = applyEffects('ac', base, []);
		expect(composed.value).toBe(base.value);
		expect(composed.trace).toEqual(base.trace);
	});

	it('folds a matching flat bonus onto the core value, keeping provenance', () => {
		const base = unarmoredAC({ dexScore: 14 }); // 12
		const composed = applyEffects('ac', base, [ring]);
		expect(composed.value).toBe(13);
		expect(composed.trace.map((c) => c.source)).toContain('Ring of Protection');
	});

	it('ignores effects that target a different stat', () => {
		const base = unarmoredAC({ dexScore: 14 });
		const composed = applyEffects('initiative', base, [ring]);
		expect(composed.value).toBe(base.value);
	});

	it('the `saves` group applies to a specific save', () => {
		const base = savingThrow({ ability: 'wis', score: 10, level: 1, proficient: false }); // 0
		const bless: ActiveEffect = {
			source: 'Bless',
			layer: 'condition',
			tokens: ['flat_bonus:saves+1d4']
		};
		const flat: ActiveEffect = { source: 'Cloak', layer: 'item', tokens: ['flat_bonus:saves+1'] };
		const composed = applyEffects('save.wis', base, [bless, flat]);
		expect(composed.value).toBe(1); // +1 flat; the 1d4 is a note, not a flat value
		expect(composed.notes?.some((n) => /1d4/.test(n))).toBe(true);
	});

	it('set_override in the override layer wins', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const wildShape: ActiveEffect = {
			source: 'Form',
			layer: 'override',
			tokens: ['set_override:ac:11']
		};
		expect(applyEffects('ac', base, [wildShape]).value).toBe(11);
	});

	it('two colliding overrides resolve to the most potent (max), independent of order', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const plate: ActiveEffect = {
			source: 'Plate',
			layer: 'override',
			tokens: ['set_override:ac:18']
		};
		const mage: ActiveEffect = {
			source: 'Mage Armor',
			layer: 'override',
			tokens: ['set_override:ac:13']
		};
		// both orderings must yield the SAME winner (18) — no ns-sort / scan-order dependence
		expect(applyEffects('ac', base, [plate, mage]).value).toBe(18);
		expect(applyEffects('ac', base, [mage, plate]).value).toBe(18);
		// the superseded override is explained, never silently dropped
		const notes = applyEffects('ac', base, [mage, plate]).notes ?? [];
		expect(notes.some((n) => /13.*overridden by 18/.test(n))).toBe(true);
	});

	it('clamps a hostile resource max (cost cap, not balance)', () => {
		expect(parseToken('grant_resource:x:1000000000:short')).toMatchObject({
			resource: { id: 'x', max: 1000 }
		});
	});

	it('keeps an unknown token as an inert note, value unchanged', () => {
		const base = unarmoredAC({ dexScore: 14 });
		const weird: ActiveEffect = {
			source: 'Homebrew',
			layer: 'feature',
			tokens: ['flat_bonus:ac+1', 'teleport:far']
		};
		const composed = applyEffects('ac', base, [weird]);
		expect(composed.value).toBe(13); // the good token still applies
	});
});

describe('collectFacts', () => {
	it('gathers non-numeric effect facts', () => {
		const effects: ActiveEffect[] = [
			{
				source: 'Rage',
				layer: 'feature',
				tokens: ['grant_resource:rage', 'resist_immune:bludgeoning']
			},
			{ source: 'Hold Person', layer: 'condition', tokens: ['apply_condition:paralyzed'] },
			{ source: 'Weird', layer: 'feature', tokens: ['teleport:far'] }
		];
		const facts = collectFacts(effects);
		expect(facts.resourceIds).toContain('rage');
		expect(facts.defenses).toContainEqual({
			bucket: 'resist',
			type: 'bludgeoning',
			source: 'Rage'
		});
		expect(facts.conditions).toContain('paralyzed');
		expect(facts.unknown).toContainEqual({ source: 'Weird', token: 'teleport:far' });
	});
	it('fills the disadvantage bucket (was a dead field — audit A5)', () => {
		const facts = collectFacts([
			{ source: 'Poisoned', layer: 'condition', tokens: ['disadvantage:skills'] }
		]);
		expect(facts.disadvantage).toContainEqual({ target: 'skills', source: 'Poisoned' });
	});
});

/* ─────────────────────────── L1 boundary · raw token first-contact (unfiltered input) ─────────────────────────── */

describe('parseToken · set_override value slot (literal vs expression vs dice)', () => {
	const build: BuildVars = {
		level: 5,
		proficiencyBonus: 3,
		abilityMods: { str: 0, dex: 3, con: 0, int: 0, wis: 0, cha: 0 },
		abilityScores: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
		classLevels: {},
		spellcastingMod: 0,
		baseSpeed: 30
	};
	const ctx = makeExprContext(build);

	it('resolves an EXPRESSION override (Unarmored Defense `10+dex_mod`)', () => {
		const p = parseToken('set_override:ac:10+dex_mod');
		expect(p).toMatchObject({ kind: 'set_override', target: 'ac', valueExpr: '10+dex_mod' });
		expect(resolveEffectValue(p, ctx)).toEqual({ amount: 13 }); // 10 + dex mod 3
	});
	it('rejects a DICE value in an override — an AC cannot be a die (surfaced as an error fact)', () => {
		const facts = collectFacts(
			[{ source: 'Bug', layer: 'feature', tokens: ['set_override:ac:1d6'] }],
			ctx
		);
		expect(facts.numeric[0]?.error).toContain('override cannot be a dice');
	});
	it('folds an expression override through the seam (13 AC, overriding the base)', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const ud: ActiveEffect = {
			source: 'Barbarian',
			layer: 'feature',
			tokens: ['set_override:ac:10+dex_mod']
		};
		expect(applyEffects('ac', base, [ud], ctx).value).toBe(13);
	});
});

describe('parseToken · malformed tokens degrade to `unknown` (never throw, never a wrong apply)', () => {
	// every one of these is a plausible author slip typed into a CSV cell; each must parse to a
	// visible inert note, not silently vanish and not crash the derive
	const unknowns = [
		'resist_immune:', // empty type
		'grant_resource:', // empty id
		'grant_proficiency:', // empty target
		'flat_bonus:ac+', // sign but no value
		'flat_bonus:+2', // value but no target
		'flat_bonus:ac', // no value slot at all
		'FLAT_BONUS:ac+2', // kind is case-SENSITIVE (target is not) → unknown
		'set_override:ac', // missing value
		'', // empty string
		':', // bare separator
		'flat_bonus' // no separator
	];
	for (const t of unknowns)
		it(`"${t}" → unknown`, () => {
			expect(parseToken(t).kind).toBe('unknown');
		});
	it('trims surrounding whitespace before parsing', () => {
		expect(parseToken('  flat_bonus:ac+2  ')).toMatchObject({ target: 'ac', amount: 2 });
	});
	it('normalizes an uppercase TARGET to lowercase so it actually applies (no silent no-op)', () => {
		expect(parseToken('flat_bonus:AC+2')).toMatchObject({ target: 'ac', amount: 2 });
		expect(parseToken('resist_immune:Fire')).toMatchObject({ defense: 'resist', target: 'fire' });
		expect(parseToken('apply_condition:Frightened')).toMatchObject({ target: 'frightened' });
		// the raw form keeps the author's casing for the inert-note / provenance display
		expect(parseToken('flat_bonus:AC+2').raw).toBe('flat_bonus:AC+2');
	});
	it('an uppercase-target bonus now folds through the seam (was a parsed-but-dead token)', () => {
		const base = unarmoredAC({ dexScore: 14 }); // 12
		const ring: ActiveEffect = { source: 'Ring', layer: 'item', tokens: ['flat_bonus:AC+1'] };
		expect(applyEffects('ac', base, [ring]).value).toBe(13);
	});
});

describe('splitGuard · guard/token split edges (the `?` is a hard boundary)', () => {
	it('splits on the FIRST `?` only (a stray `?` in the tail stays in the token)', () => {
		expect(splitGuard('a ? b ? c')).toEqual({ guard: 'a', token: 'b ? c' });
	});
	it('an empty guard (`? token`) yields an empty guard string (evaluates to an error → inert)', () => {
		expect(splitGuard('? advantage:attack')).toEqual({ guard: '', token: 'advantage:attack' });
	});
	it('a trailing `?` yields an empty token', () => {
		expect(splitGuard('flat_bonus:ac+2 ?')).toEqual({ guard: 'flat_bonus:ac+2', token: '' });
	});
	it('needs no surrounding spaces around `?`', () => {
		expect(splitGuard('is_raging?advantage:attack')).toEqual({
			guard: 'is_raging',
			token: 'advantage:attack'
		});
	});
	it('a token with no `?` is returned whole (trimmed), no guard', () => {
		expect(splitGuard('  flat_bonus:ac+2  ')).toEqual({ token: 'flat_bonus:ac+2' });
	});
});

describe('lintEffectTokens · content-health soft-warns over every expression slot', () => {
	it('warns on an unusual die in a LITERAL dice bonus (fast-path `+1d7`, was silently skipped)', () => {
		expect(lintEffectTokens(['flat_bonus:damage+1d7']).join(' ')).toContain('unusual die d7');
	});
	it('warns on a mixed-type if() inside a value expression', () => {
		const w = lintEffectTokens(['flat_bonus:ac+if(is_raging,1d4,2)']);
		expect(w.join(' ')).toContain('differ in type');
	});
	it('lints the GUARD slot and the resource maxExpr slot too', () => {
		expect(lintEffectTokens(['1d7 ? advantage:attack']).join(' ')).toContain('unusual die d7');
		expect(lintEffectTokens(['grant_resource:ki:1d7:short']).join(' ')).toContain('unusual die');
	});
	it('is quiet for clean tokens and prefixes each warning with the offending token', () => {
		expect(lintEffectTokens(['flat_bonus:ac+2', 'flat_bonus:damage+1d6'])).toEqual([]);
		expect(lintEffectTokens(['flat_bonus:damage+1d7'])[0]).toContain('flat_bonus:damage+1d7 —');
	});
});
