import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	abilityModifier,
	proficiencyBonus,
	savingThrow,
	skillCheck,
	passiveScore,
	initiative,
	spellSaveDC,
	spellAttackBonus,
	unarmoredAC,
	armoredAC,
	maxHpForClass,
	carryingCapacity
} from './core';
import type { System } from './pipeline';

describe('primitives (golden SRD values)', () => {
	it('ability modifier', () => {
		expect(abilityModifier(1)).toBe(-5);
		expect(abilityModifier(8)).toBe(-1);
		expect(abilityModifier(10)).toBe(0);
		expect(abilityModifier(11)).toBe(0);
		expect(abilityModifier(15)).toBe(2);
		expect(abilityModifier(20)).toBe(5);
		expect(abilityModifier(30)).toBe(10);
	});

	it('proficiency bonus by level', () => {
		expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonus)).toEqual([
			2, 2, 3, 3, 4, 4, 5, 5, 6, 6
		]);
	});
});

// The formulas are identical across editions; assert both, and the one real divergence.
describe.each<System>(['5e', '5.5e'])('system-agnostic formulas (%s)', () => {
	it('saving throw = ability mod (+ proficiency if proficient)', () => {
		const prof = savingThrow({ ability: 'dex', score: 16, level: 5, proficient: true });
		expect(prof.value).toBe(6); // +3 DEX + 3 prof
		const noProf = savingThrow({ ability: 'dex', score: 16, level: 5, proficient: false });
		expect(noProf.value).toBe(3);
		// the trace explains it
		expect(prof.trace.map((c) => c.source)).toEqual(['DEX mod', 'Proficiency']);
	});

	it('skill: expertise doubles proficiency, half-prof adds floor(prof/2)', () => {
		expect(skillCheck({ ability: 'dex', score: 16, level: 5, proficient: true }).value).toBe(6);
		expect(skillCheck({ ability: 'dex', score: 16, level: 5, expertise: true }).value).toBe(9);
		expect(skillCheck({ ability: 'dex', score: 16, level: 5, halfProficient: true }).value).toBe(4);
		expect(skillCheck({ ability: 'dex', score: 16, level: 5 }).value).toBe(3);
	});

	it('passive score = 10 + check bonus', () => {
		const perception = skillCheck({ ability: 'wis', score: 14, level: 1, proficient: true });
		expect(passiveScore(perception).value).toBe(14); // 10 + (2 wis + 2 prof)
	});

	it('initiative = DEX mod', () => {
		expect(initiative({ dexScore: 18 }).value).toBe(4);
	});

	it('spell DC and attack (wizard INT 16, level 1)', () => {
		expect(spellSaveDC({ ability: 'int', score: 16, level: 1 }).value).toBe(13); // 8+2+3
		expect(spellAttackBonus({ ability: 'int', score: 16, level: 1 }).value).toBe(5); // 2+3
	});

	it('AC: unarmored, and armor with dex caps', () => {
		expect(unarmoredAC({ dexScore: 14 }).value).toBe(12);
		expect(armoredAC({ armorBaseAc: 11, dexScore: 14, dexCap: null }).value).toBe(13); // leather
		expect(armoredAC({ armorBaseAc: 15, dexScore: 18, dexCap: 2 }).value).toBe(17); // half plate
		expect(armoredAC({ armorBaseAc: 16, dexScore: 18, dexCap: 0 }).value).toBe(16); // chain mail
	});

	it('max HP (SRD fixed): barbarian d12 L3 CON 14, wizard d6 L1 CON 12', () => {
		expect(maxHpForClass({ hitDie: 'd12', level: 3, conScore: 14 }).value).toBe(32);
		expect(maxHpForClass({ hitDie: 'd6', level: 1, conScore: 12 }).value).toBe(7);
	});

	it('carrying capacity = STR × 15', () => {
		expect(carryingCapacity({ strScore: 15, system: '5e' }).value).toBe(225);
	});
});

describe('edition divergence', () => {
	it('encumbrance tiers are a 5e-only variant (5.5e drops speed instead)', () => {
		expect(carryingCapacity({ strScore: 15, system: '5e' }).notes).toEqual([
			'Encumbered at 75 lb (−10 ft)',
			'Heavily encumbered at 150 lb (−20 ft)'
		]);
		expect(carryingCapacity({ strScore: 15, system: '5.5e' }).notes).toEqual([
			'Over capacity → speed 5 ft'
		]);
	});
});

describe('invariants (fast-check)', () => {
	it('ability modifier matches floor((s-10)/2) and is monotonic over 1..30', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 30 }), (s) => {
				expect(abilityModifier(s)).toBe(Math.floor((s - 10) / 2));
			})
		);
		for (let s = 2; s <= 30; s++)
			expect(abilityModifier(s)).toBeGreaterThanOrEqual(abilityModifier(s - 1));
	});

	it('proficiency bonus stays in +2..+6 for levels 1..20', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 20 }), (lvl) => {
				const p = proficiencyBonus(lvl);
				expect(p).toBeGreaterThanOrEqual(2);
				expect(p).toBeLessThanOrEqual(6);
			})
		);
	});

	it('a proficient save always equals mod + proficiency', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 30 }),
				fc.integer({ min: 1, max: 20 }),
				(score, level) => {
					const st = savingThrow({ ability: 'con', score, level, proficient: true });
					expect(st.value).toBe(abilityModifier(score) + proficiencyBonus(level));
				}
			)
		);
	});
});
