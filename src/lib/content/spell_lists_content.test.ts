/*
 * The SHIPPED 2014 class spell lists, against the SRD's own counts.
 *
 * The 2014 `classes` column is produced by `tools/srd/convert-2014-spell-lists.mjs` from the official
 * CC-BY SRD 5.1 PDF — not from the Tabyltop conversion the other 2014 converters read, because that
 * one keeps only some of each page's columns and silently drops 227 of the document's 778 list
 * entries. That loss is invisible in the CSV (a short list is still a valid list), and it left a 2014
 * bard with nothing at 1st level and a 2014 wizard 51 spells short. So the counts are pinned here.
 *
 * The numbers below are the SRD 5.1 Spell Lists section's own, counted off it.
 */
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';

/** class id → how many spells SRD 5.1 lists for it. */
const SRD_5_1_LIST_SIZE: Record<string, number> = {
	bard: 112,
	cleric: 105,
	druid: 105,
	paladin: 31,
	ranger: 37,
	sorcerer: 120,
	warlock: 64,
	wizard: 204,
};

describe('SRD 5.1 class spell lists (shipped)', () => {
	it('every class lists exactly what the SRD lists, and no spell is on no list', async () => {
		const graph = await loadPacks('srd-2014');
		const spells = graph.list('spell', { system: '5e' });
		expect(spells.length).toBe(319);

		const counts: Record<string, number> = {};
		const orphans: string[] = [];
		for (const row of spells) {
			const classes = String(row.data.classes ?? '')
				.split(',')
				.map((c) => c.trim())
				.filter(Boolean);
			if (!classes.length) orphans.push(row.data.id);
			for (const c of classes) counts[c] = (counts[c] ?? 0) + 1;
		}
		// the SRD's lists name every spell the SRD describes, so a spell on no list means the
		// extraction lost a column — the exact failure the PDF rewrite exists to stop
		expect(orphans).toEqual([]);
		expect(counts).toEqual(SRD_5_1_LIST_SIZE);
	});

	it('a 2014 bard has spells at EVERY level it can cast, 1st included', async () => {
		const graph = await loadPacks('srd-2014');
		const byLevel = new Set(
			graph
				.list('spell', { system: '5e' })
				.filter((r) => String(r.data.classes ?? '').includes('bard'))
				.map((r) => Number(r.data.level)),
		);
		expect([...byLevel].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});
});
