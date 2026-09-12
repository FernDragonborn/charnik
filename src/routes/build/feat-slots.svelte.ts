/*
 * Feat and ASI SLOTS: which levels grant one, what may fill it, and the choices a filled slot then
 * asks for (a half-feat's ability, a feat's skill grants, an ASI's shape). The build view-model
 * reads back the few results the assembled character needs.
 *
 * The slot KEY (`<rowId>:<level>`) is the identity everything here hangs off — the per-slot mapping
 * is what a flattened boost list could not express (UBUG-13: a restored slot re-derived its own
 * boost a second time), and the row half of it is the row's own id, never its place in the list.
 */
import type { LoadedRow } from '$lib/content/loader';
import type { BuildVM } from './build-view-model.svelte';
import type { Ability } from '$lib/rules/core';
import { asiBoost, halfFeatAbilities } from '$lib/build/derive';
import { asiFeatLevels, EPIC_BOON_MIN_LEVEL } from '$lib/build/rules';
import { FEAT_CATEGORY } from '$lib/content/schemas';
import { asiPickCount, toggleCapped, ORIGIN_SLOT_KEY } from './draft';
import { ASI, ASI_FEAT_ID, rowName, rowOfType } from './rows';
import type { AsiShape } from './draft';

/** What the slot machinery needs from the build view-model around it — picked off the class rather
 *  than re-described, so the two cannot drift apart. `import type` is erased, so no runtime cycle. */
export type FeatsHost = Pick<
	BuildVM,
	'draft' | 'graph' | 'featList' | 'backgroundRow' | 'row'
> & {
	/** Named structurally, not picked: `SkillPicksHost` names `feats` and two Picks that name each
	 *  other off the same class are a circular mapped type. This is the one member asked for here. */
	skillPicks: { isProficientBeforeFeats(skill: string): boolean };
};

export class FeatSlots {
	/* The host arrives as an ACCESSOR, not an object: a $derived field initialiser runs before a
	   constructor parameter property is assigned, so a direct reference reads it before it exists.
	   Same shape as TurnEconomy/ResourceTracker next door. */
	constructor(private host: () => FeatsHost) {}

	/** One ASI/feat slot per qualifying level, PER CLASS — RAW-correct for multiclass: each class
	 *  grants its ASIs at its OWN class levels (Fighter +6/14, Rogue +10). */
	featSlots = $derived.by<{ key: string; level: number; className: string }[]>(() => {
		const out: { key: string; level: number; className: string }[] = [];
		for (const c of this.host().draft.classes) {
			if (!c.classId) continue;
			const row = this.host().row(c.classId);
			const className = rowName(row);
			const asiLevels = rowOfType(row, 'class')?.data.asi_levels;
			for (const level of asiFeatLevels(c.level, asiLevels))
				out.push({ key: `${c.rowId}:${level}`, level, className });
		}
		return out;
	});
	/** The background's granted origin feat (5.5e), resolved to a ref — auto, not a slot. */
	originFeatRef = $derived.by<string | null>(() => {
		const id = this.host().backgroundRow?.data.origin_feat;
		if (!id) return null;
		return this.host().featList.find((f) => f.id === String(id))?.effectiveId ?? null;
	});
	/** The feat a choice-key holds: a slot's pick, or the granted origin feat under its own key. One
	 *  lookup, because everything a filled slot then asks for is asked of the origin feat too. */
	featRefFor = (key: string): string | null =>
		key === ORIGIN_SLOT_KEY ? this.originFeatRef : (this.host().draft.slotFeats[key] ?? null);
	/** Feat options that make sense for a slot at `level`: origin feats are background-only, and
	 *  epic boons only unlock at level 19+. (Not a hard block — just the right menu per slot.) */
	featOptionsFor = (level: number): LoadedRow[] =>
		this.host().featList.filter((f) => {
			// the plain ASI is offered as its own dedicated slot option, not as a feat row
			if (f.id === ASI_FEAT_ID) return false;
			const cat = String(f.data.category ?? FEAT_CATEGORY.general);
			if (cat === FEAT_CATEGORY.origin) return false;
			if (cat === FEAT_CATEGORY.epicBoon) return level >= EPIC_BOON_MIN_LEVEL;
			return true;
		});
	// ASI may be taken in every slot; a feat is repeatable iff its row says so.
	isRepeatable = (ref: string): boolean =>
		ref === ASI || Boolean(rowOfType(this.host().graph?.get(ref), 'feat')?.data.repeatable);
	/**
	 * Feat refs already spent on slots that the character currently HAS (repeatable ones may recur).
	 *
	 * Read off `featSlots` rather than off the raw map, because lowering a class level takes a slot
	 * off the sheet without taking its pick out of the draft — deliberately, so raising the level
	 * again brings the feat back. Counting the orphan as spent removed it from every other slot's
	 * menu, silently, with no way to find out where it had gone.
	 */
	// `.by` rather than plain `$derived(…)`: the bare form's argument is evaluated at field-init
	// time, which is before the constructor has assigned `host`.
	usedFeatRefs = $derived.by<string[]>(() =>
		this.featSlots.flatMap((s) => {
			const ref = this.host().draft.slotFeats[s.key];
			return ref ? [ref] : [];
		}),
	);
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
		// a half-feat defaults its +1 to the first offered ability; a non-half-feat clears any choice.
		// A swap KEEPS a choice the new feat still offers and drops one it does not — the same kind of
		// staleness §C clears below, and a kept ability the new feat never offered is silently ignored
		// by every reader of it.
		const options = this.halfFeatOptionsFor(key);
		const first = options[0];
		const featAb = { ...this.host().draft.slotFeatAbility };
		const kept = featAb[key];
		if (first) featAb[key] = kept && options.includes(kept) ? kept : first;
		else delete featAb[key];
		this.host().draft.slotFeatAbility = featAb;
		// §C: a feat swap clears the slot's skill choice-grant picks (stale for the new feat)
		const featSk = { ...this.host().draft.slotFeatSkills };
		delete featSk[key];
		this.host().draft.slotFeatSkills = featSk;
	};
	/** The abilities a FEAT lets you raise by +1 (a half-feat like Grappler / an Epic Boon), or `[]` if
	 *  it is not one. Reads the feat row's `ability_choice`. Keyed by ref as well as by slot, because
	 *  the edit residue asks what the feat the SAVE held offered, not the one the slot holds now. */
	halfFeatOptionsOf = (ref: string | null): Ability[] => {
		if (!ref || ref === ASI) return [];
		return halfFeatAbilities(rowOfType(this.host().graph?.get(ref), 'feat')?.data.ability_choice);
	};
	halfFeatOptionsFor = (key: string): Ability[] => this.halfFeatOptionsOf(this.featRefFor(key));
	setSlotFeatAbility = (key: string, ab: Ability) => {
		this.host().draft.slotFeatAbility = { ...this.host().draft.slotFeatAbility, [key]: ab };
	};
	filledSlots = $derived(this.featSlots.filter((s) => this.host().draft.slotFeats[s.key]).length);

	// --- §C skill choice-grant (Skilled: pick N skill proficiencies) ------------
	// Data-driven off the feat's `skill_choice` column (author-set count, no feat-id hardcode), so a
	// homebrew Skilled/Prodigy Just Works. NB SRD Skilled is "skills OR tools"; tools aren't modelled
	// yet → skills-only (a flagged RAW deviation; docs/work/mechanics.md ▸ TOOLS owns it).
	/** How many skills a feat REF grants by choice (0 = not a choice-grant feat). */
	featSkillCountOf = (ref: string | null | undefined): number => {
		if (!ref || ref === ASI) return 0;
		return Number(rowOfType(this.host().graph?.get(ref), 'feat')?.data.skill_choice ?? 0) || 0;
	};
	/** The chosen skills for a choice-grant key (a feat slot key, or {@link ORIGIN_SLOT_KEY}). */
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
		if (this.host().skillPicks.isProficientBeforeFeats(skill)) return true;
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
		take(ORIGIN_SLOT_KEY, this.featSkillCountOf(this.originFeatRef));
		return [...out];
	});
	/**
	 * How many choices the granted origin feat still owes — its unpicked skills, plus its +1 if the
	 * background handed over a half-feat and nothing has been assigned.
	 *
	 * A granted feat asks its questions exactly like a chosen one does, and a question nobody is told
	 * about is a grant silently thrown away: Skilled's three skills never reached the character.
	 */
	originChoicesOwed = $derived.by<number>(() => {
		const ref = this.originFeatRef;
		if (!ref) return 0;
		const skillsOwed = Math.max(
			this.featSkillCountOf(ref) - this.slotFeatSkillsFor(ORIGIN_SLOT_KEY).length,
			0,
		);
		const abilityOwed =
			this.halfFeatOptionsFor(ORIGIN_SLOT_KEY).length &&
			!this.host().draft.slotFeatAbility[ORIGIN_SLOT_KEY]
				? 1
				: 0;
		return skillsOwed + abilityOwed;
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
