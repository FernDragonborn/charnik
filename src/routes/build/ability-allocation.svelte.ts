/*
 * The six numbers and where every point in them came from: the three generation methods (point buy,
 * standard array, manual) and the boosts layered on top (a 5.5e background choice, a 5e species
 * free-choice, and each ASI / half-feat slot). Split out of the build view-model.
 *
 * `slotBoosts` is deliberately separate from `abilityBoosts` even though one folds into the other: a
 * loaded character's flat boosts already contain it, so `abilityBoosts` subtracts one from the other
 * and a restored slot does not apply its boost a second time (UBUG-13).
 *
 * Everything reading the host is a getter, never `$derived`: a field initialiser runs before the
 * constructor assigns `host`.
 */
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
	POINT_BUY_MIN,
	STANDARD_ARRAY,
	type StatMethod,
} from '$lib/build/rules';
import { parseSpeciesBoostChoice, speciesFixedAbilities } from '$lib/build/derive';
import { splitList } from '$lib/content/schemas';
import { signed } from '$lib/util/format';
import { toggleCapped } from './draft';
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
		if (this.host().edit && this.host().draft.strict) return;
		const cur = this.host().draft.abilities[ab];
		if (this.host().draft.method === 'point_buy') {
			// point buy keeps its budget and caps in BOTH modes, so the counter beside it means something
			if (dir === 1 && !canRaise(this.host().draft.abilities, ab)) return;
			if (dir === -1 && !canLower(this.host().draft.abilities, ab)) return;
		} else {
			const bounds = MANUAL_SCORE_BOUNDS[this.host().draft.strict ? 'strict' : 'free'];
			if (cur + dir < bounds.min || cur + dir > bounds.max) return;
		}
		this.host().draft.abilities = { ...this.host().draft.abilities, [ab]: cur + dir };
	};

	/** Standard array: assign the next unused value to an ability, or clear it. */
	assignArray = (ab: Ability, value: number | null) => {
		const next = { ...this.host().draft.arrayPick };
		// remove this value from any other ability first (each value used once)
		if (value != null) for (const k of ABILITIES) if (next[k] === value) delete next[k];
		if (value == null) delete next[ab];
		else next[ab] = value;
		this.host().draft.arrayPick = next;
		this.host().draft.abilities = { ...this.host().draft.abilities, [ab]: value ?? POINT_BUY_MIN };
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
	/** Ability boosts derived PURELY from the ASI/feat slots (per-slot +2/+1 ASI + each half-feat's +1).
	 *  Split out of `abilityBoosts` so `hydrate` can subtract them from the carried flat boosts — a
	 *  restored slot re-derives its own boost, so carrying it flat too would double-apply (UBUG-13). */
	get slotBoosts(): Partial<Record<Ability, number>> {
		const out: Partial<Record<Ability, number>> = {};
		const add = (m: Partial<Record<Ability, number>>) => addBoosts(out, m);
		for (const s of this.host().feats.featSlots) if (this.host().draft.slotFeats[s.key] === ASI) add(this.host().feats.asiBoostFor(s.key));
		// half-feat +1 (Grappler STR/DEX, Epic Boon any) — the chosen ability of each half-feat slot
		for (const s of this.host().feats.featSlots) {
			const ab = this.host().draft.slotFeatAbility[s.key];
			if (ab && this.host().feats.halfFeatOptionsFor(s.key).includes(ab)) out[ab] = (out[ab] ?? 0) + 1;
		}
		return out;
	}
	/** All ability boosts folded together: 5.5e background choice + species free-choice + every ASI slot. */
	get abilityBoosts(): Partial<Record<Ability, number>> {
		const out: Partial<Record<Ability, number>> = {};
		const add = (m: Partial<Record<Ability, number>>) => addBoosts(out, m);
		const slots = this.slotBoosts;
		// A loaded character's flat boosts already CONTAIN what its slots granted, and those slots come
		// back restored and re-derive their own — so only the residue is carried (species / background,
		// and an old save that stored no slots at all, where nothing subtracts).
		//
		// The subtraction lives here rather than in `hydrate` because `slotBoosts` needs the content
		// graph for the class's ASI levels: a hydrate racing the graph load sees NO slots, subtracts
		// nothing, and every carried boost is then applied a second time when the graph lands.
		addBoosts(
			out,
			Object.fromEntries(
				ABILITIES.map((a) => [a, Math.max((this.host().edit?.boosts[a] ?? 0) - (slots[a] ?? 0), 0)]),
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
