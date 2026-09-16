/*
 * The six numbers and where every point in them came from: the three generation methods (point buy,
 * standard array, manual) and the boosts layered on top (a 5.5e background choice, a 5e species
 * free-choice, and each ASI / half-feat slot). Split out of the build view-model.
 *
 * `slotBoosts` is deliberately separate from `abilityBoosts` even though one folds into the other: a
 * loaded character's flat boosts already contain what its slots granted, so `abilityBoosts` subtracts
 * the slots AS THE SAVE HELD THEM and a restored slot does not apply its boost a second time
 * (UBUG-13) — nor keep the old ability when the pick moves to another one.
 *
 * Everything reading the host is a getter, never `$derived`: a field initialiser runs before the
 * constructor assigns `host`.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { ABILITIES } from '$lib/character/schema';
import type { Ability } from '$lib/rules/core';
import {
	allocateBackgroundBoost,
	baseAbilities,
	boostCarrier,
	boostPickCount,
	canLower,
	canRaise,
	pointsSpent,
	MANUAL_SCORE_BOUNDS,
	POINT_BUY_BUDGET,
	POINT_BUY_MAX,
	POINT_BUY_MIN,
	pointBuyCost,
	STANDARD_ARRAY,
	type StatMethod,
} from '$lib/build/rules';
import { asiBoost, parseSpeciesBoostChoice, speciesFixedAbilities } from '$lib/build/derive';
import { splitList } from '$lib/content/schemas';
import { signed } from '$lib/util/format';
import { toggleCapped, ORIGIN_SLOT_KEY } from './draft';
import { ASI } from './rows';
import type { DraftState, EditContext } from './draft';
import type { FeatSlots } from './feat-slots.svelte';
import type { LoadedRowByType } from '$lib/content/loader';

/** Where a single point in an ability came from — the parts of the provenance line an ability row
 *  shows. Numbers, not a sentence: the component translates it (the module stays locale-free). */
export interface AbilityProvenance {
	base: number;
	/** Allocated boosts (background choice, ASI, half-feat). */
	boost: number;
	/** Everything else that moved the score — species traits, effects. */
	other: number;
	/** Which layer carries this edition's origin bonuses, for naming `other`. */
	carrier: 'species' | 'background';
}

/** The provenance line an ability row shows ("base 15 · boost +2 · species +1"). Takes the
 *  translator rather than importing one, like `why()` — this module stays locale-free and the caller
 *  passes `$_`. Parts that contributed nothing are left out; a bare "base N" is the common case. */
export function abilityProvenanceText(
	p: AbilityProvenance,
	t: (key: string, options?: { values?: Record<string, string | number> }) => string
): string {
	const parts = [t('build.abilities.provenanceBase', { values: { score: p.base } })];
	if (p.boost) parts.push(t('build.abilities.provenanceBoost', { values: { amount: signed(p.boost) } }));
	if (p.other)
		parts.push(
			t(
				p.carrier === 'species'
					? 'build.abilities.provenanceSpecies'
					: 'build.abilities.provenanceOther',
				{ values: { amount: signed(p.other) } }
			)
		);
	return parts.join(' · ');
}

/** Fold one boost map into another, in place. */
function addBoosts(
	out: Partial<Record<Ability, number>>,
	more: Partial<Record<Ability, number>>,
): void {
	for (const a of ABILITIES) if (more[a]) out[a] = (out[a] ?? 0) + more[a];
}

/** What the allocation needs from the build around it. */
export interface AbilityAllocationHost {
	draft: DraftState;
	edit: EditContext | null;
	feats: FeatSlots;
	backgroundRow: LoadedRowByType<'background'> | undefined;
	speciesRow: LoadedRowByType<'species'> | undefined;
	speciesOptionRow: LoadedRowByType<'species_option'> | undefined;
}

export class AbilityAllocation {
	constructor(private host: () => AbilityAllocationHost) {}

	setMethod = (m: StatMethod) => {
		this.host().draft.method = m;
		if (m === 'standard_array') this.host().draft.arrayPick = {};
		if (m === 'point_buy') this.host().draft.abilities = baseAbilities();
	};
	get pointsUsed(): number {
		return pointsSpent(this.host().draft.abilities);
	}
	get pointsLeft(): number {
		return POINT_BUY_BUDGET - this.pointsUsed;
	}

	bumpAbility = (ab: Ability, dir: 1 | -1) => {
		// editing an existing character in Strict: base scores are locked (you don't re-roll them at
		// level-up — increases come only from ASI slots). Free lets you edit anything.
		if (this.host().edit && this.host().draft.strict) {
			toast(t('build.strictSettled'));
			return;
		}
		const cur = this.host().draft.abilities[ab];
		if (this.host().draft.method === 'point_buy') {
			// point buy keeps its budget and caps in BOTH modes, so the counter beside it means something
			// — and a refusal SAYS which of the two stopped it. A step from 13 to 14 costs 2 where every
			// step before it cost 1, so a button that moved nothing and explained nothing read as broken.
			if (dir === 1 && !canRaise(this.host().draft.abilities, ab)) {
				const next = cur + 1;
				if (next > POINT_BUY_MAX) toast(t('build.abilities.pointBuyCap', { max: POINT_BUY_MAX }));
				else
					toast(
						t('build.abilities.pointBuyTooExpensive', {
							cost: pointBuyCost(next) - pointBuyCost(cur),
							left: this.pointsLeft,
						}),
					);
				return;
			}
			if (dir === -1 && !canLower(this.host().draft.abilities, ab)) {
				toast(t('build.abilities.pointBuyFloor', { min: POINT_BUY_MIN }));
				return;
			}
		} else {
			const bounds = MANUAL_SCORE_BOUNDS[this.host().draft.strict ? 'strict' : 'free'];
			if (cur + dir < bounds.min || cur + dir > bounds.max) {
				toast(t('build.abilities.scoreBounds', bounds));
				return;
			}
		}
		this.host().draft.abilities = { ...this.host().draft.abilities, [ab]: cur + dir };
	};

	/** Standard array: assign the next unused value to an ability, or clear it. */
	assignArray = (ab: Ability, value: number | null) => {
		const next = { ...this.host().draft.arrayPick };
		const scores = { ...this.host().draft.abilities };
		// each array value is used once, so taking it moves it — and the ability it LEFT goes back to
		// the floor with it. The two are one fact in two places: dropping only the pick left that
		// ability showing the score it no longer holds, with no chip to say where it came from.
		if (value != null)
			for (const k of ABILITIES)
				if (k !== ab && next[k] === value) {
					delete next[k];
					scores[k] = POINT_BUY_MIN;
				}
		if (value == null) delete next[ab];
		else next[ab] = value;
		this.host().draft.arrayPick = next;
		this.host().draft.abilities = { ...scores, [ab]: value ?? POINT_BUY_MIN };
	};
	/** Standard-array values not yet assigned to an ability. */
	get arrayRemaining(): number[] {
		const used = new Set(Object.values(this.host().draft.arrayPick));
		return STANDARD_ARRAY.filter((v) => !used.has(v));
	}

	// --- the species' "+N to M of your choice" ASI (5e Half-Elf) ----------------
	/** The free-choice shape the species or its sub-option offers, if any (e.g. `1x2`). */
	get speciesBoostChoice(): { amount: number; count: number } | null {
		const row = this.host().speciesOptionRow ?? this.host().speciesRow;
		return parseSpeciesBoostChoice(
			String(this.host().speciesOptionRow?.data.boost_choice || row?.data.boost_choice || ''),
		);
	}
	/** Abilities the species' FIXED ASI already raised — excluded from the choice, because 5e
	 *  Half-Elf's +1/+1 goes to two abilities OTHER than the +2 CHA. */
	get speciesFixedAbilities(): ReadonlySet<Ability> {
		return speciesFixedAbilities([this.host().speciesRow, this.host().speciesOptionRow]);
	}
	/** What the free choice may be spent on: all six minus the fixed-boosted ones. */
	get speciesBoostAbilities(): Ability[] {
		return ABILITIES.filter((a) => !this.speciesFixedAbilities.has(a));
	}
	toggleSpeciesBoostPick = (ab: Ability) => {
		this.host().draft.speciesBoostPicks = toggleCapped(
			this.host().draft.speciesBoostPicks,
			ab,
			this.speciesBoostChoice?.count ?? 0,
		);
	};

	// --- ability boosts (5.5e background choice; 5e species flows via effects) --
	get boostCarrier(): 'background' | 'species' {
		return boostCarrier(this.host().draft.system);
	}
	get backgroundBoostChoices(): Ability[] {
		return splitList(this.host().backgroundRow?.data.ability_choices).filter((a): a is Ability =>
			(ABILITIES as readonly string[]).includes(a),
		);
	}
	/** JUST the 5.5e background boost allocation (for the background chips — so an ASI boost doesn't
	 *  leak into them). Empty unless a 5.5e background offers a choice. */
	get backgroundBoosts(): Partial<Record<Ability, number>> {
		return this.boostCarrier === 'background' && this.backgroundBoostChoices.length
			? allocateBackgroundBoost(
					this.host().draft.boostShape,
					this.host().draft.boostPicks,
					this.backgroundBoostChoices,
				)
			: {};
	}
	/**
	 * Ability boosts derived PURELY from the ASI/feat slots (per-slot +2/+1 ASI + each half-feat's +1),
	 * read off ONE set of slot maps — the live draft for what the build grants now, and the draft as it
	 * was LOADED for the share the save's own flat boosts already carry.
	 *
	 * Both walk the LIVE slot list: lowering a class level in Free takes a slot off the sheet without
	 * taking its pick out of either map, and the save did not count such an orphan either.
	 */
	private boostsFromSlots(
		slots: Pick<DraftState, 'slotFeats' | 'slotAsi' | 'slotFeatAbility'>,
	): Partial<Record<Ability, number>> {
		const out: Partial<Record<Ability, number>> = {};
		const feats = this.host().feats;
		for (const s of feats.featSlots)
			if (slots.slotFeats[s.key] === ASI) addBoosts(out, asiBoost(slots.slotAsi[s.key]));
		// half-feat +1 (Grappler STR/DEX, Epic Boon any) — the chosen ability of each half-feat slot, and
		// of the granted origin feat, which asks the same question without being a slot. Validated
		// against the options of the feat THESE maps hold, so a slot whose feat changed is measured by
		// the feat that granted the +1 rather than by the one sitting there now.
		for (const key of [...feats.featSlots.map((s) => s.key), ORIGIN_SLOT_KEY]) {
			const ab = slots.slotFeatAbility[key];
			const ref = key === ORIGIN_SLOT_KEY ? feats.originFeatRef : (slots.slotFeats[key] ?? null);
			if (ab && feats.halfFeatOptionsOf(ref).includes(ab)) out[ab] = (out[ab] ?? 0) + 1;
		}
		return out;
	}
	get slotBoosts(): Partial<Record<Ability, number>> {
		return this.boostsFromSlots(this.host().draft);
	}
	/** All ability boosts folded together: 5.5e background choice + species free-choice + every ASI slot. */
	get abilityBoosts(): Partial<Record<Ability, number>> {
		const out: Partial<Record<Ability, number>> = {};
		const add = (m: Partial<Record<Ability, number>>) => addBoosts(out, m);
		const slots = this.slotBoosts;
		const edit = this.host().edit;
		// A loaded character's flat boosts already CONTAIN what its slots granted, and those slots come
		// back restored and re-derive their own — so only the residue is carried (species / background,
		// and an old save that stored no slots at all, where nothing subtracts).
		//
		// What is subtracted is what the SAVE's own picks granted, never what the live ones grant:
		// against the live picks, moving a pick to another ability leaves the ability it left with
		// nothing to cancel against, so the old boost survives as residue while the new one is added on
		// top — and the inflated total is written back, compounding on every move.
		//
		// The subtraction lives here rather than in `hydrate` because it walks the slot list, which
		// needs the content graph for the class's ASI levels: a hydrate racing the graph load sees NO
		// slots, subtracts nothing, and every carried boost is applied a second time when it lands.
		const granted = edit ? this.boostsFromSlots(edit.loaded) : {};
		addBoosts(
			out,
			Object.fromEntries(
				ABILITIES.map((a) => [a, Math.max((edit?.boosts[a] ?? 0) - (granted[a] ?? 0), 0)]),
			),
		);
		add(this.backgroundBoosts); // 5.5e background choice (empty unless the guard in backgroundBoosts holds)
		// species free-choice ASI (5e Half-Elf +1/+1)
		const speciesChoice = this.speciesBoostChoice;
		if (speciesChoice)
			for (const ab of this.host().draft.speciesBoostPicks)
				out[ab] = (out[ab] ?? 0) + speciesChoice.amount;
		add(slots);
		return out;
	}
	toggleBoostPick = (ab: Ability) => {
		this.host().draft.boostPicks = toggleCapped(
			this.host().draft.boostPicks,
			ab,
			boostPickCount(this.host().draft.boostShape)
		);
	};

	/** Where this ability's final score came from. `other` is whatever the base and the allocated
	 *  boosts don't account for — species traits and effects, which never pass through here, so the
	 *  caller supplies the derived total rather than this module reaching for the sheet (which would
	 *  make the view-model's type inference circular: sheet → assembled → abilities → sheet). */
	provenance = (ab: Ability, derivedTotal?: number): AbilityProvenance => {
		const base = this.host().draft.abilities[ab];
		const boost = this.abilityBoosts[ab] ?? 0;
		return {
			base,
			boost,
			other: (derivedTotal ?? base) - base - boost,
			carrier: this.boostCarrier
		};
	};
}
