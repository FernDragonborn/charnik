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
import { featSpellGrants, type FeatSpellGrant } from '$lib/character/spellcasting';
import { asiFeatLevels, EPIC_BOON_MIN_LEVEL } from '$lib/build/rules';
import { ANY_OPTION, FEAT_CATEGORY, splitList } from '$lib/content/schemas';
import {
	asiPickCount,
	toggleCapped,
	ORIGIN_SLOT_KEY,
	SPECIES_SLOT_KEY,
	type FeatSpellChoice,
} from './draft';
import { ASI, ASI_FEAT_ID, rowName, rowOfType } from './rows';
import type { AsiShape } from './draft';

/** What the slot machinery needs from the build view-model around it — picked off the class rather
 *  than re-described, so the two cannot drift apart. `import type` is erased, so no runtime cycle. */
export type FeatsHost = Pick<
	BuildVM,
	'draft' | 'graph' | 'featList' | 'backgroundRow' | 'speciesRow' | 'speciesOptionRow' | 'row'
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
	/**
	 * The feat ids the SPECIES offers to choose between, off its `feat_choice` column: `any` for every
	 * feat the slot would otherwise offer, or a comma list to choose within. Empty = this species
	 * grants no feat, which is every species the SRD ships.
	 *
	 * A choice and not a grant, on purpose: a species whose feat is FIXED says so on `effects` like
	 * any other trait, and the shape this column exists for is the one where more than one is legal.
	 */
	speciesFeatChoice = $derived.by<string[]>(() => {
		const raw = String(
			this.host().speciesOptionRow?.data.feat_choice ||
				this.host().speciesRow?.data.feat_choice ||
				'',
		);
		return splitList(raw);
	});
	/** Does the species ask for a feat at all? */
	speciesGrantsFeat = $derived(this.speciesFeatChoice.length > 0);
	/** What the species slot may be filled with. `any` means every feat an ordinary slot offers at
	 *  level 1; a list names its own ids, and one naming nothing that exists offers nothing rather
	 *  than silently falling back to everything. */
	speciesFeatOptions = $derived.by<LoadedRow[]>(() => {
		const choice = this.speciesFeatChoice;
		if (!choice.length) return [];
		const options = this.featOptionsFor(1);
		if (choice.length === 1 && choice[0]?.toLowerCase() === ANY_OPTION) return options;
		return options.filter((f) => choice.includes(f.id));
	});
	/** The feat taken in the species slot, or null while the question is open. */
	speciesFeatRef = $derived.by<string | null>(
		() => this.host().draft.slotFeats[SPECIES_SLOT_KEY] ?? null,
	);
	/** Is this slot the species' one? Its answer is a feat and nothing else — an ability improvement
	 *  is what a LEVEL offers, and offering it here would let a species grant be spent on something
	 *  the species never granted. */
	slotIsSpecies = (key: string): boolean => key === SPECIES_SLOT_KEY;

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
	/** The slots still waiting for a feat — the class levels' and, where a species grants one, its
	 *  own. Lives here rather than in the view-model's todo call because which slots EXIST is this
	 *  subsystem's fact; the todo list only words it. */
	openFeatSlots = $derived.by<
		{ key: string; level: number; className: string; species?: string }[]
	>(() =>
		[
			...this.featSlots,
			// the species' slot joins only when a species actually grants a feat, so every SRD
			// species (none does) adds no line
			...(this.speciesGrantsFeat
				? [
						{
							key: SPECIES_SLOT_KEY,
							level: 1,
							className: '',
							species: rowName(this.host().speciesOptionRow ?? this.host().speciesRow),
						},
					]
				: []),
		].filter((slot) => !this.host().draft.slotFeats[slot.key]),
	);

	/** Every slot key that can hold a feat right now — the class slots plus the species' one. What
	 *  `usedFeatRefs` and the §C fold walk, so a species feat counts as taken exactly like a slot's. */
	choiceKeys = $derived.by<string[]>(() => [
		...this.featSlots.map((s) => s.key),
		...(this.speciesGrantsFeat ? [SPECIES_SLOT_KEY] : []),
	]);
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
		this.choiceKeys.flatMap((key) => {
			const ref = this.host().draft.slotFeats[key];
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
		// §D likewise: the list and ability answered for the old feat say nothing about the new one.
		// The SPELLS picked under it are left alone — they are ordinary entries in the spell list, and
		// a player who swaps a feat has not asked to lose them.
		const featSp = { ...this.host().draft.slotFeatSpells };
		delete featSp[key];
		this.host().draft.slotFeatSpells = featSp;
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
	/** How many of the improvements this character owes are answered — the level slots plus the
	 *  species' one, so the card's counter says the same total the list below it shows. */
	filledSlots = $derived(this.choiceKeys.filter((key) => this.host().draft.slotFeats[key]).length);

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
		for (const key of this.choiceKeys)
			take(key, this.featSkillCountOf(this.host().draft.slotFeats[key]));
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
		// §D asks two questions of a granted feat as well, and an unanswered one grants no spells at all
		const spellOwed =
			this.featSpellGrantsOf(ref).length && !this.featSpellChoiceFor(ORIGIN_SLOT_KEY) ? 1 : 0;
		return skillsOwed + abilityOwed + spellOwed;
	});

	// --- §D spell choice-grant (Magic Initiate: a list, an ability, and N spells) ------
	// The feat asks TWO questions here and the rest in the Spells pane: once a list is chosen the feat
	// is a caster profile of its own (`character/spellcasting.ts`), so the ordinary picker offers its
	// spells under its own caps. Data-driven off `spell_choice*`, so a homebrew feat of this shape
	// works with no feat id anywhere in the code.
	/** Does this feat REF teach spells at all? */
	featSpellGrantsOf = (ref: string | null): FeatSpellGrant[] => {
		if (!ref || ref === ASI) return [];
		return featSpellGrants(rowOfType(this.host().graph?.get(ref), 'feat')?.data.spell_choice);
	};
	/**
	 * The class spell LISTS a feat may draw from, as rows — so the pane shows each list's own name in
	 * the player's language rather than a bare id. Scoped to the draft's edition.
	 *
	 * A background that grants the feat PINS the list ("Magic Initiate (Cleric)" — Acolyte), so there
	 * is one row and no question. The pin lives in the background's own column, never in a rule about
	 * which feat it is.
	 */
	featSpellListsFor = (key: string): LoadedRow[] => {
		const ref = this.featRefFor(key);
		if (!ref || ref === ASI) return [];
		const spec = rowOfType(this.host().graph?.get(ref), 'feat')?.data.spell_choice_lists;
		const pinned = key === ORIGIN_SLOT_KEY ? this.host().backgroundRow?.data.origin_feat_spell_list : undefined;
		const wanted = pinned ? [pinned] : splitList(spec);
		// all three columns or none: without an ability there is nothing to cast these spells WITH, and
		// picking one for the author would be inventing the rule. The shipped rows are pinned by
		// `feats_content.test.ts`; this is what a half-written homebrew row gets.
		if (!wanted.length || !this.featSpellAbilitiesFor(key).length) return [];
		const classes = this.host().graph?.list('class', { system: this.host().draft.system }) ?? [];
		return wanted.flatMap((id) => classes.filter((c) => c.id === id));
	};
	/** The abilities offered as the casting ability for a feat's spells (`spell_choice_ability`). */
	featSpellAbilitiesFor = (key: string): Ability[] => {
		const ref = this.featRefFor(key);
		if (!ref || ref === ASI) return [];
		return halfFeatAbilities(
			rowOfType(this.host().graph?.get(ref), 'feat')?.data.spell_choice_ability,
		);
	};
	featSpellChoiceFor = (key: string): FeatSpellChoice | undefined =>
		this.host().draft.slotFeatSpells[key];
	/** Choosing the list also settles the ability if the feat offers exactly one — a question with one
	 *  answer is not a question. */
	setFeatSpellList = (key: string, list: string) => {
		const current = this.featSpellChoiceFor(key);
		const abilities = this.featSpellAbilitiesFor(key);
		const ability = current?.ability ?? abilities[0];
		if (!ability) return;
		this.host().draft.slotFeatSpells = {
			...this.host().draft.slotFeatSpells,
			[key]: { list, ability },
		};
	};
	/** Picking the ability settles the LIST too when only one is on offer — a background's pinned list
	 *  is not a question, and making the player tap a lone chip to confirm it is a trip for nothing. */
	setFeatSpellAbility = (key: string, ability: Ability) => {
		const list = this.featSpellChoiceFor(key)?.list ?? this.featSpellListsFor(key)[0]?.id;
		if (!list) return;
		this.host().draft.slotFeatSpells = {
			...this.host().draft.slotFeatSpells,
			[key]: { list, ability },
		};
	};
	/** RAW for a repeatable spell feat: a second Magic Initiate must name a DIFFERENT list. Strict
	 *  blocks the duplicate; Free allows it, like every other cap in the builder. */
	featSpellListTakenElsewhere = (key: string, list: string): boolean => {
		const ref = this.featRefFor(key);
		return Object.entries(this.host().draft.slotFeatSpells).some(
			([k, choice]) => k !== key && choice.list === list && this.featRefFor(k) === ref,
		);
	};
	/** Every answered §D feat, flattened for `build.featSpells` — the derive's view of them. A slot
	 *  whose feat no longer teaches spells drops out here rather than lingering in the character. */
	featSpellPicks = $derived.by<{ feat: string; key: string; list: string; ability: Ability }[]>(() => {
		const keys = [...this.choiceKeys, ORIGIN_SLOT_KEY];
		return keys.flatMap((key) => {
			const ref = this.featRefFor(key);
			const choice = this.host().draft.slotFeatSpells[key];
			if (!ref || !choice || !this.featSpellGrantsOf(ref).length) return [];
			return [{ feat: ref, key, list: choice.list, ability: choice.ability }];
		});
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
