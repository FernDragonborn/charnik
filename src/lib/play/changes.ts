/*
 * What an action changed, as lines for the log.
 *
 * Read off the play-state before and after rather than declared by each action, so every way into a
 * change leaves the same line — the cast that spends a slot and the pip pressed by hand, the Rage
 * that ends Concentration and the ✕ on its chip. An action that already SAID a change (a notice of
 * that kind, or a line of its own) is not repeated here: the log says each thing once.
 */
import type { CharacterPlay } from '$lib/character/schema';
import { LOG_KIND, type LogKind } from '$lib/character/log-kind';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import type { PlayLogLine } from './outcome';

/** The words a change needs that play-state holds only as ids. */
export interface ChangeNames {
	resource(id: string): string;
	spell(ref: string): string;
}

/** The kinds a rest has already accounted for: it gives back slots, pools and hit points, takes off
 *  what it outlasts and lowers Exhaustion, and its own line says it was taken. Listing each of those
 *  under it would bury the rest in a dozen lines that all mean "you rested". */
const SAID_BY_A_REST: readonly LogKind[] = [
	LOG_KIND.tempHp,
	LOG_KIND.slot,
	LOG_KIND.resource,
	LOG_KIND.effect,
	LOG_KIND.concentration,
	LOG_KIND.exhaustion,
];

/** Each key's count after minus before, for the keys whose count moved. */
function countDeltas(
	before: Record<string, number>,
	after: Record<string, number>,
): [string, number][] {
	const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
	return keys
		.map((key): [string, number] => [key, (after[key] ?? 0) - (before[key] ?? 0)])
		.filter(([, delta]) => delta !== 0);
}

type Values = PlayLogLine['name']['values'];
const change = (kind: LogKind, key: string, text: string, values: Values): PlayLogLine => ({
	kind,
	name: { text, key, ...(values ? { values } : {}) },
});

function concentrationChanges(before: CharacterPlay, after: CharacterPlay, names: ChangeNames) {
	if (before.concentration === after.concentration) return [];
	return [
		...(before.concentration
			? [
					change(LOG_KIND.concentration, 'combat.log.concentrationEnded', 'Concentration ended', {
						spell: names.spell(before.concentration),
					}),
				]
			: []),
		...(after.concentration
			? [
					change(LOG_KIND.concentration, 'combat.log.concentrationBegun', 'Concentrating', {
						spell: names.spell(after.concentration),
					}),
				]
			: []),
	];
}

function slotChanges(before: CharacterPlay, after: CharacterPlay): PlayLogLine[] {
	const spentOrBack = countDeltas(before.spellSlotsSpent, after.spellSlotsSpent).map(
		([key, delta]) => {
			const count = Math.abs(delta);
			const spent = delta > 0;
			return key === PACT_SLOT_KEY
				? change(
						LOG_KIND.slot,
						spent ? 'combat.log.pactSlotSpent' : 'combat.log.pactSlotRestored',
						spent ? 'Pact slot spent' : 'Pact slot restored',
						{ count },
					)
				: change(
						LOG_KIND.slot,
						spent ? 'combat.log.slotSpent' : 'combat.log.slotRestored',
						spent ? 'Spell slot spent' : 'Spell slot restored',
						{ count, level: Number(key) },
					);
		},
	);
	// a gained slot goes only at a Long Rest, which a rest already says; one arriving is said here
	const gained = countDeltas(before.spellSlotsGained, after.spellSlotsGained)
		.filter(([, delta]) => delta > 0)
		.map(([key, delta]) =>
			change(LOG_KIND.slot, 'combat.log.slotGained', 'Spell slot gained', {
				count: delta,
				level: Number(key),
			}),
		);
	return [...spentOrBack, ...gained];
}

const resourceChanges = (before: CharacterPlay, after: CharacterPlay, names: ChangeNames) =>
	countDeltas(before.resourcesSpent, after.resourcesSpent).map(([id, delta]) =>
		change(
			LOG_KIND.resource,
			delta > 0 ? 'combat.log.resourceSpent' : 'combat.log.resourceRegained',
			delta > 0 ? 'Resource spent' : 'Resource regained',
			{ name: names.resource(id), count: Math.abs(delta) },
		),
	);

function effectChanges(before: CharacterPlay, after: CharacterPlay): PlayLogLine[] {
	const kept = new Set(after.effects.map((e) => e.iid));
	const had = new Set(before.effects.map((e) => e.iid));
	return [
		...before.effects
			.filter((e) => !kept.has(e.iid))
			.map((e) =>
				change(LOG_KIND.effect, 'combat.log.effectOff', 'No longer affected', { name: e.label }),
			),
		...after.effects
			.filter((e) => !had.has(e.iid))
			.map((e) => change(LOG_KIND.effect, 'combat.log.effectOn', 'Affected', { name: e.label })),
	];
}

/** The counts said as from → to: one number each, and the line is the move. */
function countChanges(before: CharacterPlay, after: CharacterPlay): PlayLogLine[] {
	const moves: [LogKind, string, string, number, number][] = [
		[LOG_KIND.tempHp, 'combat.log.tempHp', 'Temporary hit points', before.hp.temp, after.hp.temp],
		[
			LOG_KIND.exhaustion,
			'combat.log.exhaustion',
			'Exhaustion',
			before.exhaustion,
			after.exhaustion,
		],
		[LOG_KIND.experience, 'combat.log.experience', 'Experience', before.xp, after.xp],
	];
	return moves
		.filter(([, , , from, to]) => from !== to)
		.map(([kind, key, text, from, to]) => change(kind, key, text, { from, to }));
}

export function playChanges(
	before: CharacterPlay,
	after: CharacterPlay,
	names: ChangeNames,
	said: readonly LogKind[],
): PlayLogLine[] {
	const silent = new Set<LogKind>(said.includes(LOG_KIND.rest) ? SAID_BY_A_REST : said);
	// a hit that eats temporary hit points says so in its own line
	if (said.includes(LOG_KIND.damage)) silent.add(LOG_KIND.tempHp);
	return [
		...concentrationChanges(before, after, names),
		...slotChanges(before, after),
		...resourceChanges(before, after, names),
		...effectChanges(before, after),
		...countChanges(before, after),
	].filter((line) => !line.kind || !silent.has(line.kind));
}
