/*
 * Feat and ASI SLOTS: which levels grant one, what may fill it, and the choices a filled slot then
 * asks for (a half-feat's ability, a feat's skill grants, an ASI's shape). Carved out of the build
 * view-model, which reads back the few results the assembled character needs.
 *
 * The slot KEY ("class-4") is the identity everything here hangs off — the per-slot mapping is what
 * a flattened boost list could not express (UBUG-13: a restored slot re-derived its own boost a
 * second time).
 */
import type { ContentGraph, LoadedRow, LoadedRowByType } from '$lib/content/loader';
import type { Ability } from '$lib/rules/core';
import { asiBoost, halfFeatAbilities } from '$lib/build/derive';
import { asiFeatLevels } from '$lib/build/rules';
import { FEAT_CATEGORY } from '$lib/content/schemas';
import { asiPickCount, toggleCapped } from './draft';
import { ASI, ASI_FEAT_ID, rowName, rowOfType } from './rows';
import type { AsiShape, DraftState } from './draft';

/** What the slot machinery needs from the build view-model around it. */
export interface FeatsHost {
	draft: DraftState;
	graph: ContentGraph | null;
	featList: LoadedRowByType<'feat'>[];
	backgroundRow: LoadedRowByType<'background'> | undefined;
	autoSkills: string[];
	row(id: string | null): LoadedRow | undefined;
}

export class FeatSlots {
	/* The host arrives as an ACCESSOR, not an object: a $derived field initialiser runs before a
	   constructor parameter property is assigned, so a direct reference reads it before it exists.
	   Same shape as TurnEconomy/ResourceTracker next door. */
	constructor(private host: () => FeatsHost) {}

	/** One ASI/feat slot per qualifying level, PER CLASS — RAW-correct for multiclass: each class
	 *  grants its ASIs at its OWN class levels (Fighter +6/14, Rogue +10). */
	featSlots = $derived.by<{ key: string; level: number; className: string }[]>(() => {
		const out: { key: string; level: number; className: string }[] = [];
		this.host().draft.classes.forEach((c, i) => {
			if (!c.classId) return;
			const row = this.host().row(c.classId);
			const className = rowName(row);
			const asiLevels = rowOfType(row, 'class')?.data.asi_levels;
			for (const level of asiFeatLevels(c.level, asiLevels))
				out.push({ key: `${i}:${level}`, level, className });
		});
		return out;
	});
	/** The background's granted origin feat (5.5e), resolved to a ref — auto, not a slot. */
	originFeatRef = $derived.by<string | null>(() => {
		const id = this.host().backgroundRow?.data.origin_feat;
		if (!id) return null;
		return this.host().featList.find((f) => f.id === String(id))?.effectiveId ?? null;
	});
	/** Feat options that make sense for a slot at `level`: origin feats are background-only, and
	 *  epic boons only unlock at level 19+. (Not a hard block — just the right menu per slot.) */
	featOptionsFor = (level: number): LoadedRow[] =>
		this.host().featList.filter((f) => {
			// the plain ASI is offered as its own dedicated slot option, not as a feat row
			if (f.id === ASI_FEAT_ID) return false;
			const cat = String(f.data.category ?? FEAT_CATEGORY.general);
			if (cat === FEAT_CATEGORY.origin) return false;
			if (cat === FEAT_CATEGORY.epicBoon) return level >= 19;
			return true;
		});
	// ASI may be taken in every slot; a feat is repeatable iff its row says so.
	isRepeatable = (ref: string): boolean =>
		ref === ASI || Boolean(rowOfType(this.host().graph?.get(ref), 'feat')?.data.repeatable);
	/** Feat refs already spent on slots (repeatable ones may recur). */
	// `.by` rather than plain `$derived(…)`: the bare form's argument is evaluated at field-init
	// time, which is before the constructor has assigned `host`.
	usedFeatRefs = $derived.by<string[]>(() => Object.values(this.host().draft.slotFeats));
	/** A feat option is blocked for a slot if it's non-repeatable and already taken elsewhere. */
	featOptionBlocked = (ref: string, slotKey: string): boolean =>
		!this.isRepeatable(ref) && this.host().draft.slotFeats[slotKey] !== ref && this.usedFeatRefs.includes(ref);
	setSlotFeat = (key: string, ref: string) => {
		const next = { ...this.host().draft.slotFeats };
		if (ref) next[key] = ref;
		else delete next[key];
		this.host().draft.slotFeats = next;
		// initialise / clear this slot's ASI allocation as needed
		if (ref === ASI && !this.host().draft.slotAsi[key])
			this.host().draft.slotAsi = { ...this.host().draft.slotAsi, [key]: { shape: '2', picks: [] } };
		if (ref !== ASI && this.host().draft.slotAsi[key]) {
			const asi = { ...this.host().draft.slotAsi };
			delete asi[key];
			this.host().draft.slotAsi = asi;
		}
		// a half-feat defaults its +1 to the first offered ability; a non-half-feat clears any choice
		const first = this.halfFeatOptionsFor(key)[0];
		const featAb = { ...this.host().draft.slotFeatAbility };
		if (first) featAb[key] ??= first;
		else delete featAb[key];
		this.host().draft.slotFeatAbility = featAb;
		// §C: a feat swap clears the slot's skill choice-grant picks (stale for the new feat)
		const featSk = { ...this.host().draft.slotFeatSkills };
		delete featSk[key];
		this.host().draft.slotFeatSkills = featSk;
	};
	/** The abilities a slot's chosen feat lets you raise by +1 (a half-feat like Grappler / an Epic
	 *  Boon), or `[]` if the slot holds no half-feat. Reads the feat row's `ability_choice`. */
	halfFeatOptionsFor = (key: string): Ability[] => {
		const ref = this.host().draft.slotFeats[key];
		if (!ref || ref === ASI) return [];
		const feat = rowOfType(this.host().graph?.get(ref), 'feat');
		return halfFeatAbilities(feat?.data.ability_choice);
	};
	setSlotFeatAbility = (key: string, ab: Ability) => {
		this.host().draft.slotFeatAbility = { ...this.host().draft.slotFeatAbility, [key]: ab };
	};
	filledSlots = $derived(this.featSlots.filter((s) => this.host().draft.slotFeats[s.key]).length);

	// --- §C skill choice-grant (Skilled: pick N skill proficiencies) ------------
	// Data-driven off the feat's `skill_choice` column (author-set count, no feat-id hardcode), so a
	// homebrew Skilled/Prodigy Just Works. NB SRD Skilled is "skills OR tools"; tools aren't modelled
	// yet → skills-only (a flagged RAW deviation, docs/FEATS-PLAN §C).
	/** How many skills a feat REF grants by choice (0 = not a choice-grant feat). */
	featSkillCountOf = (ref: string | null | undefined): number => {
		if (!ref || ref === ASI) return 0;
		return Number(rowOfType(this.host().graph?.get(ref), 'feat')?.data.skill_choice ?? 0) || 0;
	};
	/** The chosen skills for a choice-grant key (a feat slot key, or `'origin'` for the BG feat). */
	slotFeatSkillsFor = (key: string): string[] => this.host().draft.slotFeatSkills[key] ?? [];
	/** Toggle a skill in a slot's §C picks, capped at the feat's grant count. */
	toggleSlotFeatSkill = (key: string, skill: string, cap: number) => {
		this.host().draft.slotFeatSkills = {
			...this.host().draft.slotFeatSkills,
			[key]: toggleCapped(this.slotFeatSkillsFor(key), skill, cap)
		};
	};
	/** Strict-mode guard: a skill already proficient from ANOTHER source (class/background pick or a
	 *  different feat's grant) is a wasted pick — disable it in Strict, allow it in Free. */
	featSkillTakenElsewhere = (key: string, skill: string): boolean => {
		if (this.host().autoSkills.includes(skill) || this.host().draft.skills.includes(skill)) return true;
		return Object.entries(this.host().draft.slotFeatSkills).some(
			([k, list]) => k !== key && list.includes(skill)
		);
	};
	/** Every §C-granted skill across all slots + the origin feat (deduped, each capped to its grant),
	 *  folded into `build.featSkills` at assemble. Stale picks (feat/count changed) are trimmed here. */
	featSkillPicks = $derived.by<string[]>(() => {
		const out = new Set<string>();
		const take = (key: string, count: number) => {
			for (const s of this.slotFeatSkillsFor(key).slice(0, count)) out.add(s);
		};
		for (const s of this.featSlots) take(s.key, this.featSkillCountOf(this.host().draft.slotFeats[s.key]));
		take('origin', this.featSkillCountOf(this.originFeatRef));
		return [...out];
	});

	// --- per-slot ASI allocation (+2 to one ability, or +1 to two) --------------
	asiBoostFor = (key: string): Partial<Record<Ability, number>> =>
		asiBoost(this.host().draft.slotAsi[key]);
	setAsiShape = (key: string, shape: AsiShape) => {
		const cur = this.host().draft.slotAsi[key] ?? { shape, picks: [] };
		// trim picks to the new shape's cap (switching 1-1 → 2 drops the extra target)
		const picks = cur.picks.slice(0, asiPickCount(shape));
		this.host().draft.slotAsi = { ...this.host().draft.slotAsi, [key]: { shape, picks } };
	};
	toggleAsiPick = (key: string, ab: Ability) => {
		const cur = this.host().draft.slotAsi[key] ?? { shape: '2' as const, picks: [] as Ability[] };
		const picks = toggleCapped(cur.picks, ab, asiPickCount(cur.shape));
		this.host().draft.slotAsi = { ...this.host().draft.slotAsi, [key]: { ...cur, picks } };
	};

}
