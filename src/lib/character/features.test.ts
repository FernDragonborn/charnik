import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter } from './schema';
import { characterFeatures, FEATURE_SECTION } from './features';
import { gatherEffects } from './derive-gather';
import type { ContentGraph } from '../content/loader';

/* Read against REAL SRD content: the point of this module is which rows reach the player, and a
   hand-built fixture would prove nothing about that. */
const S = 'SRD 5.2.1';
let graph: ContentGraph;
beforeAll(async () => {
	graph = await loadPacks('srd-2024');
});

const warlock = () => {
	const c = newCharacter('valen', 'Valen', '5.5e');
	c.build.species = `species:${S}:elf`;
	c.build.background = `background:${S}:sage`;
	c.build.classes = [{ class: `class:${S}:warlock`, level: 3 }];
	return c;
};

describe('characterFeatures — what a character HAS, to read', () => {
	it('lists class features up to the level reached, in level order, with the class that gave them', () => {
		const out = characterFeatures(warlock(), graph);
		const classFeatures = out.filter((f) => f.section === FEATURE_SECTION.classFeatures);
		expect(classFeatures.length).toBeGreaterThan(0);
		expect(classFeatures.every((f) => (f.at ?? 0) <= 3)).toBe(true);
		expect(classFeatures.map((f) => f.at)).toEqual([...classFeatures.map((f) => f.at)].sort());
		expect(classFeatures[0]?.className).toBe('Warlock');
	});

	it('keeps a feature the EFFECT gather drops — prose with no tokens is still something to read', () => {
		const c = warlock();
		const out = characterFeatures(c, graph);
		// the gather keeps only rows carrying effect tokens; this module keeps every row, which is the
		// whole reason it exists rather than reading the sheet's effect list
		const gathered = new Set(
			gatherEffects({
				character: c,
				graph,
				isActive: () => true,
				missing: [],
				issues: [],
			}).map((e) => e.source),
		);
		const proseOnly = out.filter((f) => !gathered.has(String(f.row.data.name_en)));
		expect(proseOnly.length).toBeGreaterThan(0);
	});

	it('separates the origin sections rather than folding them into one blob', () => {
		const sections = new Set(characterFeatures(warlock(), graph).map((f) => f.section));
		expect(sections).toContain(FEATURE_SECTION.speciesTraits);
		expect(sections).toContain(FEATURE_SECTION.background);
	});

	it('answers with nothing for a character who has chosen nothing yet', () => {
		expect(characterFeatures(newCharacter('x', 'X', '5.5e'), graph)).toEqual([]);
	});
});
