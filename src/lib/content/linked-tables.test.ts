import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { linkOf, linkedLevel, linkedPrefill, linkedRowsOf } from './linked-tables';
import type { ContentGraph, LoadedRow } from './loader';

/*
 * HOMEBREW-LINKED: the join rules an article's linked list and its Add button run on. Read against
 * the REAL packs, because the failure worth catching is a column renamed in the schema and left
 * behind here — which a fixture would happily agree with.
 */
const rowOf = (
	graph: ContentGraph,
	type: 'class' | 'subclass' | 'species' | 'resource',
	id: string,
): LoadedRow => {
	const row = graph.list(type).find((r) => r.id === id);
	if (!row) throw new Error(`fixture row missing: ${type}:${id}`);
	return row;
};

describe('linked tables · which rows an article owns', () => {
	it("a class lists only its OWN features — a subclass's rows belong to the subclass", async () => {
		const g = await loadPacks('srd-2024');
		const cleric = linkedRowsOf(g, rowOf(g, 'class', 'cleric')).map((r) => r.id);
		const lifeDomain = linkedRowsOf(g, rowOf(g, 'subclass', 'life_domain')).map((r) => r.id);
		expect(cleric).toContain('cleric_channel_divinity');
		expect(cleric.some((id) => lifeDomain.includes(id))).toBe(false);
		expect(lifeDomain).toContain('life_domain_preserve_life');
		// and they read in level order, which is the only order a feature list is useful in
		const levels = linkedRowsOf(g, rowOf(g, 'class', 'cleric')).map(linkedLevel);
		expect(levels).toEqual([...levels].sort((a, b) => a - b));
	});

	it('a species owns its lineages and a resource owns its spend options', async () => {
		const g2014 = await loadPacks('srd-2014');
		expect(linkedRowsOf(g2014, rowOf(g2014, 'species', 'elf')).map((r) => r.id)).toContain(
			'high_elf',
		);
		const g = await loadPacks('srd-2024');
		expect(linkedRowsOf(g, rowOf(g, 'resource', 'rage')).length).toBeGreaterThan(0);
	});

	it('a type with no linked table has none, so its article shows no section', async () => {
		const g = await loadPacks('srd-2024');
		const fireball = g.list('spell').find((r) => r.id === 'fireball');
		expect(linkOf(fireball!)).toBeUndefined();
		expect(linkedRowsOf(g, fireball!)).toEqual([]);
	});

	it('the prefill carries every join a person cannot guess, plus the required level', async () => {
		const g = await loadPacks('srd-2024');
		expect(linkedPrefill(rowOf(g, 'subclass', 'life_domain'))).toEqual({
			class_id: 'cleric', // carried from the subclass — a feature needs BOTH ids
			subclass_id: 'life_domain',
			systems: '5.5e',
			level: '1',
		});
		expect(linkedPrefill(rowOf(g, 'species', 'elf'))).toEqual({
			species_id: 'elf',
			systems: '5.5e',
		});
	});
});
