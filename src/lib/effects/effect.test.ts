import { describe, it, expect } from 'vitest';
import {
	parseToken,
	splitGuard,
	resolveEffectValue,
	EFFECT_KINDS,
	type ActiveEffect,
} from './token-parser';
import { applyEffects, collectFacts, lintEffectTokens } from './apply';
import { makeExprContext, type BuildVars } from './context';
import { EFFECT_KINDS as SCHEMA_EFFECT_KINDS } from '../content/schemas';
import { unarmoredAC, savingThrow } from '../rules/core';
import { computed, type Contribution } from '../rules/pipeline';

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
			amount: 1,
		});
		expect(parseToken('flat_bonus:con-2')).toMatchObject({
			kind: 'flat_bonus',
			target: 'con',
			amount: -2,
		});
	});
	it('keeps dice bonuses as dice (roll modifier, not a flat number)', () => {
		expect(parseToken('flat_bonus:saves+1d4')).toMatchObject({
			kind: 'flat_bonus',
			target: 'saves',
			dice: '1d4',
		});
	});
	it('parses the D9-tail damage `:type` slot (flaming), leaving untyped tokens type-less', () => {
		expect(parseToken('flat_bonus:damage:fire+1d6')).toMatchObject({
			kind: 'flat_bonus',
			target: 'damage',
			dice: '1d6',
			damageType: 'fire',
		});
		expect(parseToken('flat_bonus:damage:radiant+2')).toMatchObject({
			target: 'damage',
			amount: 2,
			damageType: 'radiant',
		});
		expect(parseToken('flat_bonus:damage:Cold+1d4').damageType).toBe('cold'); // normalized
		expect(parseToken('flat_bonus:damage+1d6').damageType).toBeUndefined();
		expect(parseToken('flat_bonus:ac+2').damageType).toBeUndefined();
	});
	it('§A: an attack `:category` slot is a scope, not a damageType (Archery)', () => {
		expect(parseToken('flat_bonus:attack:ranged+2')).toMatchObject({
			kind: 'flat_bonus',
			target: 'attack',
			amount: 2,
			scope: 'ranged',
		});
		expect(parseToken('flat_bonus:attack:ranged+2').damageType).toBeUndefined();
		expect(parseToken('flat_bonus:attack:Two_Handed+1').scope).toBe('two_handed'); // normalized
		// a damage qualifier stays a damageType (scope collision resolved by TARGET, GWF deferred)
		expect(parseToken('flat_bonus:damage:fire+1d6').scope).toBeUndefined();
		expect(parseToken('flat_bonus:attack+1').scope).toBeUndefined();
	});
	it('SCOPED-BONUS: a dotted attack/damage target is a SCOPE, and every other dot is a target', () => {
		// what the qualifier slot could never say: a damage bonus for melee only (Dueling, Rage)
		expect(parseToken('flat_bonus:damage.melee+2')).toMatchObject({
			kind: 'flat_bonus',
			target: 'damage',
			amount: 2,
			scope: 'melee',
		});
		// …a bonus naming ONE weapon, and one naming ONE spell (Agonizing Blast)
		expect(parseToken('flat_bonus:damage.longsword+1').scope).toBe('longsword');
		expect(parseToken('flat_bonus:damage.eldritch_blast+cha_mod')).toMatchObject({
			target: 'damage',
			scope: 'eldritch_blast',
			valueExpr: 'cha_mod',
		});
		// the older spelling means the same thing and lands in the same field
		expect(parseToken('flat_bonus:attack.ranged+2').scope).toBe('ranged');
		// a dotted target that IS a target keeps its whole name
		expect(parseToken('flat_bonus:speed.fly+10')).toMatchObject({
			target: 'speed.fly',
			amount: 10,
		});
		expect(parseToken('flat_bonus:save.str+1').scope).toBeUndefined();
	});
	it('parses the non-numeric kinds', () => {
		expect(parseToken('damage_sensitivity:immune:poison')).toMatchObject({
			kind: 'damage_sensitivity',
			target: 'poison',
		});
		expect(parseToken('apply_condition:paralyzed')).toMatchObject({
			kind: 'apply_condition',
			target: 'paralyzed',
		});
		expect(parseToken('grant_resource:rage')).toMatchObject({
			kind: 'grant_resource',
			target: 'rage',
		});
		expect(parseToken('set_override:ac:18')).toMatchObject({
			kind: 'set_override',
			target: 'ac',
			amount: 18,
		});
	});
	it('structures damage_sensitivity into a relation + type, and REQUIRES the relation', () => {
		expect(parseToken('damage_sensitivity:resist:fire')).toMatchObject({
			sensitivity: 'resist',
			target: 'fire',
		});
		// one segment is malformed, not an implied resistance — the author sees an inert note
		expect(parseToken('damage_sensitivity:fire').kind).toBe('unknown');
		expect(parseToken('damage_sensitivity:immune:poison')).toMatchObject({
			sensitivity: 'immune',
			target: 'poison',
		});
		expect(parseToken('damage_sensitivity:vulnerable:cold')).toMatchObject({
			sensitivity: 'vulnerable',
			target: 'cold',
		});
	});
	it('structures a full grant_resource pool, leaves a bare one as just an id', () => {
		expect(parseToken('grant_resource:rage:3:long').resource).toEqual({
			id: 'rage',
			max: 3,
			recharge: { trigger: 'long', amount: 'all' },
		});
		expect(parseToken('grant_resource:ki').resource).toBeUndefined();
	});
	it('accepts the `consumable` recharge (a one-use / N-charge potion pool)', () => {
		expect(parseToken('grant_resource:angelic_slumber:1:consumable').resource).toEqual({
			id: 'angelic_slumber',
			max: 1,
			recharge: { trigger: 'consumable', amount: 'all' },
		});
	});
	it('flags unknown / malformed tokens instead of dropping them', () => {
		expect(parseToken('teleport:far').kind).toBe('unknown');
		expect(parseToken('garbage').kind).toBe('unknown');
	});
	it('§B: reroll/min_die parse an optional weapon-scope list (GWF); plain forms stay unscoped', () => {
		expect(parseToken('min_die:damage:two_handed,melee:3')).toMatchObject({
			kind: 'min_die',
			target: 'damage',
			amount: 3,
			scope: 'two_handed,melee',
		});
		expect(parseToken('reroll:damage:versatile,melee:2')).toMatchObject({
			kind: 'reroll',
			target: 'damage',
			amount: 2,
			scope: 'versatile,melee',
		});
		// unscoped forms unchanged: a group target and a dotted key both keep the 2-segment grammar
		expect(parseToken('reroll:d20_tests:2')).toMatchObject({ target: 'd20_tests', amount: 2 });
		expect(parseToken('reroll:d20_tests:2').scope).toBeUndefined();
		expect(parseToken('min_die:skill.stealth:10')).toMatchObject({
			target: 'skill.stealth',
			amount: 10,
		});
		expect(parseToken('min_die:skill.stealth:10').scope).toBeUndefined();
	});
	it('parses disadvantage like advantage (its own kind + target)', () => {
		expect(parseToken('disadvantage:skill.stealth')).toMatchObject({
			kind: 'disadvantage',
			target: 'skill.stealth',
		});
	});
	it('grant_proficiency carries ONE ladder level and canonicalizes a skill. prefix', () => {
		expect(parseToken('grant_proficiency:stealth')).toMatchObject({
			target: 'stealth',
			proficiency: 'proficient',
		});
		// a `skill.`-prefixed target must not silently drop (audit A6)
		expect(parseToken('grant_proficiency:skill.stealth')).toMatchObject({ target: 'stealth' });
		expect(parseToken('grant_proficiency:expertise:stealth')).toMatchObject({
			target: 'stealth',
			proficiency: 'expertise',
		});
		// saves keep their prefix (derive tells them apart by it)
		expect(parseToken('grant_proficiency:save.con')).toMatchObject({ target: 'save.con' });
		// the rung is an optional leading word; `partial` is Jack of All Trades, and a token written
		// before the rung existed still reads as `proficient`
		expect(parseToken('grant_proficiency:partial:skills')).toMatchObject({
			target: 'skills',
			proficiency: 'partial',
		});
		expect(parseToken('grant_proficiency:proficient:stealth')).toMatchObject({
			target: 'stealth',
			proficiency: 'proficient',
		});
		expect(parseToken('grant_proficiency:stealth')).toMatchObject({ proficiency: 'proficient' });
		// a word that is NOT a rung stays part of the target, so it fails loudly as an unknown target
		// rather than being silently eaten as a rung nobody wrote
		expect(parseToken('grant_proficiency:mastery:stealth')).toMatchObject({
			target: 'mastery:stealth',
		});
	});
});

describe('applyEffects seam', () => {
	const ring: ActiveEffect = {
		source: 'Ring of Protection',
		layer: 'item',
		tokens: ['flat_bonus:ac+1'],
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
			tokens: ['flat_bonus:saves+1d4'],
		};
		const flat: ActiveEffect = { source: 'Cloak', layer: 'item', tokens: ['flat_bonus:saves+1'] };
		const composed = applyEffects('save.wis', base, [bless, flat]);
		expect(composed.value).toBe(1); // +1 flat; the 1d4 is a note, not a flat value
		expect(composed.notes?.some((n) => /1d4/.test(n.text))).toBe(true);
	});

	it('set_override in the override layer wins', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const wildShape: ActiveEffect = {
			source: 'Form',
			layer: 'override',
			tokens: ['set_override:ac:11'],
		};
		expect(applyEffects('ac', base, [wildShape]).value).toBe(11);
	});

	it('two colliding overrides resolve to the most potent (max), independent of order', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const plate: ActiveEffect = {
			source: 'Plate',
			layer: 'override',
			tokens: ['set_override:ac:18'],
		};
		const mage: ActiveEffect = {
			source: 'Mage Armor',
			layer: 'override',
			tokens: ['set_override:ac:13'],
		};
		// both orderings must yield the SAME winner (18) — no ns-sort / scan-order dependence
		expect(applyEffects('ac', base, [plate, mage]).value).toBe(18);
		expect(applyEffects('ac', base, [mage, plate]).value).toBe(18);
		// the superseded override is explained, never silently dropped
		const notes = applyEffects('ac', base, [mage, plate]).notes ?? [];
		expect(notes.some((n) => /13.*overridden by 18/.test(n.text))).toBe(true);
	});

	it('clamps a hostile resource max (cost cap, not balance)', () => {
		expect(parseToken('grant_resource:x:1000000000:short')).toMatchObject({
			resource: { id: 'x', max: 1000 },
		});
	});

	it('keeps an unknown token as an inert note, value unchanged', () => {
		const base = unarmoredAC({ dexScore: 14 });
		const weird: ActiveEffect = {
			source: 'Homebrew',
			layer: 'feature',
			tokens: ['flat_bonus:ac+1', 'teleport:far'],
		};
		const composed = applyEffects('ac', base, [weird]);
		expect(composed.value).toBe(13); // the good token still applies
	});
});

describe('A9 · set_override floor/cap modes + block_bonus (grapple family) + D12 layer honoring', () => {
	const speedBase = (): { value: number; trace: Contribution[] } => ({
		value: 30,
		trace: [{ source: 'Base speed', layer: 'base', op: 'set', amount: 30 }],
	});

	it('BUG-3: a clamped base keeps its floor through applyEffects (on/off/deleted invariant)', () => {
		// base folds to -10 raw but is floored to 0 by its clamp (like deriveSpeed `{min:0}`)
		const clampedBase = computed(
			[
				{ source: 'Base speed', layer: 'base', op: 'set', amount: 30 },
				{ source: 'Heavy penalty', layer: 'item', op: 'add', amount: -40 },
			],
			{ min: 0 },
		);
		expect(clampedBase.value).toBe(0);
		// zero effects must reproduce the clamped value, not re-fold the trace to -10
		expect(applyEffects('speed', clampedBase, []).value).toBe(0);
		// a real speed penalty still applies, still floored at 0 (never negative)
		const slow: ActiveEffect = {
			source: 'Slow',
			layer: 'condition',
			tokens: ['flat_bonus:speed-5'],
		};
		expect(applyEffects('speed', clampedBase, [slow]).value).toBe(0);
	});

	it('parses the floor/cap mode slot', () => {
		expect(parseToken('set_override:int:19:floor')).toMatchObject({
			kind: 'set_override',
			target: 'int',
			amount: 19,
			setMode: 'floor',
		});
		expect(parseToken('set_override:str:10:cap')).toMatchObject({ setMode: 'cap' });
		expect(parseToken('set_override:ac:11').setMode).toBeUndefined();
	});

	it('floor raises a plain stat, cap lowers it (via applyEffects)', () => {
		const base = unarmoredAC({ dexScore: 14 }); // 12
		const floor: ActiveEffect = {
			source: 'Item',
			layer: 'item',
			tokens: ['set_override:ac:15:floor'],
		};
		expect(applyEffects('ac', base, [floor]).value).toBe(15);
		const cap: ActiveEffect = { source: 'Item', layer: 'item', tokens: ['set_override:ac:11:cap'] };
		expect(applyEffects('ac', base, [cap]).value).toBe(11);
		const noop: ActiveEffect = {
			source: 'Item',
			layer: 'item',
			tokens: ['set_override:ac:9:floor'],
		};
		const r = applyEffects('ac', base, [noop]);
		expect(r.value).toBe(12);
		expect(r.notes?.some((n) => /already ≥ 9/.test(n.text))).toBe(true);
	});

	it('a cap is a CEILING on the finished value — it folds after every add, not inside its layer', () => {
		// "your Constitution increases by 2, to a maximum of 20" (Belt of Dwarvenkind) is +2 and THEN a
		// ceiling. Folded inside the layer, the cap would fire first and the +2 would sail past it.
		const belt: ActiveEffect = {
			source: 'Belt of Dwarvenkind',
			layer: 'item',
			tokens: ['flat_bonus:con+2', 'set_override:con:20:cap'],
		};
		const scoreOf = (n: number) =>
			applyEffects('con', computed([{ source: 'Base', layer: 'base', op: 'set', amount: n }]), [
				belt,
			]).value;
		expect(scoreOf(14)).toBe(16); // the ceiling is nowhere near — the +2 lands whole
		expect(scoreOf(19)).toBe(20); // +2 would be 21; the ceiling takes it to 20
		expect(scoreOf(20)).toBe(20); // already there, so the belt changes nothing
		// and a ceiling that never bit says so, rather than folding silently
		expect(
			applyEffects('con', computed([{ source: 'Base', layer: 'base', op: 'set', amount: 10 }]), [
				belt,
			]).notes?.some((n) => /already ≤ 20/.test(n.text)),
		).toBe(true);
	});

	it('block_bonus drops effect-borne positive speed bonuses but not the base', () => {
		const grapple: ActiveEffect = {
			source: 'Grappled',
			layer: 'condition',
			tokens: ['set_override:speed:0', 'block_bonus:speed'],
		};
		const boots: ActiveEffect = { source: 'Boots', layer: 'item', tokens: ['flat_bonus:speed+10'] };
		const r = applyEffects('speed', speedBase(), [grapple, boots]);
		expect(r.value).toBe(0); // 0-set wins (condition layer) AND the +10 is blocked
		expect(r.notes?.some((n) => /blocked/.test(n.text))).toBe(true);
	});

	it('block_bonus leaves penalties (negative adds) intact — RAW blocks bonuses only', () => {
		const block: ActiveEffect = {
			source: 'Grappled',
			layer: 'condition',
			tokens: ['block_bonus:speed'],
		};
		const penalty: ActiveEffect = {
			source: 'Slow',
			layer: 'condition',
			tokens: ['flat_bonus:speed-5'],
		};
		expect(applyEffects('speed', speedBase(), [block, penalty]).value).toBe(25);
	});

	it('D12: a condition-layer set beats a lower item-layer set (no longer both forced to override)', () => {
		const boots: ActiveEffect = {
			source: 'Boots',
			layer: 'item',
			tokens: ['set_override:speed:40'],
		};
		const grapple: ActiveEffect = {
			source: 'Grappled',
			layer: 'condition',
			tokens: ['set_override:speed:0'],
		};
		expect(applyEffects('speed', speedBase(), [boots, grapple]).value).toBe(0);
		expect(applyEffects('speed', speedBase(), [grapple, boots]).value).toBe(0);
	});
});

describe('G4 · halve op (2014 exhaustion — speed / hp_max ×½)', () => {
	it('halves the value accumulated from earlier layers, rounding down', () => {
		const base: { value: number; trace: Contribution[] } = {
			value: 30,
			trace: [{ source: 'Base speed', layer: 'base', op: 'set', amount: 30 }],
		};
		const boots: ActiveEffect = { source: 'Boots', layer: 'item', tokens: ['flat_bonus:speed+10'] };
		const exhausted: ActiveEffect = {
			source: 'Exhausted',
			layer: 'condition',
			tokens: ['halve:speed'],
		};
		// 30 + 10 = 40, then ×½ at the condition layer → 20
		expect(applyEffects('speed', base, [boots, exhausted]).value).toBe(20);
	});

	it('halves hp_max (odd → floor)', () => {
		const base: { value: number; trace: Contribution[] } = {
			value: 25,
			trace: [{ source: 'Hit dice', layer: 'base', op: 'add', amount: 25 }],
		};
		const exhausted: ActiveEffect = {
			source: 'Exhausted',
			layer: 'condition',
			tokens: ['halve:hp_max'],
		};
		expect(applyEffects('hp_max', base, [exhausted]).value).toBe(12); // floor(25/2)
	});

	it('parses halve as its own kind + target', () => {
		expect(parseToken('halve:speed')).toMatchObject({ kind: 'halve', target: 'speed' });
	});
});

describe('EFX-ROLL · grant_roll (feature-granted named rollable)', () => {
	const build: BuildVars = {
		level: 6,
		proficiencyBonus: 3,
		abilityMods: { str: 0, dex: 3, con: 0, int: 0, wis: 0, cha: 0 },
		abilityScores: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
		classLevels: { rogue: 6 },
		spellcastingMod: 0,
		baseSpeed: 30,
	};
	const ctx = makeExprContext(build);

	it('parses grant_roll into an id + value expression', () => {
		expect(parseToken('grant_roll:sneak_attack:ceil(class_level.rogue/2) d 6')).toMatchObject({
			kind: 'grant_roll',
			target: 'sneak_attack',
			valueExpr: 'ceil(class_level.rogue/2) d 6',
		});
	});

	it('resolves the expr to a dice formula against the character (Sneak Attack at rogue 6 → 3d6)', () => {
		const facts = collectFacts(
			[
				{
					source: 'Sneak Attack',
					layer: 'feature',
					tokens: ['grant_roll:sneak_attack:ceil(class_level.rogue/2) d 6'],
				},
			],
			ctx,
		);
		expect(facts.rolls).toHaveLength(1);
		expect(facts.rolls[0]).toMatchObject({
			id: 'sneak_attack',
			formula: '3d6',
			label: 'Sneak Attack',
		});
	});

	it('dedupes the same (id, source) to one rollable (A11)', () => {
		const tok = 'grant_roll:sneak_attack:ceil(class_level.rogue/2) d 6';
		const facts = collectFacts(
			[{ source: 'Sneak Attack', layer: 'feature', tokens: [tok, tok] }],
			ctx,
		);
		expect(facts.rolls).toHaveLength(1);
	});
});

describe('collectFacts', () => {
	it('gathers non-numeric effect facts', () => {
		const effects: ActiveEffect[] = [
			{
				source: 'Rage',
				layer: 'feature',
				tokens: ['grant_resource:rage', 'damage_sensitivity:resist:bludgeoning'],
			},
			{ source: 'Hold Person', layer: 'condition', tokens: ['apply_condition:paralyzed'] },
			{ source: 'Weird', layer: 'feature', tokens: ['teleport:far'] },
		];
		const facts = collectFacts(effects);
		expect(facts.resourceIds).toContain('rage');
		expect(facts.damageSensitivities).toContainEqual({
			bucket: 'resist',
			type: 'bludgeoning',
			source: 'Rage',
		});
		expect(facts.conditions).toContain('paralyzed');
		expect(facts.unknown).toContainEqual({ source: 'Weird', token: 'teleport:far' });
	});
	it('fills the disadvantage bucket (was a dead field — audit A5)', () => {
		const facts = collectFacts([
			{ source: 'Poisoned', layer: 'condition', tokens: ['disadvantage:skills'] },
		]);
		expect(facts.disadvantage).toContainEqual({ target: 'skills', source: 'Poisoned' });
	});
});

describe('on_event · a bounded event crossed with the bounded action verbs', () => {
	const ctx = makeExprContext({
		level: 18,
		proficiencyBonus: 6,
		abilityMods: { str: 0, dex: 0, con: 3, int: 0, wis: 0, cha: 0 },
		abilityScores: { str: 10, dex: 10, con: 16, int: 10, wis: 10, cha: 10 },
		classLevels: { fighter: 18 },
		spellcastingMod: 0,
		baseSpeed: 30,
	});

	it('keeps the action token whole — only the FIRST colon is structural', () => {
		expect(parseToken('on_event:turn_start:heal:5+con_mod')).toMatchObject({
			kind: 'on_event',
			target: 'turn_start',
			action: 'heal:5+con_mod',
		});
		expect(parseToken('on_event:turn_start:attack:unarmed_strike:2')).toMatchObject({
			action: 'attack:unarmed_strike:2',
		});
	});

	it('resolves the action L2 at derive, so the executor only rolls what it is handed', () => {
		const facts = collectFacts(
			[{ source: 'Survivor', layer: 'feature', tokens: ['on_event:turn_start:heal:5+con_mod'] }],
			ctx,
		);
		expect(facts.onEvent).toEqual([{ event: 'turn_start', action: 'heal:8', source: 'Survivor' }]);
	});

	it('says "only while Bloodied" with the ordinary L2 guard, not a condition slot of its own', () => {
		const token = 'is_bloodied ? on_event:turn_start:heal:5+con_mod';
		expect(splitGuard(token)).toEqual({
			guard: 'is_bloodied',
			token: 'on_event:turn_start:heal:5+con_mod',
		});
	});

	it('degrades an event nobody fires to an inert note — a hook that never runs must not look fine', () => {
		expect(parseToken('on_event:full_moon:heal:1d4')).toMatchObject({ kind: 'unknown' });
		expect(parseToken('on_event:turn_start')).toMatchObject({ kind: 'unknown' });
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
		baseSpeed: 30,
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
			ctx,
		);
		expect(facts.numeric[0]?.error).toContain('override cannot be a dice');
	});
	it('folds an expression override through the seam (13 AC, overriding the base)', () => {
		const base = unarmoredAC({ dexScore: 20 }); // 15
		const ud: ActiveEffect = {
			source: 'Barbarian',
			layer: 'feature',
			tokens: ['set_override:ac:10+dex_mod'],
		};
		expect(applyEffects('ac', base, [ud], ctx).value).toBe(13);
	});
});

describe('parseToken · malformed tokens degrade to `unknown` (never throw, never a wrong apply)', () => {
	// every one of these is a plausible author slip typed into a CSV cell; each must parse to a
	// visible inert note, not silently vanish and not crash the derive
	const unknowns = [
		'damage_sensitivity:resist:', // empty type
		'grant_resource:', // empty id
		'grant_proficiency:', // empty target
		'flat_bonus:ac+', // sign but no value
		'flat_bonus:+2', // value but no target
		'flat_bonus:ac', // no value slot at all
		'FLAT_BONUS:ac+2', // kind is case-SENSITIVE (target is not) → unknown
		'set_override:ac', // missing value
		'', // empty string
		':', // bare separator
		'flat_bonus', // no separator
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
		expect(parseToken('damage_sensitivity:resist:Fire')).toMatchObject({
			sensitivity: 'resist',
			target: 'fire',
		});
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
			token: 'advantage:attack',
		});
	});
	it('a token with no `?` is returned whole (trimmed), no guard', () => {
		expect(splitGuard('  flat_bonus:ac+2  ')).toEqual({ token: 'flat_bonus:ac+2' });
	});
});

describe('G1 · auto_fail / auto_succeed (forced roll outcome, e.g. paralyzed → STR/DEX saves)', () => {
	it('parses to its own kind + target (like advantage), target normalized', () => {
		expect(parseToken('auto_fail:save.dex')).toMatchObject({
			kind: 'auto_fail',
			target: 'save.dex',
		});
		expect(parseToken('auto_succeed:save.wis')).toMatchObject({
			kind: 'auto_succeed',
			target: 'save.wis',
		});
		expect(parseToken('auto_fail:SAVE.STR').target).toBe('save.str'); // normalized
	});
	it('collects into its own fact bucket, not the numeric/advantage ones', () => {
		const facts = collectFacts([
			{
				source: 'Paralyzed',
				layer: 'condition',
				tokens: ['auto_fail:save.str', 'auto_fail:save.dex'],
			},
		]);
		expect(facts.autoFail).toEqual([
			{ target: 'save.str', source: 'Paralyzed' },
			{ target: 'save.dex', source: 'Paralyzed' },
		]);
		expect(facts.numeric).toEqual([]); // it is NOT a bonus — never folds onto the save value
	});
	it('surfaces on the matched save as a note (does not change the save number)', () => {
		const base = savingThrow({ ability: 'str', score: 10, level: 1, proficient: false }); // +0
		const paralyzed: ActiveEffect = {
			source: 'Paralyzed',
			layer: 'condition',
			tokens: ['auto_fail:save.str'],
		};
		const out = applyEffects('save.str', base, [paralyzed]);
		expect(out.value).toBe(0); // unchanged — auto-fail is an outcome, not a modifier
		expect(out.notes?.some((n) => n.text.includes('auto-fail on save.str'))).toBe(true);
	});
	it('the `saves` group auto-fails every save; a different save is untouched', () => {
		const facts = collectFacts([{ source: 'X', layer: 'condition', tokens: ['auto_fail:saves'] }]);
		const strSave = applyEffects(
			'save.str',
			savingThrow({ ability: 'str', score: 10, level: 1, proficient: false }),
			facts,
		);
		expect(strSave.notes?.some((n) => n.text.includes('auto-fail'))).toBe(true);
		const skill = applyEffects(
			'skill.stealth',
			savingThrow({ ability: 'dex', score: 10, level: 1, proficient: false }),
			facts,
		);
		expect(skill.notes ?? []).toEqual([]); // saves group doesn't touch a skill
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
	it("lints an on_event action's own formula — the fifth slot", () => {
		expect(lintEffectTokens(['on_event:turn_start:heal:1d7']).join(' ')).toContain(
			'unusual die d7',
		);
		// a multi-action lints each verb that carries a formula, and nothing that carries an id
		expect(
			lintEffectTokens(['on_event:turn_start:restore_resource:focus;heal:1d7']).join(' '),
		).toContain('unusual die d7');
		expect(lintEffectTokens(['on_event:turn_start:apply_condition:prone'])).toEqual([]);
	});
	it('is quiet for clean tokens and prefixes each warning with the offending token', () => {
		expect(lintEffectTokens(['flat_bonus:ac+2', 'flat_bonus:damage+1d6'])).toEqual([]);
		expect(lintEffectTokens(['flat_bonus:damage+1d7'])[0]).toContain('flat_bonus:damage+1d7 —');
	});
});

describe('a scoped bonus can name SEVERAL scopes, and needs all of them (RAGE-SCOPE)', () => {
	it('parses a comma-separated scope list in the dotted target', () => {
		expect(parseToken('flat_bonus:damage.melee,str+2')).toMatchObject({
			kind: 'flat_bonus',
			target: 'damage',
			scope: 'melee,str',
			amount: 2,
		});
	});
	it('an attack token carrying BOTH a dotted scope and a qualifier keeps both', () => {
		// the two land in one slot on `attack`, and the qualifier used to overwrite the scope — which
		// WIDENED the bonus (every versatile weapon) instead of narrowing it (melee versatile ones)
		expect(parseToken('flat_bonus:attack.melee:versatile+2')).toMatchObject({
			target: 'attack',
			scope: 'melee,versatile',
			amount: 2,
		});
		// damage has two distinct slots, and they stay distinct
		expect(parseToken('flat_bonus:damage.melee:fire+1d6')).toMatchObject({
			target: 'damage',
			scope: 'melee',
			damageType: 'fire',
		});
	});
	it('keeps the single-scope and unscoped forms exactly as they were', () => {
		expect(parseToken('flat_bonus:damage.str+2')).toMatchObject({ target: 'damage', scope: 'str' });
		expect(parseToken('flat_bonus:damage+2').scope).toBeUndefined();
	});
	it('a trailing or doubled comma is malformed, not an empty scope', () => {
		expect(parseToken('flat_bonus:damage.melee,+2').kind).toBe('unknown');
		expect(parseToken('flat_bonus:damage.melee,,str+2').kind).toBe('unknown');
	});
});
