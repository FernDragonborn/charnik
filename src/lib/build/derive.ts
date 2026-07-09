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
import type { StatMethod } from './rules';

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
		const effects = src && 'effects' in src.data ? src.data.effects : undefined;
		const eff = Array.isArray(effects) ? effects : [];
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
	const levelOf = (s: LoadedRow) => (s.type === 'spell' ? Number(s.data.level ?? 0) : 0);
	const chosenLevel = (id: string) => {
		const r = graph.get(id);
		return r?.type === 'spell' ? Number(r.data.level ?? 0) : 0;
	};
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
		for (const s of pool) {
			const bucket = byLevel.get(levelOf(s)) ?? [];
			bucket.push(s);
			byLevel.set(levelOf(s), bucket);
		}
		const groups = [...byLevel.keys()]
			.sort((a, b) => a - b)
			.map((lvl) => ({
				level: lvl,
				label: lvl === 0 ? 'Cantrips' : `Level ${lvl}`,
				spells: byLevel.get(lvl) ?? []
			}));
		const selectedInClass = selectedSpells.filter(inClass);
		const cantripsChosen = selectedInClass.filter((id) => chosenLevel(id) === 0).length;
		const leveledChosen = selectedInClass.filter((id) => chosenLevel(id) > 0).length;
		return { profile, groups, cantripsChosen, leveledChosen };
	});
}

/** The blocking-in-Strict validation messages for a draft. Free is lenient (a name is all that's
 *  strictly required — enforced by the caller); Strict adds the allocation checks below. Pure. */
export function buildIssues(
	d: { name: string; method: StatMethod; strict: boolean },
	deps: {
		hasClass: boolean;
		pointsLeft: number;
		classSkillCount: number;
		skillChosenCount: number;
		spellPicker: ReturnType<typeof buildSpellPicker>;
	}
): string[] {
	const out: string[] = [];
	if (!d.name.trim()) out.push('Give your character a name.');
	if (!deps.hasClass) out.push('Pick a class (you can change it later).');
	if (d.method === 'point-buy' && deps.pointsLeft > 0)
		out.push(`${deps.pointsLeft} ability points unspent.`);
	if (d.strict) {
		const needSkills = deps.classSkillCount - deps.skillChosenCount;
		if (needSkills > 0) out.push(`Choose ${needSkills} more skill${needSkills > 1 ? 's' : ''}.`);
		for (const pc of deps.spellPicker) {
			const dc = pc.profile.cantripCap - pc.cantripsChosen;
			const dp = pc.profile.preparedCap - pc.leveledChosen;
			const who = deps.spellPicker.length > 1 ? `${pc.profile.className} ` : '';
			if (dc > 0) out.push(`Choose ${dc} more ${who}cantrip${dc > 1 ? 's' : ''}.`);
			if (dc < 0) out.push(`Remove ${-dc} ${who}cantrip${dc < -1 ? 's' : ''} (over cap).`);
			if (dp > 0) out.push(`Choose ${dp} more ${who}spell${dp > 1 ? 's' : ''}.`);
			if (dp < 0) out.push(`Remove ${-dp} ${who}spell${dp < -1 ? 's' : ''} (over cap).`);
		}
	}
	return out;
}
