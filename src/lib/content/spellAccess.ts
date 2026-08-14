/*
 * Spell ↔ class access — the bidirectional UNION index (docs/PLAN.md "Spellcasting model").
 *
 * A spell is accessible to a class from EITHER direction, so neither edits the other's files:
 *   - spell-side: the spell row's `classes` column (shipped SRD tags its classes inline), or
 *   - class-side: an additive `spell_lists` row (`class_id`,`spell_id`) — a homebrew class grants
 *     access to existing spells without touching them.
 * A casting SUBCLASS is indexed as its own access key, because RAW it draws another class's list
 * (Eldritch Knight / Arcane Trickster cast from the Wizard list — B25). Which list is DATA: the
 * subclass row's `spell_list` column, so no class name is ever branched on in code.
 * We union both into `class → spells` and the reverse `spell → classes`, carrying provenance
 * (`via`) for the explainable invariant. Edition-scoped: a class only reaches spells it shares a
 * system with (a 2024 wizard doesn't get 2014 spells).
 *
 * This is a CONTENT-level index (pure function of the graph). Character-specific grants
 * (subclass / feat / item / race) layer on top later, in the character derive — not here.
 */
import type { ContentGraph, LoadedRow } from './loader';
import { splitList } from './schemas';

type AccessVia = 'class_list' | 'spell_list' | 'subclass_list';

interface AccessEntry {
	/** Bare class id (e.g. "wizard") — or subclass id for a `subclass_list` entry. */
	classId: string;
	/** The row's effectiveId (`class:source:id`, or `subclass:source:id`) — edition/source-specific. */
	classEffectiveId: string;
	via: AccessVia;
}

export interface SpellAccess {
	/** Spell effectiveIds a given class row can access. */
	spellIdsForClass(classEffectiveId: string): string[];
	/** Which classes can access a given spell (with provenance), for the compendium. */
	classesForSpell(spellEffectiveId: string): AccessEntry[];
}

const csv = splitList;

const shareEdition = (a: string[], b: string[]) => a.some((s) => b.includes(s));

/** Bare id → every row carrying it (one per edition/source). Both indexes are built this way. */
function rowsByBareId(rows: LoadedRow[]): Map<string, LoadedRow[]> {
	const byId = new Map<string, LoadedRow[]>();
	for (const row of rows) {
		const arr = byId.get(row.id) ?? [];
		arr.push(row);
		byId.set(row.id, arr);
	}
	return byId;
}

/** Records one class↔spell edge, edition-checked and deduped. */
type Link = (cls: LoadedRow, spell: LoadedRow, via: AccessVia) => void;

/**
 * Subclass pass: a casting subclass draws the spell LIST of the class(es) its `spell_list` column
 * names (B25). Runs LAST so it copies whatever the two earlier passes resolved for that class —
 * including `spell_lists` grants, so a homebrew class's additive rows reach its subclasses too.
 */
function linkSubclassLists(
	graph: ContentGraph,
	classesById: Map<string, LoadedRow[]>,
	forClass: Map<string, Set<string>>,
	link: Link,
): void {
	for (const sub of graph.list('subclass')) {
		const drawnFrom = csv(sub.data.spell_list).flatMap((bare) => classesById.get(bare) ?? []);
		for (const cls of drawnFrom) {
			if (!shareEdition(cls.systems, sub.systems)) continue;
			for (const spellEid of forClass.get(cls.effectiveId) ?? []) {
				const spell = graph.get(spellEid);
				if (spell) link(sub, spell, 'subclass_list');
			}
		}
	}
}

/** Build the union access index from the content graph (pure). */
export function buildSpellAccess(graph: ContentGraph): SpellAccess {
	const spellRows = graph.list('spell');
	const classesById = rowsByBareId(graph.list('class'));
	const spellsById = rowsByBareId(spellRows);

	const forClass = new Map<string, Set<string>>(); // classEID → spell EIDs
	const forSpell = new Map<string, AccessEntry[]>(); // spellEID → entries
	const seen = new Set<string>(); // `${classEID}|${spellEID}` dedup

	const link = (cls: LoadedRow, spell: LoadedRow, via: AccessVia) => {
		if (!shareEdition(cls.systems, spell.systems)) return;
		const key = `${cls.effectiveId}|${spell.effectiveId}`;
		if (seen.has(key)) return;
		seen.add(key);
		let classSpells = forClass.get(cls.effectiveId);
		if (!classSpells) forClass.set(cls.effectiveId, (classSpells = new Set()));
		classSpells.add(spell.effectiveId);
		let spellClasses = forSpell.get(spell.effectiveId);
		if (!spellClasses) forSpell.set(spell.effectiveId, (spellClasses = []));
		spellClasses.push({ classId: cls.id, classEffectiveId: cls.effectiveId, via });
	};

	// spell-side: inline `classes` column
	for (const spell of spellRows)
		for (const bareClass of csv(spell.data.classes))
			for (const cls of classesById.get(bareClass) ?? []) link(cls, spell, 'class_list');

	// class-side: additive spell_lists join. An orphan join (unknown class_id or spell_id) resolves
	// to [] → skipped here; the loader flags it as a content-health WARNING (likely a typo), so a
	// dangling grant is harmless in the index but surfaced to the user.
	for (const row of graph.list('spell_lists')) {
		const cls = classesById.get(String(row.data.class_id)) ?? [];
		const sp = spellsById.get(String(row.data.spell_id)) ?? [];
		for (const c of cls) for (const s of sp) link(c, s, 'spell_list');
	}

	linkSubclassLists(graph, classesById, forClass, link);

	return {
		spellIdsForClass: (id) => [...(forClass.get(id) ?? [])],
		classesForSpell: (id) => forSpell.get(id) ?? [],
	};
}

const cache = new WeakMap<ContentGraph, SpellAccess>();

/** Cached access index for a graph (rebuilt only when the graph object changes — the content
 *  store rotates the graph on reload, so this stays in step without an explicit invalidation). */
export function getSpellAccess(graph: ContentGraph): SpellAccess {
	let a = cache.get(graph);
	if (!a) cache.set(graph, (a = buildSpellAccess(graph)));
	return a;
}
