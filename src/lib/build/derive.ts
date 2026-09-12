/*
 * Pure, content-graph-aware build computations — the option/derivation logic the Build VM wraps in
 * `$derived`. Kept out of build/rules.ts (which stays "just numbers, no graph") and out of the VM
 * (which keeps only reactive wiring), so these are plain, unit-testable functions. No Svelte runes.
 */
import type { Ability } from '../rules/core';
import { ABILITIES } from '../character/schema';
import type { ContentGraph, LoadedRow, LoadedRowByType } from '../content/loader';
import type { CharacterSheet } from '../character/derive';
import { casterForSpell } from '../character/spellcasting';
import { parseToken, splitGuard, EFFECT_KIND } from '../effects/token-parser';
import type { StatMethod } from './rules';
import { activeClassFeatures } from '../character/features';

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
	classes: readonly DraftClassEntry[],
	graph: ContentGraph,
	system: string
): number {
	let total = 0;
	for (const feature of activeClassFeatures(classes, graph, system)) {
		const spec = feature.row.data.expertise_slots;
		if (spec) total += expertiseSlotsAtLevel(spec, feature.entry.level);
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
		// no label: a group is identified by its LEVEL, and the words for it live in the UI catalog
		const groups = [...byLevel.keys()]
			.sort((a, b) => a - b)
			.map((lvl) => ({ level: lvl, spells: byLevel.get(lvl) ?? [] }));
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

/** A class row as the draft holds it, pre-resolution (ids nullable while the user is still choosing).
 *  Named once because four helpers here take the same shape. */
export interface DraftClassEntry {
	classId: string | null;
	subclassId: string | null;
	level: number;
}

/**
 * Class rows that have reached the level their subclass was due at without choosing one. A character
 * built straight to level 8 owes this exactly as much as one levelled up to it, which is why it is
 * computed from the level rather than watched for during a level-up. Pure.
 *
 * `hasOptions` is asked as well as the level, because a class whose `subclass_level` is set while no
 * subclass row is loaded — the source is disabled, or the pack ships none — is a CONTENT problem, not
 * something the player can fix. Left ungated, the review bar says "choose a subclass" and the click
 * opens an empty pane. Charnik does not invent a default subclass to fill it: authoring game data is
 * the one thing it must never do.
 */
export function openSubclassChoices(
	classes: readonly DraftClassEntry[],
	graph: ContentGraph,
	nameOf: (row: LoadedRow) => string,
	hasOptions: (classId: string) => boolean
): { index: number; className: string; level: number }[] {
	return classes.flatMap((entry, index) => {
		if (!entry.classId || entry.subclassId) return [];
		const row = graph.get(entry.classId);
		if (row?.type !== 'class') return [];
		const due = Number(row.data.subclass_level ?? 0);
		if (!due || entry.level < due || !hasOptions(entry.classId)) return [];
		return [{ index, className: nameOf(row), level: due }];
	});
}

/** One class feature as the sheet lists it: which level handed it over, from which class, and
 *  whether the character has actually reached it yet. */
export interface ClassFeatureLine {
	level: number;
	className: string;
	row: LoadedRowByType<'class_feature'>;
	/** False for the look-ahead rows — what the next level or two will bring. */
	gained: boolean;
	/** Came from the chosen subclass rather than the class itself. */
	fromSubclass: boolean;
}

/**
 * Every class feature the drafted classes grant, gained ones first, then a short look-ahead.
 *
 * Mirrors the derive's feature gates exactly (level ≤, matching edition, base features always,
 * subclass features only for the chosen subclass) so the sheet can never list a feature the engine
 * did not apply. Deduped by (id, level, subclass) across sources, like the derive does. Pure.
 *
 * `lookaheadLevels` is why this is worth showing at all: a character built straight to level 5 wants
 * to see that level 6 is where the aura arrives.
 */
export interface ClassFeatureInput {
	classes: readonly DraftClassEntry[];
	graph: ContentGraph;
	system: string;
	nameOf: (row: LoadedRow) => string;
	/** How far past the current level to preview. */
	lookaheadLevels?: number;
}

export function classFeatureLines({
	classes,
	graph,
	system,
	nameOf,
	lookaheadLevels = 3
}: ClassFeatureInput): ClassFeatureLine[] {
	const out = [...activeClassFeatures(classes, graph, system, { extraLevels: lookaheadLevels })].map(
		(f) => ({
			level: f.level,
			className: nameOf(f.classRow),
			row: f.row,
			gained: f.gained,
			fromSubclass: f.fromSubclass
		})
	);
	return out.sort((a, b) => a.level - b.level || a.className.localeCompare(b.className));
}

/** What part of the sheet a todo is about — the caller maps this to the control that fixes it, so
 *  every line in the "still to do" bar is a link straight to the thing it names. */
type TodoKind =
	| 'name'
	| 'species'
	| 'speciesOption'
	| 'background'
	| 'class'
	| 'subclass'
	| 'abilities'
	| 'skills'
	| 'spells'
	| 'feat'
	| 'originFeat';

export interface BuildTodo {
	kind: TodoKind;
	/** i18n key under `build.todo` — a catalog key, never a sentence: this module is pure and has no
	 *  locale, and the same todo has to read correctly in every language the user installs. */
	key: string;
	/** ICU values the key interpolates. */
	values?: Record<string, string | number>;
	/** Required todos block creation and warn on leaving; optional ones are a nudge. */
	required: boolean;
	/** Which class row / feat slot the todo belongs to, when the kind has several instances. */
	index?: number;
	slotKey?: string;
	level?: number;
}

/** An empty field is required in BOTH modes — Strict vs Free decides whether a CAP is enforced, not
 *  whether a choice was made. Over-cap ("remove one") is therefore the only Strict-gated line here. */
export interface BuildTodoInput {
	name: string;
	method: StatMethod;
	strict: boolean;
	hasSpecies: boolean;
	/** The species offers subraces/lineages and none is picked yet. */
	needsSpeciesOption: boolean;
	hasBackground: boolean;
	hasClass: boolean;
	/** Class rows whose subclass is due at their level and still unchosen. */
	openSubclasses: { index: number; className: string; level: number }[];
	pointsLeft: number;
	classSkillCount: number;
	skillChosenCount: number;
	/** Feat/ASI slots the character has reached and not yet filled. */
	openFeatSlots: { key: string; level: number; className: string }[];
	/** The background's granted origin feat and how many choices it still asks for. A grant nobody is
	 *  told about is a grant thrown away — Skilled hands out three skills or none. */
	originFeat: { name: string; owed: number };
	spellPicker: ReturnType<typeof buildSpellPicker>;
}

/** The four spell todos a caster class can owe, as (condition, key) pairs — written once so the
 *  under-cap and over-cap halves can't drift apart.
 *
 *  An under-cap line is only REQUIRED when the picker it links to has something in it. A pack whose
 *  spells claim no class (`srd-2014` ships exactly that) leaves the Strict pool empty at every level,
 *  and a required todo then blocks creation on a choice the player cannot make — the same reason
 *  `openSubclassChoices` asks `hasOptions`. It stays on the list as a nudge, so the content problem is
 *  visible rather than swallowed. */
function spellTodos(d: BuildTodoInput): BuildTodo[] {
	const out: BuildTodo[] = [];
	const named = d.spellPicker.length > 1; // multiclass: say WHICH class owes the pick
	for (const pc of d.spellPicker) {
		const values = { class: pc.profile.className };
		const canPick = (cantrips: boolean) =>
			pc.groups.some((g) => cantrips === (g.level === 0) && g.spells.length > 0);
		const short: [number, string, string, boolean][] = [
			[pc.profile.cantripCap - pc.cantripsChosen, 'cantrips', 'cantripsOver', canPick(true)],
			[pc.profile.preparedCap - pc.leveledChosen, 'spells', 'spellsOver', canPick(false)],
		];
		for (const [delta, underKey, overKey, pickable] of short) {
			if (delta > 0)
				out.push({
					kind: 'spells',
					key: named ? `${underKey}For` : underKey,
					values: { count: delta, ...values },
					required: pickable,
				});
			// over-cap is a RULE, not an empty field — only Strict cares
			else if (delta < 0 && d.strict)
				out.push({ kind: 'spells', key: overKey, values: { count: -delta }, required: true });
		}
	}
	return out;
}

/**
 * Everything still unfinished about a draft, in the order a player would fix it. Pure and
 * locale-free — each line is a catalog key plus its values, translated where it is rendered.
 *
 * A character is not necessarily built at level 1: every slot the chosen levels opened (subclass,
 * each ASI/feat level) is its own line, so levelling straight to 8 cannot silently skip three
 * choices.
 */
export function buildTodos(d: BuildTodoInput): BuildTodo[] {
	const out: BuildTodo[] = [];
	const need = (ok: boolean, kind: TodoKind) => {
		if (!ok) out.push({ kind, key: kind, required: true });
	};

	need(!!d.name.trim(), 'name');
	need(d.hasSpecies, 'species');
	need(!d.needsSpeciesOption, 'speciesOption');
	need(d.hasClass, 'class');
	need(d.hasBackground, 'background');

	for (const s of d.openSubclasses)
		out.push({
			kind: 'subclass',
			key: 'subclass',
			values: { class: s.className, level: s.level },
			index: s.index,
			level: s.level,
			required: true,
		});
	if (d.method === 'point_buy' && d.pointsLeft > 0)
		out.push({
			kind: 'abilities',
			key: 'abilityPoints',
			values: { count: d.pointsLeft },
			required: true,
		});
	const needSkills = d.classSkillCount - d.skillChosenCount;
	if (needSkills > 0)
		out.push({ kind: 'skills', key: 'skills', values: { count: needSkills }, required: true });
	for (const slot of d.openFeatSlots)
		out.push({
			kind: 'feat',
			key: slot.className ? 'featIn' : 'feat',
			values: { level: slot.level, class: slot.className },
			slotKey: slot.key,
			level: slot.level,
			required: true,
		});
	if (d.originFeat.owed > 0)
		out.push({
			kind: 'originFeat',
			key: 'originFeat',
			values: { feat: d.originFeat.name, count: d.originFeat.owed },
			required: true,
		});
	out.push(...spellTodos(d));
	return out;
}
