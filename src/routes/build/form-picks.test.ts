/*
 * Known forms in the builder, against the shipped packs. SRD 5.2.1 ▸ Druid ▸ Wild Shape: "You know
 * four Beast forms for this feature, chosen from among Beast stat blocks that have a maximum
 * Challenge Rating of 1/4 and that lack a Fly Speed"; the Beast Shapes table raises it to six at
 * level 4 and eight at level 8. SRD 5.1 has no such list — a druid there takes any eligible beast.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { build } from './build-view-model.svelte';
import { newClassRow } from './draft';

async function draftDruid(pack: 'srd-2014' | 'srd-2024', level: number) {
	const [source, system] = pack === 'srd-2014' ? ['SRD 5.1', '5e'] : ['SRD 5.2.1', '5.5e'];
	build.reset();
	build.graph = await loadPacks(pack);
	build.draft.system = system as typeof build.draft.system;
	build.draft.name = 'Fern';
	build.draft.classes = [
		{ ...newClassRow(), classId: `class:${source}:druid`, subclassId: null, level },
	];
	return source;
}

describe('known forms · the builder asks for what the feature says is chosen ahead', () => {
	it('2024: nothing at level 1, four at level 2, eight at level 8 — and the todo says so', async () => {
		await draftDruid('srd-2024', 1);
		expect(build.formPicks.cap).toBe(0);
		expect(build.todos.map((t) => t.kind)).not.toContain('forms');

		const source = await draftDruid('srd-2024', 2);
		const [choice] = build.formPicks.choices;
		expect(choice?.cap).toBe(4);
		const offered = choice?.options.map((row) => row.id) ?? [];
		// the four the SRD recommends are all there; a beast past the level's limit is not
		for (const id of ['rat', 'riding_horse', 'spider', 'wolf']) expect(offered).toContain(id);
		expect(offered).not.toContain('crocodile'); // CR 1/2
		expect(build.todos.find((t) => t.kind === 'forms')?.values).toEqual({ count: 4 });

		if (choice) build.formPicks.toggle(choice, `monster:${source}:wolf`);
		expect(build.formPicks.chosen).toBe(1);
		expect(build.assembled.build.forms).toEqual({ wild_shape: [`monster:${source}:wolf`] });
		expect(build.todos.find((t) => t.kind === 'forms')?.values).toEqual({ count: 3 });

		build.draft.classes = build.draft.classes.map((c) => ({ ...c, level: 8 }));
		expect(build.formPicks.cap).toBe(8);
	});

	it('at the cap a pick replaces the oldest, and a pick the level no longer allows is dropped', async () => {
		const source = await draftDruid('srd-2024', 4);
		const ref = (id: string) => `monster:${source}:${id}`;
		build.draft.forms = { wild_shape: ['crocodile', 'wolf', 'rat', 'spider', 'riding_horse'].map(ref) };
		expect(build.formPicks.chosen).toBe(5);
		// back at level 2 the crocodile (CR 1/2) is no longer eligible, and four is the cap
		build.draft.classes = build.draft.classes.map((c) => ({ ...c, level: 2 }));
		const [choice] = build.formPicks.choices;
		expect(choice?.picks).toEqual(['wolf', 'rat', 'spider', 'riding_horse'].map(ref));
		if (choice) build.formPicks.toggle(choice, ref('badger'));
		expect(build.formPicks.choices[0]?.picks).toEqual(
			['rat', 'spider', 'riding_horse', 'badger'].map(ref),
		);
	});

	it('2014 asks for nothing: its druid takes any eligible beast at the table', async () => {
		await draftDruid('srd-2014', 8);
		expect(build.formPicks.choices).toEqual([]);
		expect(build.todos.map((t) => t.kind)).not.toContain('forms');
	});
});
