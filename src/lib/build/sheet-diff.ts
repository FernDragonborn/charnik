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
import type { SpellcastingClass } from '../character/spellcasting';
import { SKILL_ABILITY, type SkillId } from '../character/skills';
// the ladder is the derive's own — a second copy of it here is a second answer to "is this better"
import { PROF_ORDER } from '../character/derive-stats';
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
];

/** Nothing on this side of the diff — a stat the character did not have, as opposed to one that was
 *  zero. */
const NONE: DiffText = { text: '—' };

/** The per-caster-class stats, which cannot go in `STATS`: a sheet has one of each PER class. */
const SPELL_STATS = [
	{
		id: 'spellDc',
		key: 'build.vitals.spellDc',
		classKey: 'build.diff.spellDcFor',
		of: (c: SpellcastingClass) => c.saveDC.value,
		signed: false,
	},
	{
		id: 'spellAttack',
		key: 'build.vitals.spellAttack',
		classKey: 'build.diff.spellAttackFor',
		of: (c: SpellcastingClass) => c.attack.value,
		signed: true,
	},
] as const;

const skillIds = Object.keys(SKILL_ABILITY) as SkillId[];

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
				better: PROF_ORDER[to] > PROF_ORDER[from],
			},
		];
	});
}

/**
 * Spellcasting, matched by CLASS rather than by position.
 *
 * `spellcasting.classes` is the character's caster rows in row order, so `classes[0]` on the two
 * sheets is not the same class the moment a pick adds, removes or reorders one: highlighting a
 * Fighter for row 0 of a Cleric 5 / Wizard 3 read as "the Wizard's DC got worse", and the Cleric
 * losing spellcasting altogether was never reported. A class present on one side only reads as `—`,
 * because a save DC of 0 is not a number anybody had.
 */
function spellcastingChanges(before: CharacterSheet, after: CharacterSheet): SheetChange[] {
	const casters = [...before.spellcasting.classes, ...after.spellcasting.classes];
	const ids = [...new Set(casters.map((c) => c.classEffectiveId))];
	return ids.flatMap((id) => {
		const from = before.spellcasting.classes.find((c) => c.classEffectiveId === id);
		const to = after.spellcasting.classes.find((c) => c.classEffectiveId === id);
		return SPELL_STATS.flatMap((stat) => {
			const was = from ? stat.of(from) : null;
			const now = to ? stat.of(to) : null;
			if (was === now) return [];
			return [
				{
					id: `${stat.id}-${id}`,
					// the class is named only when more than one is involved, so the single-caster case
					// keeps the same label the vitals card uses
					label:
						ids.length > 1
							? { key: stat.classKey, values: { class: (to ?? from)?.className ?? '' } }
							: { key: stat.key },
					from: was === null ? NONE : num(was, stat.signed),
					to: now === null ? NONE : num(now, stat.signed),
					better: (now ?? 0) > (was ?? 0),
				},
			];
		});
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
				from: NONE,
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
		...spellcastingChanges(before, after),
		...skillChanges(before, after),
		...defenseChanges(before, after),
	];
}
