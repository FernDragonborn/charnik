/*
 * The social read-out: three bars that say what a character is like OUTSIDE combat — sway, read,
 * lore. Not a rule. It is a re-presentation of numbers the sheet already computes, so the builder
 * can answer "who is this person in a scene?" without the player reading eighteen skill rows.
 *
 * Each bar takes the BEST passive score among its skills (passive = 10 + mod ± proficiency, already
 * folded and traced by the derive), because a character is as persuasive as their best way of being
 * persuasive. The winning skill is named so the bar explains itself.
 *
 * Pure — a `CharacterSheet`'s passives in, three rows out.
 */
import type { Computed } from '../rules/pipeline';
import type { SkillId } from '../character/skills';
import { titleCase } from '../util/format';

/** A passive of 5 is a hopeless character, 30 a legendary one — the span the bar maps onto 0…1. */
const BAR_FLOOR = 5;
const BAR_CEILING = 30;

export interface SocialBar {
	id: 'sway' | 'read' | 'lore';
	label: string;
	/** 0…1 — where this character sits between a hopeless and a legendary passive. */
	fill: number;
	/** The passive score the bar is showing. */
	passive: number;
	/** Which skill won, title-cased ("Persuasion") — the bar's own explanation. */
	via: string;
	/** The winning skill's provenance, for the hover. */
	trace: Computed;
}

/** Which skills each bar draws from. Best-of, not a sum: the highest one is what the character
 *  actually reaches for. */
const BAR_SKILLS: Record<SocialBar['id'], { label: string; skills: SkillId[] }> = {
	sway: { label: 'Sway', skills: ['persuasion', 'intimidation', 'deception', 'performance'] },
	read: { label: 'Read the room', skills: ['insight', 'perception', 'animal_handling'] },
	lore: { label: 'Lore', skills: ['history', 'arcana', 'religion', 'nature', 'investigation'] },
};

/** The three social bars for a sheet's passives. Empty when there are no passives to read. */
export function socialBars(passives: Record<SkillId, Computed> | undefined): SocialBar[] {
	if (!passives) return [];
	return (Object.keys(BAR_SKILLS) as SocialBar['id'][]).map((id) => {
		const { label, skills } = BAR_SKILLS[id];
		const best = skills.reduce((top, s) =>
			passives[s].value > passives[top].value ? s : top,
		);
		const passive = passives[best].value;
		return {
			id,
			label,
			fill: Math.min(1, Math.max(0, (passive - BAR_FLOOR) / (BAR_CEILING - BAR_FLOOR))),
			passive,
			via: titleCase(best.replace(/_/g, ' ')),
			trace: passives[best],
		};
	});
}
