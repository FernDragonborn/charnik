import { describe, it, expect } from 'vitest';
import { ammunitionStacks, firedAmmunition, AMMUNITION_CATEGORY } from './ammunition';

const tags = (...pairs: [string, string][]) => new Map(pairs);

describe('firedAmmunition', () => {
	it('names the kind a 5.5e weapon fires', () => {
		expect(firedAmmunition(tags(['ammunition', '150/600'], ['ammo', 'arrow']))).toEqual({
			kind: 'arrow',
		});
	});
	it('fires ammunition of no stated kind when the source never says (SRD 5.1)', () => {
		expect(firedAmmunition(tags(['ammunition', '150/600']))).toEqual({ kind: null });
	});
	it('is undefined for a weapon that fires nothing', () => {
		expect(firedAmmunition(tags(['melee', '']))).toBeUndefined();
	});
});

describe('ammunitionStacks', () => {
	const arrows = { category: AMMUNITION_CATEGORY, tags: tags(['ammo', 'arrow']) };
	const bolts = { category: AMMUNITION_CATEGORY, tags: tags(['ammo', 'bolt']) };
	const rope = { category: 'gear', tags: tags() };
	it('keeps the stacks of the fired kind', () => {
		expect(ammunitionStacks({ kind: 'arrow' }, [arrows, bolts, rope])).toEqual([arrows]);
	});
	it('keeps every stack of ammunition when the weapon names no kind', () => {
		expect(ammunitionStacks({ kind: null }, [arrows, bolts, rope])).toEqual([arrows, bolts]);
	});
});
