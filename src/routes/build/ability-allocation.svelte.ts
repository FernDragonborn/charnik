/*
 * The six numbers and where every point in them came from: the three generation methods (point buy,
 * standard array, manual) and the boosts layered on top (a 5.5e background choice, a 5e species
 * free-choice, and each ASI / half-feat slot). Split out of the build view-model.
 *
 * `slotBoosts` is deliberately separate from `abilityBoosts` even though one folds into the other:
 * `hydrate` has to SUBTRACT the slot-derived half from a loaded character's flat boosts, because the
 * restored slots re-derive their own boost and carrying it flat as well double-applies it (UBUG-13).
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
	POINT_BUY_BUDGET,
	STANDARD_ARRAY,
	type StatMethod,
} from '$lib/build/rules';
import { splitList as csv } from '$lib/content/schemas';
import { toggleCapped } from './draft';
import { ASI } from './rows';
import type { DraftState, EditContext } from './draft';
import type { FeatSlots } from './feat-slots.svelte';
import type { LoadedRowByType } from '$lib/content/loader';

/** What the allocation needs from the build around it. */
export interface AbilityAllocationHost {
	draft: DraftState;
	edit: EditContext | null;
	feats: FeatSlots;
	backgroundRow: LoadedRowByType<'background'> | undefined;
	/** The species' "+N to M of your choice" shape (5e Half-Elf), or null when it offers none. */
	speciesBoostChoice: { amount: number; count: number } | null;
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
		if (this.host().draft.method === 'point_buy' && !this.host().draft.strict) {
			// lenient point-buy still respects budget/caps to keep the counter meaningful
		}
		if (this.host().draft.method === 'point_buy') {
			if (dir === 1 && !canRaise(this.host().draft.abilities, ab)) return;
			if (dir === -1 && !canLower(this.host().draft.abilities, ab)) return;
		} else {
			// manual: 1..30 (Free) or 3..20 (Strict-ish) — stay lenient, just clamp sane bounds
			const lo = this.host().draft.strict ? 3 : 1;
			const hi = this.host().draft.strict ? 20 : 30;
			if (cur + dir < lo || cur + dir > hi) return;
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
		this.host().draft.abilities = { ...this.host().draft.abilities, [ab]: value ?? 8 };
	};
	/** Standard-array values not yet assigned to an ability. */
	get arrayRemaining(): number[] {
		const used = new Set(Object.values(this.host().draft.arrayPick));
		return STANDARD_ARRAY.filter((v) => !used.has(v));
	}

	// --- ability boosts (5.5e background choice; 5e species flows via effects) --
	get boostCarrier(): 'background' | 'species' {
		return boostCarrier(this.host().draft.system);
	}
	get backgroundBoostChoices(): Ability[] {
		return csv(this.host().backgroundRow?.data.ability_choices).filter((a): a is Ability =>
			(ABILITIES as readonly string[]).includes(a),
		);
	}
	/** JUST the 5.5e background boost allocation (for the background chips — so an ASI boost doesn't
	 *  leak into them). Empty unless a 5.5e background offers a choice. */
	get backgroundBoosts(): Partial<Record<Ability, number>> {
		return this.host().draft.system === '5.5e' && this.backgroundBoostChoices.length
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
		const add = (m: Partial<Record<Ability, number>>) => {
			for (const a of ABILITIES) if (m[a]) out[a] = (out[a] ?? 0) + (m[a] as number);
		};
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
		const add = (m: Partial<Record<Ability, number>>) => {
			for (const a of ABILITIES) if (m[a]) out[a] = (out[a] ?? 0) + (m[a] as number);
		};
		add(this.host().edit?.boosts ?? {}); // NON-slot boosts carried from a loaded character (species/background)
		add(this.backgroundBoosts); // 5.5e background choice (empty unless the guard in backgroundBoosts holds)
		// species free-choice ASI (5e Half-Elf +1/+1)
		const speciesChoice = this.host().speciesBoostChoice;
		if (speciesChoice)
			for (const ab of this.host().draft.speciesBoostPicks)
				out[ab] = (out[ab] ?? 0) + speciesChoice.amount;
		add(this.slotBoosts);
		return out;
	}
	toggleBoostPick = (ab: Ability) => {
		this.host().draft.boostPicks = toggleCapped(
			this.host().draft.boostPicks,
			ab,
			boostPickCount(this.host().draft.boostShape)
		);
	};
}
