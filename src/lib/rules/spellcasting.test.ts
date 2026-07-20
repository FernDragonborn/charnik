import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	shareContribution,
	shareFromCaster,
	effectiveCasterLevel,
	slotCountsFor,
	maxSpellLevel,
	preparedCap,
	slotPools,
	cantripDieMultiplier,
	type SlotTable
} from './spellcasting';

describe('cantrip damage scaling (A15 — 5/11/17 steps, both editions)', () => {
	it('steps the die multiplier at levels 5, 11, 17', () => {
		expect(cantripDieMultiplier(1)).toBe(1);
		expect(cantripDieMultiplier(4)).toBe(1);
		expect(cantripDieMultiplier(5)).toBe(2); // Fire Bolt 1d10 → 2d10
		expect(cantripDieMultiplier(10)).toBe(2);
		expect(cantripDieMultiplier(11)).toBe(3);
		expect(cantripDieMultiplier(16)).toBe(3);
		expect(cantripDieMultiplier(17)).toBe(4);
		expect(cantripDieMultiplier(20)).toBe(4);
	});
});

describe('caster level (multiclass)', () => {
	it('contributions round per share', () => {
		expect(shareContribution('full', 5)).toBe(5);
		expect(shareContribution('half', 5)).toBe(2); // ⌊5/2⌋
		expect(shareContribution('half_up', 5)).toBe(3); // ⌈5/2⌉ — Artificer
		expect(shareContribution('third', 7)).toBe(2); // ⌊7/3⌋ — EK/AT
		expect(shareContribution('none', 20)).toBe(0); // warlock/pact
	});

	it('sums contributions — NOT the senior class', () => {
		// Wizard 5 / Cleric 5 → level-10 full caster, not wizard-5
		expect(
			effectiveCasterLevel([
				{ share: 'full', level: 5 },
				{ share: 'full', level: 5 }
			])
		).toBe(10);
		// Paladin 6 (half) / Fighter-EK 3 (third) → 3 + 1 = 4
		expect(
			effectiveCasterLevel([
				{ share: 'half', level: 6 },
				{ share: 'third', level: 3 }
			])
		).toBe(4);
	});

	it('defaults share from the caster column; pact contributes nothing', () => {
		expect(shareFromCaster('full')).toBe('full');
		expect(shareFromCaster('half')).toBe('half');
		expect(shareFromCaster('pact')).toBe('none');
		expect(shareFromCaster(undefined)).toBe('none');
		// a pure warlock's shared level is 0 (its pact pool is separate)
		expect(effectiveCasterLevel([{ share: shareFromCaster('pact'), level: 9 }])).toBe(0);
	});

	it('effective level never exceeds total level (invariant)', () => {
		const share = fc.constantFrom('full', 'half', 'half_up', 'third', 'none') as fc.Arbitrary<
			'full' | 'half' | 'half_up' | 'third' | 'none'
		>;
		fc.assert(
			fc.property(fc.array(fc.record({ share, level: fc.integer({ min: 1, max: 20 }) })), (es) => {
				const total = es.reduce((n, e) => n + e.level, 0);
				return effectiveCasterLevel(es) <= total;
			})
		);
	});
});

describe('slots + caps', () => {
	const full: SlotTable = new Map([
		[1, [2, 0, 0, 0, 0, 0, 0, 0, 0]],
		[5, [4, 3, 2, 0, 0, 0, 0, 0, 0]]
	]);
	const pact: SlotTable = new Map([[9, [0, 0, 0, 0, 2, 0, 0, 0, 0]]]);

	it('looks up slot counts (clamped) and max spell level', () => {
		expect(slotCountsFor(full, 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
		expect(maxSpellLevel(slotCountsFor(full, 5))).toBe(3);
		expect(maxSpellLevel(slotCountsFor(full, 1))).toBe(1); // wizard L1 → only 1st
		expect(maxSpellLevel(slotCountsFor(pact, 9))).toBe(5); // warlock L9 → 5th max
	});

	it('preparedCap uses the table value, else the formula fallback', () => {
		expect(preparedCap(9, { abilityMod: 3, share: 'full', level: 5 })).toBe(9); // 2024 table
		expect(preparedCap(undefined, { abilityMod: 3, share: 'full', level: 5 })).toBe(8); // 3+5
		expect(preparedCap(undefined, { abilityMod: 3, share: 'half', level: 6 })).toBe(6); // 3+⌊6/2⌋
	});

	it('slotPools → one pool per non-empty level; warlock forces upcast', () => {
		const pools = slotPools(slotCountsFor(full, 5), { idPrefix: 'slot', recharge: 'long' });
		expect(pools.map((p) => [p.spellLevel, p.max])).toEqual([
			[1, 4],
			[2, 3],
			[3, 2]
		]);
		const pactPools = slotPools(slotCountsFor(pact, 9), {
			idPrefix: 'pact',
			recharge: 'short',
			forcedUpcast: true
		});
		expect(pactPools).toHaveLength(1);
		expect(pactPools[0]).toMatchObject({
			spellLevel: 5,
			max: 2,
			recharge: 'short',
			forcedUpcast: true
		});
	});
});
