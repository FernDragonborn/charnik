/*
 * A weapon's or a spell's damage as typed parts — "1d6 slashing; 1d4 radiant" — read once and
 * printed back, and the words a damage type and a sense are called by.
 */
import type { Translate } from '$lib/i18n';
import { formatDicePool, parseFormula } from '$lib/rules/dice';
import { signed } from '$lib/util/format';

/** One typed slice of a weapon's damage: its dice pool, flat mod, and damage type. A plain weapon is
 *  one part ("1d8 slashing"); a multi-type weapon is several ("1d6 slashing" + "1d4 radiant"). */
export interface DamagePart {
	pool: Record<number, number>;
	mod: number;
	type: string;
	/** Fragments of the segment that neither the pool nor the modifier accounted for — a content
	 *  defect, so it is carried to the sheet as a note rather than discovered at the roll. Omitted
	 *  when the segment reads cleanly, which is every shipped row. */
	issues?: string[];
}

/** The trailing damage-type word(s) of a segment ("1d8 +3 slashing" → "slashing"), or "" if none. */
function segmentType(segment: string): string {
	return (/([a-z][a-z ]*?)\s*$/i.exec(segment.trim())?.[1] ?? '').trim();
}

/** Parse a weapon/spell damage string into its typed parts. Multiple types are `;`-separated
 *  ("1d6 slashing; 1d4 radiant"); a plain weapon is one part ("1d8 slashing"). Each part carries its
 *  own dice pool, flat mod, and type — dice and modifier read by the roller's own parsers, so a
 *  segment and a roll formula can never disagree about what "+2" means. Empty string → no parts. Pure. */
export function parseDamageParts(dmg: string): DamagePart[] {
	return dmg
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((seg) => {
			const { dice, mod, bonusDice, issues } = parseFormula(seg);
			// a part carries a POOL, which has no sign to hold a subtracted term with — so a `-1d4` is
			// surfaced as what the segment could not express rather than rolled as `+1d4`
			const unread = [...issues, ...bonusDice.map((d) => `-${d.count}d${d.sides}`)];
			return {
				pool: dice,
				mod,
				type: segmentType(seg),
				...(unread.length ? { issues: unread } : {}),
			};
		});
}

/** What a damage type is CALLED. The type is an id (`bludgeoning`) and the catalog holds the word for
 *  it; a homebrew type nobody has translated falls back to the id, which is still what its author
 *  wrote. Takes the translator rather than reaching for one, so this module stays pure and
 *  node-testable (docs/internals/ui.md ▸ Strings live in the catalogs). */
export const damageTypeLabel = (type: string, translate: Translate): string =>
	type ? translate(`damageType.${type}`, { default: type }) : '';

/** A sense id → the reader's word for it. Open vocabulary like a damage type: the SRD names four
 *  and the catalog carries those; a pack's own sense falls back to the id it wrote. */
export const senseLabel = (sense: string, translate: Translate): string =>
	sense ? translate(`senseName.${sense}`, { default: sense }) : '';

/** Render typed damage parts back to a display string ("1d8 +3 slashing", "1d6 slashing + 1d4
 *  radiant"). Inverse of `parseDamageParts` for the panel. Pure.
 *
 *  Without a translator the TYPE ID is printed, which is the right answer for a caller that has no
 *  locale to spend — a node test, or a string that is about to be re-parsed. Every surface a person
 *  reads passes one. */
export function formatDamageParts(parts: DamagePart[], translate?: Translate): string {
	return parts
		.map((p) =>
			[
				formatDicePool(p.pool),
				p.mod ? signed(p.mod) : '',
				translate ? damageTypeLabel(p.type, translate) : p.type,
			]
				.filter(Boolean)
				.join(' '),
		)
		.join(' + ');
}
