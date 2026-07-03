/*
 * Spell ↔ class access — the bidirectional UNION index (docs/PLAN.md "Spellcasting model").
 *
 * A spell is accessible to a class from EITHER direction, so neither edits the other's files:
 *   - spell-side: the spell row's `classes` column (shipped SRD tags its classes inline), or
 *   - class-side: an additive `spell_lists` row (`class_id`,`spell_id`) — a homebrew class grants
 *     access to existing spells without touching them.
 * We union both into `class → spells` and the reverse `spell → classes`, carrying provenance
 * (`via`) for the explainable invariant. Edition-scoped: a class only reaches spells it shares a
 * system with (a 2024 wizard doesn't get 2014 spells).
 *
 * This is a CONTENT-level index (pure function of the graph). Character-specific grants
 * (subclass / feat / item / race) layer on top later, in the character derive — not here.
 */
import type { ContentGraph, LoadedRow } from './loader';

export type AccessVia = 'class-list' | 'spell-list';

export interface AccessEntry {
	/** Bare class id (e.g. "wizard"). */
	classId: string;
	/** The class row's effectiveId (`class:source:id`) — edition/source-specific. */
	classEffectiveId: string;
	via: AccessVia;
}

export interface SpellAccess {
	/** Spell effectiveIds a given class row can access. */
	spellIdsForClass(classEffectiveId: string): string[];
	/** Which classes can access a given spell (with provenance), for the compendium. */
	classesForSpell(spellEffectiveId: string): AccessEntry[];
}

const csv = (v: unknown): string[] =>
	Array.isArray(v)
		? v.map(String)
		: v == null || v === ''
			? []
			: String(v)
					.split(/[,;]/)
					.map((s) => s.trim())
					.filter(Boolean);

const shareEdition = (a: string[], b: string[]) => a.some((s) => b.includes(s));

/** Build the union access index from the content graph (pure). */
export function buildSpellAccess(graph: ContentGraph): SpellAccess {
	const classRows = graph.rows.filter((r) => r.type === 'class');
	const spellRows = graph.rows.filter((r) => r.type === 'spell');
	const listRows = graph.rows.filter((r) => r.type === 'spell_lists');

	// bare class id → its rows (one per edition/source)
	const classesById = new Map<string, LoadedRow[]>();
	for (const c of classRows) {
		const arr = classesById.get(c.id) ?? [];
		arr.push(c);
		classesById.set(c.id, arr);
	}
	// bare spell id → its rows (one per edition/source)
	const spellsById = new Map<string, LoadedRow[]>();
	for (const s of spellRows) {
		const arr = spellsById.get(s.id) ?? [];
		arr.push(s);
		spellsById.set(s.id, arr);
	}

	const forClass = new Map<string, Set<string>>(); // classEID → spell EIDs
	const forSpell = new Map<string, AccessEntry[]>(); // spellEID → entries
	const seen = new Set<string>(); // `${classEID}|${spellEID}` dedup

	const link = (cls: LoadedRow, spell: LoadedRow, via: AccessVia) => {
		if (!shareEdition(cls.systems, spell.systems)) return;
		const key = `${cls.effectiveId}|${spell.effectiveId}`;
		if (seen.has(key)) return;
		seen.add(key);
		(
			forClass.get(cls.effectiveId) ??
			forClass.set(cls.effectiveId, new Set()).get(cls.effectiveId)!
		).add(spell.effectiveId);
		(
			forSpell.get(spell.effectiveId) ?? forSpell.set(spell.effectiveId, []).get(spell.effectiveId)!
		).push({ classId: cls.id, classEffectiveId: cls.effectiveId, via });
	};

	// spell-side: inline `classes` column
	for (const spell of spellRows)
		for (const bareClass of csv(spell.data.classes))
			for (const cls of classesById.get(bareClass) ?? []) link(cls, spell, 'class-list');

	// class-side: additive spell_lists join. An orphan join (unknown class_id or spell_id) resolves
	// to [] → skipped here; the loader flags it as a content-health WARNING (likely a typo), so a
	// dangling grant is harmless in the index but surfaced to the user.
	for (const row of listRows) {
		const cls = classesById.get(String(row.data.class_id)) ?? [];
		const sp = spellsById.get(String(row.data.spell_id)) ?? [];
		for (const c of cls) for (const s of sp) link(c, s, 'spell-list');
	}

	return {
		spellIdsForClass: (id) => [...(forClass.get(id) ?? [])],
		classesForSpell: (id) => forSpell.get(id) ?? []
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
