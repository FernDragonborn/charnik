/*
 * A FORM the character has assumed — a druid's Wild Shape — read off the stat block it names.
 *
 * Which stat blocks a feature allows is said by the feature's own `form` tokens (`effects/facts.ts` ▸
 * `FormRules`); what a stat block then means for the sheet is said HERE, as ordinary effect tokens:
 * the physical scores, the Armor Class and the speeds are SET to the stat block's, and a save or a
 * skill the stat block lists is a FLOOR, which is both editions' "use the higher of the two". So a
 * form folds through the one pipeline every other effect does, and every number it moves names the
 * creature in its trace.
 *
 * Every value comes from a declared column of the monster row. Three of those columns are compound
 * (`speed`, `skills`, `senses`) and are read by their own small grammars below — never from `text`.
 */
import type { ContentGraph, LoadedRow, LoadedRowOf } from '../content/loader';
import type { FormRules } from '../effects/facts';
import type { Character } from './schema';
import { SKILL_ABILITY } from './skills';
import { ABILITIES } from './schema';

export type MonsterRow = LoadedRowOf<'monster'>;

/** The scores a form replaces. Intelligence, Wisdom and Charisma stay the character's own in both
 *  editions' Wild Shape. */
const FORM_ABILITIES = ['str', 'dex', 'con'] as const;

/** The movement modes the sheet has a speed for. A stat block may state others (burrow), which the
 *  eligibility test still reads. */
const SHEET_SPEED_MODES: readonly string[] = ['fly', 'swim', 'climb'];
const WALK = 'walk';

/** A Challenge Rating as a number — `1/4` is 0.25. Undefined for a blank or unreadable cell, which
 *  is not zero: a stat block that states no rating passes no rating limit. */
export function challengeRating(cr: string | undefined): number | undefined {
	const m = /^\s*(\d+)(?:\s*\/\s*(\d+))?\s*$/.exec(cr ?? '');
	if (!m?.[1]) return undefined;
	const denominator = m[2] === undefined ? 1 : Number(m[2]);
	return denominator > 0 ? Number(m[1]) / denominator : undefined;
}

/** The feet after each name in a `name N ft.` list (`40 ft., climb 30 ft.`), keyed by the lowercase
 *  name; an entry with no name is keyed `unnamed`. The shared shape of `speed` and `senses`. */
function feetByName(cell: string | undefined, unnamed: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const part of (cell ?? '').split(/[,;]/)) {
		const m = /^\s*(?:([a-z][a-z ]*?)\s+)?(\d+)\s*ft/i.exec(part);
		if (m?.[2]) out[(m[1] ?? unnamed).toLowerCase().replace(/\s+/g, '_')] = Number(m[2]);
	}
	return out;
}

/** The speeds a stat block states, by movement mode; the unnamed first one is `walk`. */
const speedsOf = (row: MonsterRow): Record<string, number> => feetByName(row.data.speed, WALK);

/** The skill bonuses a stat block lists (`Perception +5, Stealth +4`), by skill id. */
function skillBonusesOf(row: MonsterRow): Record<string, number> {
	const out: Record<string, number> = {};
	for (const part of (row.data.skills ?? '').split(/[,;]/)) {
		const m = /^\s*([a-z][a-z ]*?)\s*([+-]\d+)\s*$/i.exec(part);
		const id = m?.[1]?.toLowerCase().replace(/\s+/g, '_') ?? '';
		if (m?.[2] && id in SKILL_ABILITY) out[id] = Number(m[2]);
	}
	return out;
}

/** The special senses a stat block lists with a range, by name. A passive score is not one. */
function sensesOf(row: MonsterRow): Record<string, number> {
	const senses = feetByName(row.data.senses, '');
	for (const name of Object.keys(senses))
		if (name === '' || name.startsWith('passive')) delete senses[name];
	return senses;
}

/** Does the stat block have this sense? What a form that allows no other sense asks of each one
 *  the character brings. */
export const formHasSense = (row: MonsterRow, sense: string): boolean => sense in sensesOf(row);

/** What assuming this stat block does to the sheet, as effect tokens. */
export function formStatTokens(row: MonsterRow): string[] {
	const d = row.data;
	const tokens: string[] = [];
	for (const ability of FORM_ABILITIES)
		if (d[ability] != null) tokens.push(`set_override:${ability}:${d[ability]}`);
	if (d.ac != null) tokens.push(`set_override:ac:${d.ac}`);
	const speeds = speedsOf(row);
	if (speeds[WALK] !== undefined) tokens.push(`set_override:speed:${speeds[WALK]}`);
	for (const mode of SHEET_SPEED_MODES)
		if (speeds[mode] !== undefined) tokens.push(`set_override:speed.${mode}:${speeds[mode]}`);
	for (const ability of ABILITIES) {
		const save = d[`${ability}_save`];
		if (save != null) tokens.push(`set_override:save.${ability}:${save}:floor`);
	}
	for (const [skill, bonus] of Object.entries(skillBonusesOf(row)))
		tokens.push(`set_override:skill.${skill}:${bonus}:floor`);
	for (const [sense, feet] of Object.entries(sensesOf(row)))
		tokens.push(`set_override:senses.${sense}:${feet}:floor`);
	return tokens;
}

/** Is this stat block one the form's rules allow? A rule the feature did not state limits nothing. */
export function isEligibleForm(row: MonsterRow, rules: FormRules): boolean {
	const type = row.data.creature_type.toLowerCase();
	// `beast (dinosaur)` is a beast; `swarm of tiny beasts` is a swarm
	if (rules.creature && type !== rules.creature && !type.startsWith(`${rules.creature} `))
		return false;
	if (rules.maxCr !== undefined) {
		const rating = challengeRating(row.data.cr);
		if (rating === undefined || rating > rules.maxCr) return false;
	}
	const speeds = speedsOf(row);
	return rules.without.every((mode) => speeds[mode] === undefined);
}

/** The form a character is in, resolved: its stat block and the play-state that says so. Undefined
 *  when the character is in none, or the stat block is not loaded — the sheet then stays their own. */
export function activeForm(
	character: Character,
	graph: ContentGraph,
	isActive: (row: LoadedRow) => boolean = () => true,
): { row: MonsterRow; state: NonNullable<Character['play']['form']> } | undefined {
	const state = character.play.form;
	const row = state ? graph.get(state.monster) : undefined;
	return state && row?.type === 'monster' && isActive(row) ? { row, state } : undefined;
}

/** The character as they are with the form set aside: no form, and none of the effect that carries
 *  it. What the sheet derives when it needs a number that is still the character's own. */
export function withoutForm(character: Character): Character {
	const monster = character.play.form?.monster;
	return {
		...character,
		play: {
			...character.play,
			form: null,
			effects: character.play.effects.filter((effect) => effect.source !== monster),
		},
	};
}
