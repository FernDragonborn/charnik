import { describe, it, expect } from 'vitest';
import { parseUpcast, evalUpcast, combinePools, type UpcastResult } from './upcast';
import type { ExprContext } from './expression-evaluator';

/** A cast ctx backed by plain maps — a spell of base level `sl` cast from slot `s`. */
const at = (s: number, sl: number): ExprContext => ({
	number: (n) => (n === 'slot' ? s : n === 'spell_level' ? sl : undefined),
	boolean: (n) => (n === 'is_bloodied' ? false : undefined),
	enum: () => undefined
});

/** The single (successful) result of a one-token cell. */
function one(cell: string, ctx: ExprContext): UpcastResult {
	const rs = evalUpcast(cell, ctx);
	const r = rs[0];
	if (!r || 'error' in r) throw new Error(`expected a result, got ${JSON.stringify(r)}`);
	return r;
}

describe('UPCAST · parseUpcast — grammar', () => {
	it('parses a linear damage delta (Fireball)', () => {
		expect(parseUpcast('damage:per_slot(1d6)')).toEqual([
			{ kind: 'damage', formula: 'per_slot(1d6)', combine: 'delta', raw: 'damage:per_slot(1d6)' }
		]);
	});

	it('parses a typed damage sub-slot (Ice Storm) — type between kind and formula', () => {
		expect(parseUpcast('damage:bludgeoning:per_slot(1d8)')).toEqual([
			{
				kind: 'damage',
				type: 'bludgeoning',
				formula: 'per_slot(1d8)',
				combine: 'delta',
				raw: 'damage:bludgeoning:per_slot(1d8)'
			}
		]);
	});

	it('marks count/area/duration as ABSOLUTE, damage/heal/hp_max/temp_hp as DELTA', () => {
		const kindOf = (cell: string) => {
			const t = parseUpcast(cell)[0];
			return t && !('error' in t) ? t.combine : 'ERR';
		};
		expect(kindOf('count:slot+1')).toBe('absolute');
		expect(kindOf('area:per_slot(10)')).toBe('absolute');
		expect(kindOf('duration:slot+1')).toBe('absolute');
		expect(kindOf('heal:per_slot(1d8)')).toBe('delta');
		expect(kindOf('hp_max:per_slot(5)')).toBe('delta');
		expect(kindOf('temp_hp:per_slot(5)')).toBe('delta');
		expect(kindOf('enhancement:step(slot, 2->1, 4->2, 6->3)')).toBe('absolute');
	});

	it('rejects a `:type` sub-slot on enhancement (only damage/heal are typed)', () => {
		expect(parseUpcast('enhancement:melee:slot+1')[0]).toMatchObject({
			error: expect.stringContaining('cannot carry a type')
		});
	});

	it('splits a multi-dimension cell on `;` (Web: duration + damage)', () => {
		const ts = parseUpcast('duration:slot+1; damage:per_slot(1d4)');
		expect(ts).toHaveLength(2);
		expect(ts.map((t) => ('error' in t ? 'ERR' : t.kind))).toEqual(['duration', 'damage']);
	});

	it('degrades a malformed / unknown / mis-typed token to a parse error (H11)', () => {
		expect(parseUpcast('nonsense:1d6')[0]).toMatchObject({
			error: expect.stringContaining('unknown')
		});
		expect(parseUpcast('damage')[0]).toMatchObject({ error: expect.any(String) });
		// a `:type` sub-slot is only legal on damage/heal, not count
		expect(parseUpcast('count:fire:slot+1')[0]).toMatchObject({
			error: expect.stringContaining('cannot carry a type')
		});
	});

	it('ignores blank tokens / an empty cell', () => {
		expect(parseUpcast('')).toEqual([]);
		expect(parseUpcast(undefined)).toEqual([]);
		expect(parseUpcast('damage:per_slot(1d6);;')).toHaveLength(1);
	});
});

describe('UPCAST · evalUpcast — evaluation against a cast ctx', () => {
	it('Fireball: 8d6 base + per_slot(1d6) delta at slots 3/5/9', () => {
		expect(one('damage:per_slot(1d6)', at(3, 3))).toMatchObject({ pool: {}, flat: 0 });
		expect(one('damage:per_slot(1d6)', at(5, 3))).toMatchObject({ pool: { 6: 2 }, flat: 0 });
		expect(one('damage:per_slot(1d6)', at(9, 3))).toMatchObject({ pool: { 6: 6 }, flat: 0 });
	});

	it('Cure Wounds: heal delta per_slot(1d8)', () => {
		expect(one('heal:per_slot(1d8)', at(2, 1))).toMatchObject({
			kind: 'heal',
			combine: 'delta',
			pool: { 8: 1 }
		});
	});

	it('Magic Weapon: enhancement is the ABSOLUTE +n bonus stepped by slot (2->1, 4->2, 6->3)', () => {
		const f = 'enhancement:step(slot, 2->1, 4->2, 6->3)';
		expect(one(f, at(2, 2))).toMatchObject({ kind: 'enhancement', combine: 'absolute', flat: 1 });
		expect(one(f, at(3, 2)).flat).toBe(1); // slot 3 still +1 (below the +2 tier)
		expect(one(f, at(4, 2)).flat).toBe(2);
		expect(one(f, at(6, 2)).flat).toBe(3);
	});

	it('Scorching Ray: count is the ABSOLUTE total slot+1', () => {
		expect(one('count:slot+1', at(2, 2))).toMatchObject({ combine: 'absolute', flat: 3 });
		expect(one('count:slot+1', at(5, 2))).toMatchObject({ flat: 6 });
	});

	it('duration may be inf (permanent) — the one kind that allows it (N3)', () => {
		const r = one('duration:step(slot, 5->30, 9->inf)', at(9, 5));
		expect(r).toMatchObject({ kind: 'duration', isInfinite: true, flat: 0 });
		expect(one('duration:step(slot, 5->30, 9->inf)', at(5, 5))).toMatchObject({ flat: 30 });
	});

	it('rejects inf on a non-duration kind (would poison base+delta arithmetic)', () => {
		expect(evalUpcast('damage:step(slot, 9->inf)', at(9, 3))[0]).toMatchObject({
			error: expect.stringContaining('duration')
		});
	});

	it('degrades a broken formula to an error (content-health, not silent-wrong dice)', () => {
		expect(evalUpcast('damage:1d6 +', at(5, 3))[0]).toMatchObject({ error: expect.any(String) });
		expect(evalUpcast('count:1/0', at(5, 3))[0]).toMatchObject({
			error: expect.stringContaining('division')
		});
	});

	it('honours an optional guard prefix (false guard → 0 contribution)', () => {
		expect(one('is_bloodied ? damage:per_slot(1d6)', at(5, 3))).toMatchObject({
			pool: {},
			flat: 0
		});
	});

	it('floors a fractional numeric total (5e round-down)', () => {
		expect(one('area:slot/2', at(5, 1))).toMatchObject({ flat: 2 }); // 5/2 = 2.5 → 2
	});
});

describe('UPCAST · combinePools — base + delta merge', () => {
	it('adds a delta pool onto the base and sums flats', () => {
		expect(combinePools({ 6: 8 }, 0, { 6: 2 }, 0)).toEqual({ pool: { 6: 10 }, flat: 0 });
		expect(combinePools({ 8: 1 }, 3, {}, 10)).toEqual({ pool: { 8: 1 }, flat: 13 });
		expect(combinePools({}, 0, { 4: 1 }, 0)).toEqual({ pool: { 4: 1 }, flat: 0 });
	});

	it('does not mutate the base pool', () => {
		const base = { 6: 8 };
		combinePools(base, 0, { 6: 2 }, 0);
		expect(base).toEqual({ 6: 8 });
	});
});
