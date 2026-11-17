import { describe, expect, it } from 'vitest';
import { meetsMulticlassPrereq, multiclassPrereq } from './multiclass';

describe('multiclass prerequisites (audit-oct-27 R14)', () => {
	const scores = { str: 14, dex: 12, con: 10, int: 10, wis: 13, cha: 8 };
	const of = (a: keyof typeof scores) => scores[a];
	it('reads `|` as or and `,` as and', () => {
		expect(multiclassPrereq('str|dex')).toEqual([['str'], ['dex']]);
		expect(multiclassPrereq('dex, wis')).toEqual([['dex', 'wis']]);
		expect(multiclassPrereq('')).toEqual([]);
	});
	it('meets a fighter (STR or DEX) and misses a monk (DEX and WIS)', () => {
		expect(meetsMulticlassPrereq(multiclassPrereq('str|dex'), of)).toBe(true);
		expect(meetsMulticlassPrereq(multiclassPrereq('dex,wis'), of)).toBe(false);
		expect(meetsMulticlassPrereq(multiclassPrereq(undefined), of)).toBe(true);
	});
});
