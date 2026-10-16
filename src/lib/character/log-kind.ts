/*
 * What kind of line the log holds. Its own module because the record (`combat/roll.ts`), the file
 * (`log-repository.ts`) and the play actions that produce lines (`play/*`) all name it, and none of
 * them should pull in the others to do so.
 */

/** An open enum (AGENTS.md ▸ Taste): a new kind is a member, and `isTurnAct` below then fails to
 *  compile until it says where the new kind stands. A line with no kind is a `roll` — every line
 *  written before the kinds existed. */
export const LOG_KIND = {
	/** A die thrown, or an act the player took that threw none (a forced save, a no-roll feature). */
	roll: 'roll',
	cast: 'cast',
	damage: 'damage',
	healing: 'healing',
	rest: 'rest',
	/** What an action SAID — the sentence its toast carried. */
	notice: 'notice',
	tempHp: 'tempHp',
	slot: 'slot',
	resource: 'resource',
	effect: 'effect',
	concentration: 'concentration',
	exhaustion: 'exhaustion',
	experience: 'experience',
	level: 'level',
} as const;
export type LogKind = (typeof LOG_KIND)[keyof typeof LOG_KIND];

/**
 * Is a line of this kind something the player DID, rather than what followed from it or what was said
 * about it? The last-roll strip shows the newest act; a slot spent or a toast's sentence beneath a
 * cast would otherwise push the cast itself off the one line that is always in view.
 */
export function isTurnAct(kind: LogKind): boolean {
	switch (kind) {
		case LOG_KIND.roll:
		case LOG_KIND.cast:
		case LOG_KIND.damage:
		case LOG_KIND.healing:
		case LOG_KIND.rest:
			return true;
		case LOG_KIND.notice:
		case LOG_KIND.tempHp:
		case LOG_KIND.slot:
		case LOG_KIND.resource:
		case LOG_KIND.effect:
		case LOG_KIND.concentration:
		case LOG_KIND.exhaustion:
		case LOG_KIND.experience:
		case LOG_KIND.level:
			return false;
	}
}
