/*
 * "What changes on the sheet" — the diff behind the builder's inspector. Take the sheet as it
 * stands, take the sheet a candidate pick would produce, and say what actually moves.
 *
 * This is what stops a choice from being made blind (docs/plan.md N3): the compendium prose says
 * what a background IS, this says what taking it DOES to these six numbers. Only changed rows come
 * back — an unchanged AC is not information.
 *
 * Pure: two sheets in, rows out. No content graph, no draft, no runes — and no locale, which is why
 * every word it produces leaves here as a catalog KEY and is read by the component that renders it.
 */
import type { CharacterSheet } from '../character/derive';
import { ABILITIES } from '../character/schema';
import { SKILL_ABILITY, type SkillId } from '../character/skills';
import { signed } from '../util/format';

/**
 * A piece of a diff row, in the only forms this module can honestly produce: text that is already
 * language-free (a number), one catalog key, or several read as one phrase.
 */
export type DiffText =
	| { text: string }
	| { key: string; values?: Record<string, string | number> }
	/** Several keys as one comma-separated phrase — the damage types a pick starts resisting. */
	| { keys: string[] };

export interface SheetChange {
	label: DiffText;
	from: DiffText;
	to: DiffText;
	/** Did the number move in the direction a player wants? Drives the colour, nothing else. */
	better: boolean;
	/** Stable across a re-derive, for the `{#each}` key: the label is an object now. */
	id: string;
}

const num = (n: number, plus = false): DiffText => ({ text: plus ? signed(n) : String(n) });

/** A stat worth diffing: what names it, and how to read it out of a sheet. `signed` renders +3
 *  rather than 3, which is how a modifier is spoken.
 *
 *  The keys are the sheet's OWN — the inspector must not invent a second word for the AC the vitals
 *  card is already calling something. */
const STATS: { id: string; key: string; of: (s: CharacterSheet) => number; signed?: boolean }[] = [
	{ id: 'ac', key: 'build.vitals.ac', of: (s) => s.ac.value },
	{ id: 'maxHp', key: 'build.vitals.maxHp', of: (s) => s.maxHp.value },
	{ id: 'initiative', key: 'build.vitals.initiative', of: (s) => s.initiative.value, signed: true },
	{ id: 'speed', key: 'build.diff.speed', of: (s) => s.speed.value },
	{ id: 'prof', key: 'build.diff.proficiency', of: (s) => s.proficiencyBonus, signed: true },
	{ id: 'carry', key: 'build.diff.carryCapacity', of: (s) => s.carryingCapacity.value },
	{
		id: 'spellDc',
		key: 'build.vitals.spellDc',
		of: (s) => s.spellcasting.classes[0]?.saveDC.value ?? 0,
	},
	{
		id: 'spellAttack',
		key: 'build.vitals.spellAttack',
		of: (s) => s.spellcasting.classes[0]?.attack.value ?? 0,
		signed: true,
	},
];

const skillIds = Object.keys(SKILL_ABILITY) as SkillId[];

/** Skill proficiency read as a rank, so gaining expertise reads as an improvement and losing
 *  proficiency reads as a loss. */
const PROF_RANK = { none: 0, half: 1, proficient: 2, expertise: 3 } as const;

function numericChanges(before: CharacterSheet, after: CharacterSheet): SheetChange[] {
	const out: SheetChange[] = [];
	for (const ab of ABILITIES) {
		const from = before.abilities[ab].score.value;
		const to = after.abilities[ab].score.value;
		// the abbreviation is the whole label, and it is the same six letters in every locale the app
		// already passes them to (`build.abilities.scoreLabel`)
		if (from !== to)
			out.push({
				id: ab,
				label: { text: ab.toUpperCase() },
				from: num(from),
				to: num(to),
				better: to > from,
			});
		// a save moves for reasons the score doesn't — a class granting proficiency is the usual one,
		// and it is exactly the kind of thing a player picking a class wants to see
		const saveFrom = before.abilities[ab].save.value;
		const saveTo = after.abilities[ab].save.value;
		if (saveFrom !== saveTo)
			out.push({
				id: `${ab}-save`,
				label: { key: 'build.diff.save', values: { ability: ab.toUpperCase() } },
				from: num(saveFrom, true),
				to: num(saveTo, true),
				better: saveTo > saveFrom,
			});
	}
	for (const stat of STATS) {
		const from = stat.of(before);
		const to = stat.of(after);
		if (from === to) continue;
		out.push({
			id: stat.id,
			label: { key: stat.key },
			from: num(from, stat.signed),
			to: num(to, stat.signed),
			better: to > from,
		});
	}
	return out;
}

function skillChanges(before: CharacterSheet, after: CharacterSheet): SheetChange[] {
	return skillIds.flatMap((id) => {
		const from = before.skills[id].prof;
		const to = after.skills[id].prof;
		if (from === to) return [];
		return [
			{
				id: `skill-${id}`,
				label: { key: `skillName.${id}` },
				from: { key: `build.diff.rank.${from}` },
				to: { key: `build.diff.rank.${to}` },
				better: PROF_RANK[to] > PROF_RANK[from],
			},
		];
	});
}

/** Defenses are lists, so they diff as "what got added" rather than "from → to". */
function defenseChanges(before: CharacterSheet, after: CharacterSheet): SheetChange[] {
	const kinds = ['resist', 'immune', 'vulnerable'] as const;
	const key = {
		resist: 'build.diff.resistant',
		immune: 'build.diff.immune',
		vulnerable: 'build.diff.vulnerable',
	};
	return kinds.flatMap((kind) => {
		const had = new Set(before.defenses[kind]);
		const gained = after.defenses[kind].filter((d) => !had.has(d));
		if (!gained.length) return [];
		return [
			{
				id: `defense-${kind}`,
				label: { key: key[kind] },
				from: { text: '—' },
				to: { keys: gained.map((d) => `damageType.${d}`) },
				// vulnerability is the one gain a player does not want
				better: kind !== 'vulnerable',
			},
		];
	});
}

/**
 * Everything a candidate pick moves: ability scores, the headline stats, skill proficiency tiers,
 * and newly gained damage defenses. `null` on either side (the sheet has not derived yet) → no rows,
 * because "we don't know" must not render as "nothing changes".
 */
export function diffSheets(
	before: CharacterSheet | null,
	after: CharacterSheet | null,
): SheetChange[] {
	if (!before || !after) return [];
	return [
		...numericChanges(before, after),
		...skillChanges(before, after),
		...defenseChanges(before, after),
	];
}
