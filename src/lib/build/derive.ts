/*
 * Pure, content-graph-aware build computations — the option/derivation logic the Build VM wraps in
 * `$derived`. Kept out of build/rules.ts (which stays "just numbers, no graph") and out of the VM
 * (which keeps only reactive wiring), so these are plain, unit-testable functions. No Svelte runes.
 */
import type { Ability } from '../rules/core';
import { ABILITIES } from '../character/schema';
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { CharacterSheet } from '../character/derive';
import { parseEffect, EFFECT_KIND } from '../effects/index';

/** Parse a species free-choice ASI spec ("1x2" = +1 to 2 abilities) → `{amount, count}`, or null. */
export function parseSpeciesBoostChoice(raw: string): { amount: number; count: number } | null {
	const m = /^(\d+)x(\d+)$/.exec(raw.trim());
	return m ? { amount: Number(m[1]), count: Number(m[2]) } : null;
}

/** Abilities raised by a species/sub-option's FIXED ASI (its flat-bonus effects) — excluded from the
 *  free choice (5e Half-Elf's +1/+1 goes to two abilities OTHER than the +2 CHA). */
export function speciesFixedAbilities(rows: (LoadedRow | undefined)[]): Set<Ability> {
	const set = new Set<Ability>();
	for (const src of rows) {
		const eff = Array.isArray(src?.data.effects) ? (src!.data.effects as string[]) : [];
		for (const t of eff) {
			const p = parseEffect(t);
			if (
				p.kind === EFFECT_KIND.flatBonus &&
				p.target &&
				(ABILITIES as readonly string[]).includes(p.target)
			)
				set.add(p.target as Ability);
		}
	}
	return set;
}

/** One per-slot ASI allocation (+2 to one ability, or +1 to two) → its ability-boost map. */
export function asiBoost(
	alloc: { shape: '2' | '1-1'; picks: Ability[] } | undefined
): Partial<Record<Ability, number>> {
	if (!alloc) return {};
	const out: Partial<Record<Ability, number>> = {};
	if (alloc.shape === '2') {
		if (alloc.picks[0]) out[alloc.picks[0]] = 2;
	} else {
		for (const ab of alloc.picks.slice(0, 2)) out[ab] = (out[ab] ?? 0) + 1;
	}
	return out;
}

/** Build the per-caster-class spell picker: the pickable spell pool grouped by level, plus the
 *  cantrip/leveled counts already chosen. Strict shows only legally-pickable spells (class access +
 *  ≤ max spell level); Free lifts every gate. */
export function buildSpellPicker(
	allSpells: LoadedRow[],
	sheet: CharacterSheet,
	graph: ContentGraph,
	strict: boolean,
	selectedSpells: string[]
) {
	const levelOf = (s: LoadedRow) => Number(s.data.level ?? 0);
	return sheet.spellcasting.classes.map((profile) => {
		const access = new Set(profile.accessSpellIds);
		const inClass = (id: string) => !strict || access.has(id);
		const pool = allSpells.filter((s) => {
			if (!strict) return true;
			// class access gate — cantrips are on the class list too, so gate them the same way
			if (!access.has(s.effectiveId)) return false;
			return levelOf(s) <= profile.maxSpellLevel;
		});
		const byLevel = new Map<number, LoadedRow[]>();
		for (const s of pool)
			(byLevel.get(levelOf(s)) ?? byLevel.set(levelOf(s), []).get(levelOf(s))!).push(s);
		const groups = [...byLevel.keys()]
			.sort((a, b) => a - b)
			.map((lvl) => ({
				level: lvl,
				label: lvl === 0 ? 'Cantrips' : `Level ${lvl}`,
				spells: byLevel.get(lvl)!
			}));
		const selectedInClass = selectedSpells.filter(inClass);
		const cantripsChosen = selectedInClass.filter(
			(id) => Number(graph.get(id)?.data.level ?? 0) === 0
		).length;
		const leveledChosen = selectedInClass.filter(
			(id) => Number(graph.get(id)?.data.level ?? 0) > 0
		).length;
		return { profile, groups, cantripsChosen, leveledChosen };
	});
}
