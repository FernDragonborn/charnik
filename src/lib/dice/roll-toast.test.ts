/*
 * The roll-toast model. Not a rendering test — what's asserted here is the judgement the model makes
 * on the caller's behalf: which rolls count, what the big number is, and how a volley sums up.
 */
import { describe, it, expect } from 'vitest';
import { rollToastModel } from './roll-toast';
import type { RollLogEntry } from '$lib/combat/roll';

const check: RollLogEntry = { label: 'Perception', expr: 'd20(14) +4', total: 18, natural: 14 };

const hit = (natural: number, dmg = 9): RollLogEntry => ({
	label: 'Longsword',
	expr: `d20(${natural}) +7`,
	total: natural + 7,
	natural,
	damage: [{ type: 'slashing', expr: 'd8(6) +3', total: dmg }],
});

describe('rollToastModel', () => {
	it('a roll with no damage has no damage half, and the big number is the roll', () => {
		const m = rollToastModel(check);
		expect(m.damaging).toBe(false);
		expect(m.total).toBe(18);
		expect(m.attacks).toHaveLength(1);
		expect(m.attacks[0]?.damage).toEqual([]);
	});

	it('puts the kept advantage d20 back at the front and keeps the dropped one', () => {
		const m = rollToastModel({
			label: 'Longsword',
			expr: ' +5',
			total: 19,
			advantageRoll: { kept: 14, dropped: 7 },
		});
		expect(m.attacks[0]?.chips[0]).toMatchObject({ sides: 20, value: 14 });
		expect(m.attacks[0]?.dropped).toBe(7);
		expect(m.attacks[0]?.mod).toBe(5);
	});

	it('an attack shows its damage as the big number, not the to-hit', () => {
		const m = rollToastModel(hit(14));
		expect(m.damaging).toBe(true);
		expect(m.attacks[0]?.subtotal).toBe(21);
		expect(m.total).toBe(9);
	});

	it('splits a damage part into its dice and the flat mod folded in', () => {
		const part = rollToastModel(hit(14)).attacks[0]?.damage[0];
		expect(part?.type).toBe('slashing');
		expect(part?.chips.map((c) => c.value)).toEqual([6]);
		expect(part?.mod).toBe(3);
	});

	it('a nat 1 misses — its damage is left out of the total', () => {
		const m = rollToastModel(hit(1));
		expect(m.attacks[0]?.natural).toBe(1);
		expect(m.total).toBe(0);
	});

	it('a volley gets a line each, per-type sums, and one grand total', () => {
		const m = rollToastModel([hit(13, 9), hit(20, 12), hit(4, 7)]);
		expect(m.attacks).toHaveLength(3);
		expect(m.byType).toEqual([{ type: 'slashing', total: 28 }]);
		expect(m.total).toBe(28);
	});

	it('a missed attack drops out of the volley’s per-type sums too', () => {
		const m = rollToastModel([hit(13, 9), hit(1, 12)]);
		expect(m.byType).toEqual([{ type: 'slashing', total: 9 }]);
		expect(m.total).toBe(9);
	});

	it('keeps per-type order as the lines read, not alphabetical', () => {
		const volley: RollLogEntry[] = [
			{
				label: 'Flurry of Blows',
				expr: 'd20(13) +7',
				total: 20,
				natural: 13,
				damage: [
					{ type: 'bludgeoning', expr: 'd6(5) +4', total: 9 },
					{ type: 'radiant', expr: 'd4(3)', total: 3 },
				],
			},
			{
				label: 'Flurry of Blows',
				expr: 'd20(9) +7',
				total: 16,
				natural: 9,
				damage: [{ type: 'radiant', expr: 'd4(2)', total: 2 }],
			},
		];
		expect(rollToastModel(volley).byType.map((t) => t.type)).toEqual(['bludgeoning', 'radiant']);
	});

	it('a single roll gets no footer — the big number already is the sum', () => {
		expect(rollToastModel(hit(14)).byType).toEqual([]);
	});
});
