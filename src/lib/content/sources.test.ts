import { describe, it, expect } from 'vitest';
import { makeRow } from './test-utils';
import { isRowActive, detectCollisions } from './sources.svelte';
import type { ContentGraph, LoadedRow } from './loader';

const cfg = (over: Partial<Parameters<typeof isRowActive>[1]> = {}) => ({
	disabledFiles: [],
	disabledSources: [],
	collisions: {},
	...over
});

// makeRow gives root:'test', file:'<type>.csv'
const row = (id: string, source: string, systems: string[]) => {
	const r = makeRow('condition', { id, name_en: id }, source) as LoadedRow;
	return { ...r, systems } as LoadedRow;
};

describe('two-dimensional source filtering', () => {
	it('hides a row whose FILE is disabled', () => {
		const r = row('blinded', 'SRD 5.1', ['5e']);
		expect(isRowActive(r, cfg())).toBe(true);
		expect(isRowActive(r, cfg({ disabledFiles: ['test/condition.csv'] }))).toBe(false);
	});

	it('hides a row whose SOURCE tag is disabled', () => {
		const r = row('blinded', 'SRD 5.1', ['5e']);
		expect(isRowActive(r, cfg({ disabledSources: ['SRD 5.1'] }))).toBe(false);
		expect(isRowActive(r, cfg({ disabledSources: ['SRD 5.2.1'] }))).toBe(true);
	});

	it('keep-one collision hides the losing sources, keeps the chosen one', () => {
		const srd = row('fireball', 'SRD 5.1', ['5e']);
		const hb = row('fireball', 'Homebrew', ['5e']);
		const keepHb = cfg({ collisions: { 'condition:fireball': 'Homebrew' } });
		expect(isRowActive(hb, keepHb)).toBe(true);
		expect(isRowActive(srd, keepHb)).toBe(false);
		// 'all' (default / explicit) keeps both
		expect(isRowActive(srd, cfg())).toBe(true);
		expect(isRowActive(srd, cfg({ collisions: { 'condition:fireball': 'all' } }))).toBe(true);
	});
});

describe('collision detection', () => {
	const graphWith = (rows: LoadedRow[]): ContentGraph => {
		const articles = new Map<string, LoadedRow[]>();
		for (const r of rows) {
			const k = `${r.type}:${r.id}`;
			articles.set(k, [...(articles.get(k) ?? []), r]);
		}
		return { articles } as ContentGraph;
	};

	it('flags a same-id pair that OVERLAPS an edition (real ambiguity)', () => {
		const g = graphWith([row('fireball', 'SRD 5.1', ['5e']), row('fireball', 'Homebrew', ['5e'])]);
		const cols = detectCollisions(g);
		expect(cols).toHaveLength(1);
		expect(cols[0]?.sources.sort()).toEqual(['Homebrew', 'SRD 5.1']);
	});

	it('does NOT flag the disjoint 5e/5.5e SRD pair (coexist via the edition toggle)', () => {
		const g = graphWith([
			row('fireball', 'SRD 5.1', ['5e']),
			row('fireball', 'SRD 5.2.1', ['5.5e'])
		]);
		expect(detectCollisions(g)).toHaveLength(0);
	});

	it('ignores a single-source id', () => {
		expect(detectCollisions(graphWith([row('fireball', 'SRD 5.1', ['5e'])]))).toHaveLength(0);
	});
});
