/*
 * Pure, content-graph-aware build computations — the option/derivation logic the Build VM wraps in
 * `$derived`. Kept out of build/rules.ts (which stays "just numbers, no graph") and out of the VM
 * (which keeps only reactive wiring), so these are plain, unit-testable functions. No Svelte runes.
 */
import type { Ability } from '../rules/core';
import { ABILITIES } from '../character/schema';
import type { ContentGraph, LoadedRow } from '../content/loader';
import type { CharacterSheet } from '../character/derive';
import { casterForSpell } from '../character/spellcasting';
import { parseToken, splitGuard, EFFECT_KIND } from '../effects/token-parser';
import type { StatMethod } from './rules';

/** The abilities a half-feat's +1 may be assigned to, from its `ability_choice` column: `any` → all
 *  six (Epic Boons), else the listed subset (`str,dex` → Grappler). Empty/absent → `[]` (not a
 *  half-feat). Order follows ABILITIES for a stable picker. Pure. */
export function halfFeatAbilities(spec: string | undefined): Ability[] {
	if (!spec) return [];
	const raw = spec.trim().toLowerCase();
	if (raw === 'any') return [...ABILITIES];
	const wanted = new Set(raw.split(',').map((s) => s.trim()));
	return ABILITIES.filter((a) => wanted.has(a));
}

/** Sum the `level:count` expertise pairs (`"1:2,6:2"`) whose unlock level ≤ the class level. A single
 *  feature row can thus carry a progressive grant (Rogue's L1 row also grants +2 at L6). Pure. */
export function expertiseSlotsAtLevel(spec: string | undefined, classLevel: number): number {
	if (!spec) return 0;
	let total = 0;
	for (const pair of spec.split(',')) {
		const [lvl, count] = pair.split(':');
		const atLevel = Number(lvl);
		const n = Number(count);
		if (Number.isFinite(atLevel) && Number.isFinite(n) && atLevel <= classLevel) total += n;
	}
	return total;
}

/** N4a: how many skill-expertise choices the drafted character has unlocked — the sum of each class's
 *  active features' `expertise_slots` (a `level:count` spec resolved against that class's level, for
 *  the matching system and either a base feature or one under the chosen subclass). Mirrors the
 *  derive-gather feature gates. The builder caps expertise picks at this. Pure. */
export function expertiseBudget(
	classes: readonly { classId: string | null; subclassId: string | null; level: number }[],
	graph: ContentGraph,
	system: string
): number {
	let total = 0;
	const seen = new Set<string>(); // fold each (id, level, subclass) feature once across sources
	for (const entry of classes) {
		if (!entry.classId) continue;
		const classRow = graph.get(entry.classId);
		if (classRow?.type !== 'class') continue;
		for (const f of graph.featuresForClass(classRow)) {
			const spec = f.data.expertise_slots;
			if (!spec || Number(f.data.level) > entry.level) continue;
			if (!f.systems.includes(system)) continue;
			const forSubclass = f.data.subclass_id;
			if (forSubclass && forSubclass !== (entry.subclassId ?? '')) continue;
			const key = `${f.data.id}:${f.data.level}:${forSubclass ?? ''}`;
			if (seen.has(key)) continue;
			seen.add(key);
			total += expertiseSlotsAtLevel(spec, entry.level);
		}
	}
	return total;
}

/** Parse a species free-choice ASI spec ("1x2" = +1 to 2 abilities) → `{amount, count}`, or null. */
export function parseSpeciesBoostChoice(raw: string): { amount: number; count: number } | null {
	const m = /^(\d+)x(\d+)$/.exec(raw.trim());
	return m ? { amount: Number(m[1]), count: Number(m[2]) } : null;
}

/** Abilities raised by a species/sub-option's FIXED ASI (its flat_bonus effects) — excluded from the
 *  free choice (5e Half-Elf's +1/+1 goes to two abilities OTHER than the +2 CHA). */
export function speciesFixedAbilities(rows: (LoadedRow | undefined)[]): Set<Ability> {
	const set = new Set<Ability>();
	for (const src of rows) {
		const effects = src && 'effects' in src.data ? src.data.effects : undefined;
		const eff = Array.isArray(effects) ? effects : [];
		for (const t of eff) {
			// strip an L2 guard first — a conditionally-granted ASI still OCCUPIES the ability for
			// the free-choice exclusion (a raw guarded token would parse as `unknown` and slip by)
			const p = parseToken(splitGuard(t).token);
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
export interface SpellPickerInput {
	allSpells: LoadedRow[];
	sheet: CharacterSheet;
	graph: ContentGraph;
	strict: boolean;
	selectedSpells: string[];
}

export function buildSpellPicker({
	allSpells,
	sheet,
	graph,
	strict,
	selectedSpells
}: SpellPickerInput) {
	const levelOf = (s: LoadedRow) => (s.type === 'spell' ? Number(s.data.level ?? 0) : 0);
	const chosenLevel = (id: string) => {
		const r = graph.get(id);
		return r?.type === 'spell' ? Number(r.data.level ?? 0) : 0;
	};
	return sheet.spellcasting.classes.map((profile) => {
		const access = new Set(profile.accessSpellIds);
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
		// RV1: attribute each CHOSEN spell to ONE caster class via `casterForSpell` — the SAME rule the
		// play sheet uses for prepared tallies — so a dual-list spell counts against ONE class's cap
		// (identically at build + play time), not against every class whose list happens to include it.
		const chosenForThisClass = selectedSpells.filter(
			(id) => casterForSpell(sheet, id)?.classId === profile.classId
		);
		const cantripsChosen = chosenForThisClass.filter((id) => chosenLevel(id) === 0).length;
		const leveledChosen = chosenForThisClass.filter((id) => chosenLevel(id) > 0).length;
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
	if (d.method === 'point_buy' && deps.pointsLeft > 0)
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
