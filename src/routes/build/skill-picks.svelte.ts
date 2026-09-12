/*
 * Skill proficiencies and expertise: what the class offers, what the background grants outright, and
 * the two capped pickers over them.
 *
 * Both caps follow the same rule and for the same reason (ui.md §10): at the cap a click REPLACES the
 * oldest pick rather than being ignored, because nothing on screen tells a player that the way
 * forward is to un-pick something first. What differs is the count — the class-skill cap counts only
 * non-background picks, since a background overlap frees a slot.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { SKILL_ABILITY } from '$lib/character/skills';
import { expertiseBudget } from '$lib/build/derive';
import { splitList } from '$lib/content/schemas';
import { toggleCapped } from './draft';
import type { BuildVM } from './build-view-model.svelte';

/** What the pickers need from the build view-model around them. `import type` is erased, so picking
 *  the shape off the class costs no runtime cycle and cannot drift from it. */
export type SkillPicksHost = Pick<
	BuildVM,
	'draft' | 'edit' | 'graph' | 'classRow' | 'backgroundRow'
> & {
	/** Named structurally rather than picked off `BuildVM`: `FeatsHost` picks `skillPicks` off the same
	 *  class, and two Picks naming each other are a circular mapped type. */
	feats: { featSkillPicks: string[] };
};

export class SkillPicks {
	/* The host arrives as an ACCESSOR: a `$derived` field initialiser runs before a constructor
	   parameter property is assigned, so a direct reference reads it before it exists. */
	constructor(private host: () => SkillPicksHost) {}

	/** How many skills the class lets you choose. */
	classSkillCount = $derived.by(() => Number(this.host().classRow?.data.skills_choose ?? 0));
	/** The list they are chosen from — a class saying "any" offers every skill there is. */
	classSkillOptions = $derived.by<string[]>(() => {
		const from = splitList(this.host().classRow?.data.skills_from);
		if (from.length === 1 && from[0]?.toLowerCase() === 'any') return Object.keys(SKILL_ABILITY);
		return from;
	});
	/** Skills granted for free by the background — always proficient, never a pick. */
	autoSkills = $derived.by(() => splitList(this.host().backgroundRow?.data.skills));

	toggleSkill = (skill: string) => {
		const draft = this.host().draft;
		if (this.autoSkills.includes(skill)) return; // background-granted, locked on
		if (draft.skills.includes(skill)) {
			if (this.host().edit && draft.strict && this.host().edit?.skills.has(skill)) {
				toast(t('build.notice.strictTrainedSkill'));
				return;
			}
			draft.skills = draft.skills.filter((s) => s !== skill);
			// An expertise entry NAMES a proficiency, so it goes when the last source of it does: an
			// orphan is invisible to `expertiseUsed` and fully counted by `toggleCapped`'s evictor,
			// which then drops a live pick to make room for a dead one.
			if (!this.isProficient(skill)) draft.expertise = draft.expertise.filter((s) => s !== skill);
			return;
		}
		if (!draft.strict) {
			draft.skills = [...draft.skills, skill]; // Free: any skill, no cap
			return;
		}
		// Strict: the cap counts only NON-background picks (a background overlap frees a slot)
		if (this.classSkillCount === 0 || this.chosenCount < this.classSkillCount) {
			draft.skills = [...draft.skills, skill];
			return;
		}
		// At the cap a click replaces the oldest pick. A skill carried in from a level-up is never the
		// one dropped: Strict refuses to unlearn those, and replacing one would be unlearning under
		// another name.
		const droppable = draft.skills.find(
			(s) => !this.autoSkills.includes(s) && !this.host().edit?.skills.has(s),
		);
		if (!droppable) {
			toast(t('build.notice.strictAllTrained'));
			return;
		}
		draft.skills = [...draft.skills.filter((s) => s !== droppable), skill];
	};
	chosenCount = $derived.by(
		() => this.host().draft.skills.filter((s) => !this.autoSkills.includes(s)).length,
	);
	/** Proficient WITHOUT the §C feat grants — what a feat's OWN skill picker compares against, so its
	 *  own grant does not read back to it as "already proficient elsewhere". */
	isProficientBeforeFeats = (skill: string): boolean =>
		this.autoSkills.includes(skill) || this.host().draft.skills.includes(skill);
	/** Proficient = chosen, background-granted, or granted by a feat (Skilled) — the same union the
	 *  derive builds from `build.skills` + `build.featSkills`. Expertise keys off this and assemble
	 *  filters by it, so a narrower answer here silently drops expertise the sheet says you have. */
	isProficient = (skill: string): boolean =>
		this.isProficientBeforeFeats(skill) ||
		this.host().feats.featSkillPicks.includes(skill) ||
		(this.host().edit?.featSkills ?? []).includes(skill);
	/** A skill is pickable when Free, or (Strict) it is on the class list / the class has no list. */
	pickable = (skill: string): boolean =>
		this.autoSkills.includes(skill) ||
		!this.host().draft.strict ||
		this.classSkillCount === 0 ||
		this.classSkillOptions.includes(skill);

	/** N4a: expertise slots the drafted classes' features unlock (Rogue L1+L6, Bard L3+L10). */
	expertiseCap = $derived.by(() => {
		const graph = this.host().graph;
		return graph ? expertiseBudget(this.host().draft.classes, graph, this.host().draft.system) : 0;
	});
	expertiseUsed = $derived.by(
		() => this.host().draft.expertise.filter((s) => this.isProficient(s)).length,
	);
	/**
	 * Is the ×2 control offered on this row at all? Strict offers it wherever the class grants a slot,
	 * Free always — and a skill that ALREADY has expertise offers it whatever the cap says, because a
	 * character edited into "has expertise, grants none" would otherwise have no way to drop it.
	 */
	expertiseOffered = (skill: string): boolean =>
		this.isProficient(skill) &&
		(this.expertiseCap > 0 ||
			!this.host().draft.strict ||
			this.host().draft.expertise.includes(skill));
	/** Toggle expertise (×2) on a proficient skill. Strict enforces the class-granted cap the way every
	 *  other capped picker does; Free has no cap. Removing is always allowed. */
	toggleExpertise = (skill: string) => {
		const draft = this.host().draft;
		if (!this.isProficient(skill)) return;
		const has = draft.expertise.includes(skill);
		if (!draft.strict) {
			draft.expertise = has
				? draft.expertise.filter((s) => s !== skill)
				: [...draft.expertise, skill];
			return;
		}
		// a Strict class granting none has nothing to replace, so this is the one case that must say so
		if (!has && this.expertiseCap <= 0) {
			toast(t('build.notice.noExpertiseSlots'));
			return;
		}
		draft.expertise = toggleCapped(draft.expertise, skill, this.expertiseCap);
	};
}
