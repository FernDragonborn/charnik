/*
 * "What changes on the sheet" — the diff behind the builder's inspector. Take the sheet as it
 * stands, take the sheet a candidate pick would produce, and say what actually moves.
 *
 * This is what stops a choice from being made blind (docs/plan.md N3): the compendium prose says
 * what a background IS, this says what taking it DOES to these six numbers. Only changed rows come
 * back — an unchanged AC is not information.
 *
 * Pure: two sheets in, labelled rows out. No content graph, no draft, no runes.
 */
import type { CharacterSheet } from '../character/derive';
import { ABILITIES } from '../character/schema';
import { SKILL_ABILITY, type SkillId } from '../character/skills';
import { signed, titleCase } from '../util/format';

export interface SheetChange {
	label: string;
	from: string;
	to: string;
	/** Did the number move in the direction a player wants? Drives the colour, nothing else. */
	better: boolean;
}

/** A stat worth diffing: how to name it and how to read it out of a sheet. `signed` renders +3
 *  rather than 3, which is how a modifier is spoken. */
const STATS: { label: string; of: (s: CharacterSheet) => number; signed?: boolean }[] = [
	{ label: 'AC', of: (s) => s.ac.value },
	{ label: 'Max HP', of: (s) => s.maxHp.value },
	{ label: 'Initiative', of: (s) => s.initiative.value, signed: true },
	{ label: 'Speed', of: (s) => s.speed.value },
	{ label: 'Proficiency', of: (s) => s.proficiencyBonus, signed: true },
	{ label: 'Carry capacity', of: (s) => s.carryingCapacity.value },
	{ label: 'Spell save DC', of: (s) => s.spellcasting.classes[0]?.saveDC.value ?? 0 },
	{ label: 'Spell attack', of: (s) => s.spellcasting.classes[0]?.attack.value ?? 0, signed: true },
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
		if (from !== to)
			out.push({ label: ab.toUpperCase(), from: String(from), to: String(to), better: to > from });
		// a save moves for reasons the score doesn't — a class granting proficiency is the usual one,
		// and it is exactly the kind of thing a player picking a class wants to see
		const saveFrom = before.abilities[ab].save.value;
		const saveTo = after.abilities[ab].save.value;
		if (saveFrom !== saveTo)
			out.push({
				label: `${ab.toUpperCase()} save`,
				from: signed(saveFrom),
				to: signed(saveTo),
				better: saveTo > saveFrom,
			});
	}
	for (const stat of STATS) {
		const from = stat.of(before);
		const to = stat.of(after);
		if (from === to) continue;
		const show = (n: number) => (stat.signed ? signed(n) : String(n));
		out.push({ label: stat.label, from: show(from), to: show(to), better: to > from });
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
				label: titleCase(id.replace(/_/g, ' ')),
				from,
				to,
				better: PROF_RANK[to] > PROF_RANK[from],
			},
		];
	});
}

/** Defenses are lists, so they diff as "what got added" rather than "from → to". */
function defenseChanges(before: CharacterSheet, after: CharacterSheet): SheetChange[] {
	const kinds = ['resist', 'immune', 'vulnerable'] as const;
	const label = { resist: 'Resistant', immune: 'Immune', vulnerable: 'Vulnerable' };
	return kinds.flatMap((kind) => {
		const had = new Set(before.defenses[kind]);
		const gained = after.defenses[kind].filter((d) => !had.has(d));
		if (!gained.length) return [];
		return [
			{
				label: label[kind],
				from: '—',
				to: gained.join(', '),
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
