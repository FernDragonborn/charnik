/*
 * The loader's cross-row checks: what can only be judged once every file is in — a join that
 * resolves to nothing, a class that asks for a subclass its edition does not ship, a tag whose value
 * stopped being a number when the column folded into `tags`, and prose translated halfway.
 *
 * Split from `loader.ts` because none of it is loading: the loader hands over the indexed rows and
 * gets issues back. Same contract as everything else here — a defect is an ISSUE, never a throw.
 */
import { PROSE_BASES, type ContentType } from './schemas';
import { issueText } from './issue-text';
import { parseItemTags, NUMERIC_TAGS } from './item-tags';
import type { ContentIssue, LoadedRow } from './loader';

const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * Content-health: flag rows that are PARTIALLY translated into a locale — some `<base>_<loc>` prose is
 * filled but a `<base>_<loc>` is missing where the English is present. That's the "someone mis-filled
 * the table" signal. A fully-untranslated row stays silent: EN fallback is the normal, intended case,
 * so it isn't an error. Reads only prose-locale columns (typed via the ProseLocaleColumns index).
 */
export function collectTranslationGaps(rows: LoadedRow[], locales: string[]): ContentIssue[] {
	const gaps: ContentIssue[] = [];
	for (const locale of locales) {
		if (locale === 'en') continue;
		for (const row of rows) {
			const expected = PROSE_BASES.filter((base) => nonEmptyString(row.data[`${base}_en`]));
			if (expected.length === 0) continue; // nothing in English to translate
			const missing = expected.filter((base) => !nonEmptyString(row.data[`${base}_${locale}`]));
			// partial = started (at least one base translated) but not finished
			if (missing.length > 0 && missing.length < expected.length)
				gaps.push({
					level: 'warn',
					root: row.root,
					file: row.file,
					id: row.id,
					...issueText.partialTranslation(
						locale,
						missing.map((base) => `${base}_${locale}`),
					),
				});
		}
	}
	return gaps;
}

/** Validate additive spell_lists joins: an unknown class_id/spell_id (no such row in the row's
 *  edition) is likely a typo → WARN. The join itself is harmless (it just resolves to nothing), but
 *  surfaced so the user can fix it. */
export function validateSpellListJoins(
	byType: Map<ContentType, LoadedRow[]>,
	issues: ContentIssue[],
): void {
	const systemsById = (type: ContentType): Map<string, string[]> => {
		const m = new Map<string, string[]>();
		for (const r of byType.get(type) ?? []) m.set(r.id, [...(m.get(r.id) ?? []), ...r.systems]);
		return m;
	};
	const classSystems = systemsById('class');
	const spellSystems = systemsById('spell');
	const joinResolves = (map: Map<string, string[]>, id: unknown, systems: string[]) =>
		(map.get(String(id)) ?? []).some((s) => systems.includes(s));
	for (const r of byType.get('spell_lists') ?? []) {
		if (r.type !== 'spell_lists') continue; // byType guarantees it; the guard narrows the union for TS
		const checkJoin = (map: Map<string, string[]>, id: unknown, kind: string): void => {
			if (joinResolves(map, id, r.systems)) return;
			issues.push({
				level: 'warn',
				root: r.root,
				file: r.file,
				id: r.id,
				...issueText.unresolvedJoin(kind, String(id), map.keys()),
			});
		};
		checkJoin(classSystems, r.data.class_id, 'class');
		checkJoin(spellSystems, r.data.spell_id, 'spell');
	}
	validateSubclassChoices(byType, issues);
}

/** A class whose `subclass_level` is set while its edition ships no subclass row asks the player for
 *  a choice that cannot be made. The builder stays silent about it — a todo whose click opens an
 *  empty pane is not a report — so it is reported HERE, where a content defect belongs. */
function validateSubclassChoices(
	byType: Map<ContentType, LoadedRow[]>,
	issues: ContentIssue[],
): void {
	for (const r of byType.get('class') ?? []) {
		if (r.type !== 'class') continue; // byType guarantees it; the guard narrows the union for TS
		const level = Number(r.data.subclass_level ?? 0);
		if (!level) continue;
		const offered = (byType.get('subclass') ?? []).some(
			(s) =>
				s.type === 'subclass' &&
				String(s.data.class_id) === r.id &&
				s.systems.some((sys) => r.systems.includes(sys)),
		);
		if (offered) continue;
		issues.push({
			level: 'warn',
			root: r.root,
			file: r.file,
			id: r.id,
			...issueText.noSubclassRows(level),
		});
	}
}

/** Validate what folding item columns into `tags` took away from zod: a numeric tag's value, and the
 *  existence of the row `base_item_id` points at. Both used to be impossible to get silently wrong —
 *  `ac: optInt` rejected a non-number by column name, and there was no reference to dangle — so the
 *  check comes back here rather than being dropped along with the columns (docs/plan.md ▸ ITEM-TAGS). */
export function validateItemTags(
	byType: Map<ContentType, LoadedRow[]>,
	issues: ContentIssue[],
): void {
	const items = byType.get('item') ?? [];
	const idsBySource = new Map<string, Set<string>>();
	for (const r of items) {
		const set = idsBySource.get(r.source) ?? new Set<string>();
		set.add(r.id);
		idsBySource.set(r.source, set);
	}
	for (const r of items) {
		if (r.type !== 'item') continue; // byType guarantees it; the guard narrows the union for TS
		const where = { level: 'warn' as const, root: r.root, file: r.file, id: r.id };
		for (const [name, value] of parseItemTags(r.data.tags))
			if (NUMERIC_TAGS.includes(name) && !Number.isInteger(Number(value || NaN)))
				issues.push({ ...where, ...issueText.badTagValue(`${name}:${value}`, name) });
		const base = r.data.base_item_id;
		if (base && !idsBySource.get(r.source)?.has(base))
			issues.push({
				...where,
				...issueText.unresolvedBaseItem(base, idsBySource.get(r.source) ?? []),
			});
	}
}
