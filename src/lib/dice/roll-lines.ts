/*
 * What the dice tray's lines ROLL to. Pure: lines in, completed log entries out — no state, no
 * store, no caret. The tray keeps the editing; this keeps the arithmetic, so the roll a surface
 * fires can be reproduced (and tested) without standing a tray up around it.
 */
import { rollDamageParts, type DamagePartSpec, type RollLogEntry } from '$lib/combat/roll';
import { rollPool, type Rng, type RollPoolOptions } from '$lib/rules/dice';
import type { CritMethod } from '$lib/rules/dice';
import type { SaidValue } from '$lib/util/say';
import {
	ROLLER_ROLE,
	damageParts,
	rollerNotes,
	testRoll,
	volleyOf,
	type RollerLine,
} from './roller';

/** Everything a roll needs that is not a line: what it is called, what it says it came from, and the
 *  table's crit rule. One object because they travel together and never alone. */
export interface LineRoll {
	lines: RollerLine[];
	label: string;
	labelKey: string;
	labelValues?: Record<string, SaidValue>;
	note: string;
	critMethod: CritMethod;
}

/** The folded test line → what `rollPool` is asked for. Loop-invariant, so a volley builds it once;
 *  a named function rather than an inline literal because every instance of it is an optional field
 *  that is only spelled when it has a value (`exactOptionalPropertyTypes`). */
const poolOptions = (spec: ReturnType<typeof testRoll> | null, rng?: Rng): RollPoolOptions => ({
	// one or the other, never both: `modParts` IS the modifier, told with its provenance
	...(spec?.modParts ? { modParts: spec.modParts } : { mod: spec?.mod ?? 0 }),
	advantage: spec?.advantage ?? 0,
	...(spec?.bonusDice.length ? { bonusDice: spec.bonusDice } : {}),
	...(spec?.mods ?? {}),
	...(rng ? { rng } : {}),
});

/** The damage the lines describe, as the specs `rollLines` throws. Exported because a surface may
 *  have to roll ONE of them again (Savage Attacker rerolls the weapon's part), and reproducing it
 *  from the recorded dice would lose the part's crit method and its die mods. */
export function damageSpecsOf(lines: RollerLine[], critMethod: CritMethod): DamagePartSpec[] {
	return lines
		.filter((l) => l.role === ROLLER_ROLE.damage)
		.flatMap((line) => damageParts(line).map((p) => (line.crit ? { ...p, crit: critMethod } : p)));
}

/** Roll the lines — one entry per instance of a volley. Records nothing: what to do with a roll
 *  (log it, toast it, persist it) belongs to the surface the dice tray is mounted on. */
export function rollLines(roll: LineRoll, rng?: Rng): RollLogEntry[] {
	const test = roll.lines.find((l) => l.role === ROLLER_ROLE.test && l.pills.length);
	const spec = test ? testRoll(test) : null;
	const parts = damageSpecsOf(roll.lines, roll.critMethod);
	// a volley is a count on ANY line, not only the test one: a damage-only spell can fire N times
	// too, and reading it off the test line alone would silently drop that
	const times = Math.max(1, ...roll.lines.map(volleyOf));
	// what the player called their own dice rides the note beside whatever provenance the roll site
	// already wrote there — the fold has no number to give those pills, and dropping them was the
	// last of the four losses at that seam
	const note = [roll.note, ...rollerNotes(roll.lines)].filter(Boolean).join(' · ');
	const at = Date.now();
	const opts = poolOptions(spec, rng);
	const out: RollLogEntry[] = [];
	for (let i = 0; i < times; i++) {
		const primary = rollPool(spec?.dice ?? {}, opts);
		const damage = parts.length ? rollDamageParts(parts, rng) : undefined;
		out.push({
			// no name typed → the roll is called what the catalog calls an unnamed one, and carries
			// that as its KEY so the log is not frozen in the language it was rolled in
			label: roll.label || 'Custom roll',
			...(roll.labelKey || !roll.label ? { labelKey: roll.labelKey || 'roller.customRoll' } : {}),
			...(roll.labelValues ? { labelValues: roll.labelValues } : {}),
			...primary,
			...(damage ? { damage } : {}),
			...(note ? { note } : {}),
			// one instance per millisecond: `at` is what an amendment matches on to rewrite ITS line,
			// so a volley whose three attacks shared a timestamp would rewrite the wrong one
			at: at + i,
		});
	}
	return out;
}
