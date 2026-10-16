/*
 * One carried item as the thing it IS. The SRD prints ONE "Weapon, +1, +2, or +3" and lets the rarity
 * set the number, and one "Weapon (Any Melee Weapon)" and lets the find say which weapon — so a row
 * can leave two questions open, and the answers live on the inventory entry (`base`, `bonus`), never
 * on the shared row. This module asks them: what a row leaves open, what an answered instance is
 * called ("Longsword +2"), and which instances a search like "sword +1" means.
 */
import type { ContentGraph, LoadedRow, LoadedRowOf } from './loader';
import { parseBonusChoices, type BonusRung } from './item-tags';
import { baseRowOf, needsBaseItem, resolveItem } from './resolved-item';
import { localizedName } from './detail';
import { optionNamed, optionsOf } from './options';
import { splitList } from './schemas';
import type { System } from '$lib/rules/pipeline';

interface BaseItemOption {
	ref: string;
	name: string;
}

/** The answers that make a row one particular item. */
export interface InstanceAnswers {
	base?: string;
	bonus?: number;
	/** A word the row offers (Ring of Resistance's damage type), or the id of a variety row. */
	choice?: string;
}

/** One answer to "which kind is it": a variety that is a row of its own carries its name and rarity;
 *  a WORD (a damage type) carries neither, and is said in the reader's vocabulary by the view. */
interface InstanceChoice {
	id: string;
	name?: string;
	rarity?: string;
}

/** What a row leaves for the player to say: which mundane item it is, which +N, and which kind. */
export interface InstanceQuestions {
	bases: BaseItemOption[];
	rungs: BonusRung[];
	choices: InstanceChoice[];
}

/** Where the lists come from: this character's edition and language, and the sources they enabled. */
export interface InstanceScope {
	graph: ContentGraph;
	system: System;
	locale: string;
	isActive: (row: LoadedRow) => boolean;
}

const refOf = (row: LoadedRowOf<'item'>) => `item:${row.source}:${row.id}`;

/** Every mundane item a template could BE, of the same kind as the template asking: a weapon
 *  template offers weapons, an armour one offers armour. Mundane = no rarity, which is what marks an
 *  item magical (`content.md`), and a row that states nothing itself has nothing to lend. */
function baseItemOptions(scope: InstanceScope, template: LoadedRowOf<'item'>): BaseItemOption[] {
	const { graph, system, locale, isActive } = scope;
	const out: BaseItemOption[] = [];
	for (const row of graph.list('item', { system })) {
		if (!isActive(row) || row.data.category !== template.data.category || row.data.rarity) continue;
		if (needsBaseItem(resolveItem(graph, row))) continue;
		out.push({ ref: refOf(row), name: localizedName(row, locale) });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The kinds a row is found as: its varieties where they are rows (the five Belts of Giant
 *  Strength), else the words its `choice_options` lists. */
function instanceChoices(scope: InstanceScope, row: LoadedRowOf<'item'>): InstanceChoice[] {
	const varieties = optionsOf(scope.graph, row).filter((variety) => scope.isActive(variety));
	if (varieties.length)
		return varieties.map((variety) => ({
			id: variety.id,
			name: localizedName(variety, scope.locale),
			...(variety.data.rarity ? { rarity: variety.data.rarity } : {}),
		}));
	return splitList(row.data.choice_options).map((id) => ({ id }));
}

export function instanceQuestions(
	scope: InstanceScope,
	row: LoadedRowOf<'item'>,
): InstanceQuestions {
	return {
		bases: needsBaseItem(resolveItem(scope.graph, row)) ? baseItemOptions(scope, row) : [],
		rungs: parseBonusChoices(row.data.bonus_choice),
		choices: instanceChoices(scope, row),
	};
}

export const asksWhichOne = (questions: InstanceQuestions): boolean =>
	questions.bases.length > 0 || questions.rungs.length > 0 || questions.choices.length > 0;

/** The `+1/+2/+3` row a mundane item can be found as: the template that offers it as a base (a
 *  Longsword is a Weapon +N's base), or the row that names it (`base_item_id` — a Shield +N). With
 *  `usesBase` the instance needs the mundane item as its answered base. None for anything else. */
export function bonusRowFor(
	scope: InstanceScope,
	mundane: LoadedRowOf<'item'>,
): { ref: string; usesBase: boolean; rungs: BonusRung[] } | null {
	if (mundane.data.rarity) return null;
	const ref = refOf(mundane);
	for (const row of scope.graph.list('item', { system: scope.system })) {
		const rungs = parseBonusChoices(row.data.bonus_choice);
		if (!scope.isActive(row) || !rungs.length) continue;
		if (baseRowOf(scope.graph, row)?.effectiveId === mundane.effectiveId)
			return { ref: refOf(row), usesBase: false, rungs };
		if (
			needsBaseItem(resolveItem(scope.graph, row)) &&
			baseItemOptions(scope, row).some((option) => option.ref === ref)
		)
			return { ref: refOf(row), usesBase: true, rungs };
	}
	return null;
}

/** The mundane item an instance is built on — the player's answer for a template, the row's own
 *  `base_item_id` for a Shield +N — by name. Absent when there is none: a Wand of the War Mage is
 *  nothing but itself. */
export function instanceBaseName(
	graph: ContentGraph,
	row: LoadedRowOf<'item'>,
	locale: string,
	chosenBase?: string,
): string | undefined {
	const base = baseRowOf(graph, row, chosenBase);
	return base ? localizedName(base, locale) : undefined;
}

/** How a `+N` instance is said: "Longsword +2" by its base, or — with no base — its own heading with
 *  the bonus beside it. One form in every language the app ships: the bonus is written the same in
 *  all of them, and only the name is translated. */
export const sayInstance = (name: string, bonus: number, hasBase: boolean): string =>
	hasBase ? `${name} +${bonus}` : `${name} (+${bonus})`;

/** What naming an instance reads: the graph its base is looked up in, and the reader's language. */
export interface InstanceNaming {
	graph: ContentGraph;
	locale: string;
}

/** What an answered carried row is called: "Longsword +2", "Shield +1", or the variety it was told
 *  it is ("Belt of Hill Giant Strength"). A row with nothing to answer, or not yet answered, keeps
 *  its own name — and so does a row answered with a WORD, which the view says beside the name. */
export function instanceName(
	{ graph, locale }: InstanceNaming,
	row: LoadedRowOf<'item'>,
	// a carried entry as the schema reads it: its answers are `undefined` until given
	answers: { base?: string | undefined; bonus?: number | undefined; choice?: string | undefined },
): string | undefined {
	const variety = optionNamed(graph, row, answers.choice);
	if (variety) return localizedName(variety, locale);
	if (answers.bonus === undefined || !parseBonusChoices(row.data.bonus_choice).length)
		return undefined;
	const baseName = instanceBaseName(graph, row, locale, answers.base);
	return sayInstance(baseName ?? localizedName(row, locale), answers.bonus, baseName !== undefined);
}

/** One instance a search names, ready to carry: the row, the answers, and what it is called. */
export interface InstanceMatch {
	ref: string;
	answers: { base?: string; bonus: number };
	name: string;
}

/** "longsword +1", "меч +2", "shield+3": a name and a bonus, the way a player asks for a magic item. */
const ASKS_FOR_BONUS = /^(.*\S)\s*\+\s*(\d+)$/;

/**
 * The instances a search names. "sword +1" is every +1 weapon built on a weapon whose name holds
 * "sword"; "shield +2" is the Shield +N row at +2. Only rungs the row offers: there is no Weapon +4.
 * A name of one letter matches too much to mean anything, so it matches nothing.
 */
export function instancesForQuery(scope: InstanceScope, query: string): InstanceMatch[] {
	const asked = ASKS_FOR_BONUS.exec(query.trim().toLowerCase());
	const needle = asked?.[1]?.trim() ?? '';
	const bonus = Number(asked?.[2]);
	if (needle.length < 2 || !Number.isInteger(bonus)) return [];
	const out: InstanceMatch[] = [];
	for (const row of scope.graph.list('item', { system: scope.system })) {
		if (
			!scope.isActive(row) ||
			!parseBonusChoices(row.data.bonus_choice).some((r) => r.bonus === bonus)
		)
			continue;
		const { bases } = instanceQuestions(scope, row);
		if (bases.length) {
			for (const base of bases)
				if (base.name.toLowerCase().includes(needle))
					out.push({
						ref: refOf(row),
						answers: { base: base.ref, bonus },
						name: sayInstance(base.name, bonus, true),
					});
			continue;
		}
		const baseName = instanceBaseName(scope.graph, row, scope.locale);
		const name = baseName ?? localizedName(row, scope.locale);
		if (name.toLowerCase().includes(needle))
			out.push({
				ref: refOf(row),
				answers: { bonus },
				name: sayInstance(name, bonus, baseName !== undefined),
			});
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A picker row id that carries its answers, so taking it needs no second question. */
const INSTANCE_ID_SEPARATOR = '#';
export const instanceRowId = (match: InstanceMatch): string =>
	[match.ref, match.answers.base ?? '', String(match.answers.bonus)].join(INSTANCE_ID_SEPARATOR);

export function parseInstanceRowId(id: string): { ref: string; answers: InstanceAnswers } | null {
	const [ref, base, bonus] = id.split(INSTANCE_ID_SEPARATOR);
	if (!ref || bonus === undefined) return null;
	return { ref, answers: { ...(base ? { base } : {}), bonus: Number(bonus) } };
}
