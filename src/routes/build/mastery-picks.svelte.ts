/*
 * Weapon mastery: which KINDS of weapon this character has drilled (MASTERY-HALF).
 *
 * The weapon half has always been data — every 2024 weapon carries its one `mastery:<name>` tag — and
 * nothing read it, because RAW the property does nothing until a feature unlocks that kind of weapon
 * for you. This is that feature: a capped pick over the weapons you are proficient with, its count
 * read off the class's own `mastery_slots` ladder.
 *
 * 2014 has no such rule, ships no `mastery_slots` and no `mastery:` tag, so the cap is 0 there and
 * every surface that asks about mastery gets nothing rather than a 5.5e idea leaking into it.
 */
import { masteryBudget } from '$lib/build/derive';
import { weaponProfGrants } from '$lib/combat/attacks';
import { isWeaponProficient } from '$lib/rules/proficiency';
import { ITEM_TAG, parseItemTags, weaponCategoryOf } from '$lib/content/item-tags';
import type { LoadedRowByType } from '$lib/content/loader';
import { toggleCapped } from './draft';
import type { BuildVM } from './build-view-model.svelte';

/** What the picker needs from the build view-model around it. `import type` is erased, so picking the
 *  shape off the class costs no runtime cycle and cannot drift from it. */
export type MasteryPicksHost = Pick<BuildVM, 'draft' | 'graph' | 'sheet'>;

export class MasteryPicks {
	/* The host arrives as an ACCESSOR: a `$derived` field initialiser runs before a constructor
	   parameter property is assigned. */
	constructor(private host: () => MasteryPicksHost) {}

	/** How many weapon kinds the drafted classes have unlocked. 0 → the character has no such rule. */
	cap = $derived.by(() => {
		const graph = this.host().graph;
		return graph ? masteryBudget(this.host().draft.classes, graph, this.host().draft.system) : 0;
	});

	/** The weapons that HAVE a mastery property and that this character is proficient with — the two
	 *  halves RAW asks for ("kinds of weapons of your choice with which you have proficiency"). */
	options = $derived.by<LoadedRowByType<'item'>[]>(() => {
		const { graph, sheet } = this.host();
		if (!graph || !sheet || this.cap === 0) return [];
		// the DRAFT's classes, not the assembled character's: assembling reads this picker's own picks,
		// and a question about what may be picked must not depend on the answer
		const classes = this.host().draft.classes.flatMap((c) => (c.classId ? [{ class: c.classId }] : []));
		const grants = weaponProfGrants(classes, sheet.facts, graph);
		return graph
			.list('item', { system: this.host().draft.system })
			.filter((row) => {
				if (row.data.category !== 'weapon') return false;
				const tags = parseItemTags(row.data.tags);
				if (!tags.get(ITEM_TAG.mastery)) return false;
				return isWeaponProficient(grants, weaponCategoryOf(tags), row.data.id);
			})
			.sort((a, b) => String(a.data.name_en).localeCompare(String(b.data.name_en)));
	});

	/** The picks, trimmed to what the character still unlocks — dropping a class level must not leave
	 *  the surplus behind, the same way every other capped picker here behaves. */
	picks = $derived.by(() => this.host().draft.masteries.slice(0, this.cap));

	/** The mastery property one weapon id carries (`vex`), or '' — the weapon half of the fact. */
	propertyOf = (weaponId: string): string => {
		const row = this.options.find((r) => r.data.id === weaponId);
		return row ? (parseItemTags(row.data.tags).get(ITEM_TAG.mastery) ?? '') : '';
	};

	/** Toggle a weapon kind. Capped like every other capped picker here: at the cap a click REPLACES
	 *  the oldest, because nothing on screen says to un-pick first (ui.md §10). */
	toggle = (weaponId: string) => {
		this.host().draft.masteries = toggleCapped(this.host().draft.masteries, weaponId, this.cap);
	};
}
