/*
 * The Combat/Spellbook spell block: build a spell row from content (with cantrip scaling), group
 * spells, and the per-class prepared-spell accounting (which caster a spell is cast as, its cap).
 * Pure. Split out of the old combat/helpers.ts junk-drawer.
 */
import { ordinal, titleCase } from '$lib/util/format';
import type { ContentGraph } from '$lib/content/loader';
import type { RowData } from '$lib/content/schemas';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { casterForSpell } from '$lib/character/spellcasting';
// re-exported so `$lib/combat/helpers` (barrel) + existing importers keep the same import site
export { casterForSpell };
import { parseDicePool } from '$lib/rules/dice';
import { parseDamageParts } from './attacks';
import {
	cantripDieMultiplier,
	canTogglePrepared,
	preparedLeveledCount,
	type PrepareAttempt,
	type PreparableSpell
} from '$lib/rules/spellcasting';

export const GROUP_MODES = ['level', 'prepared', 'school'] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

/** A spell row in the spell block. */
export interface SpellRow {
	id: string;
	/** The content ref (effectiveId) — used to set play.concentration when cast. */
	ref: string;
	name: string;
	/** Spell level (0 = cantrip). Drives which spell slot a cast spends (AUDIT A17). */
	level: number;
	/** Ritual-taggable — only these can be cast as a ritual (no slot). Not all spells qualify (SRD). */
	ritual: boolean;
	summary: string;
	resolution: '' | 'hit' | 'save' | 'auto';
	resolutionLabel: string;
	levelTag: string;
	castTimeIcon: '' | 'react' | 'bonus'; // casting time → icon before the level
	damagePool: Record<number, number> | null; // parsed damage/healing dice (for casting)
	damageType: string; // damage type from the `damage` column ("fire"); "" for typeless / healing
	/** Base flat modifier on the `damage` column (e.g. Magic Missile's "+1"): a spell's OWN flat that
	 *  isn't the caster mod, so upcast/effect flats fold onto it instead of losing it (N2). */
	damageFlat: number;
	/** The raw structured `upcast` cell (`kind[:type]:formula;…`), evaluated at cast time against the
	 *  ephemeral slot ctx — NOT here (the slot isn't known until cast). Empty when the spell doesn't
	 *  scale structurally (its `higher_level` prose is the fallback). See src/lib/effects/upcast.ts. */
	upcast: string;
	/** Whether casting this spell requires concentration. */
	concentration: boolean;
	prepState: '' | 'on' | 'always';
}

/** A group of spells (Pinned / by level / by prepared / by school). */
export interface SpellGroup {
	key: string;
	label: string;
	slots: { full: number; spent: number } | null;
	rows: SpellRow[];
}

/** Casting-time → the icon shown before the level (↩ reaction, ⚡ bonus). */
const castingIcon = (ct: string): SpellRow['castTimeIcon'] =>
	/bonus/i.test(ct) ? 'bonus' : /reaction/i.test(ct) ? 'react' : '';

/** Short effect summary for a non-damage spell (curated, falls back to "utility"). */
function effectHint(d: RowData<'spell'>): string {
	const name = d.name_en ?? '';
	if (/self/i.test(d.range ?? '') && /step|door|teleport/i.test(name)) return 'teleport';
	if (/counter/i.test(name)) return 'negate spell';
	if (/mage hand|prestidig|light|message|minor illusion|mage armor|fly|invis|mirror/i.test(name))
		return (
			{
				'mage hand': 'utility',
				'mage armor': 'set AC 13',
				fly: 'fly 60 ft',
				'mirror image': '3 duplicates'
			}[name.toLowerCase()] ?? 'utility'
		);
	return 'utility';
}

/** A caster class's prepared-spell accounting: how many leveled spells are prepared AGAINST it vs its
 *  own cap. */
export interface PreparedClassTally {
	classId: string;
	className: string;
	count: number;
	cap: number;
}

/** Per-class prepared tallies (A18-tail): attribute each prepared leveled spell to the caster class
 *  that grants it — via `casterForSpell`, the SAME access-map binding the builder's picker uses — and
 *  count within that class, so a multiclass caster's prepared limit is enforced PER class instead of
 *  all against `classes[0]`. Always-prepared/cantrip entries never count (they carry `prepared=false`
 *  or `alwaysPrepared`). One tally per caster profile, in profile order. */
export function preparedTalliesByClass(
	spells: readonly { spell: string; prepared: boolean; alwaysPrepared: boolean }[],
	sheet: CharacterSheet | null
): PreparedClassTally[] {
	const classes = sheet?.spellcasting.classes ?? [];
	const counts = new Map<string, number>();
	for (const s of spells) {
		if (!s.prepared || s.alwaysPrepared) continue;
		const cls = casterForSpell(sheet, s.spell);
		if (cls) counts.set(cls.classId, (counts.get(cls.classId) ?? 0) + 1);
	}
	return classes.map((c) => ({
		classId: c.classId,
		className: c.className,
		count: counts.get(c.classId) ?? 0,
		cap: c.preparedCap
	}));
}

/** The prepared-toggle attempt for ONE spell, gated against the cap of the class that GRANTS it
 *  (per-class — A18-tail). The single seam the combat sheet AND the spellbook call, so their
 *  attribution + cap + count wiring can't drift apart (D13): resolve the spell's class, read that
 *  class's tally (count vs cap), and defer the actual rule to `canTogglePrepared`. `entry` is the
 *  spell's play-state row (its prepared flags); a missing/always-prepared/cantrip entry is refused
 *  inside `canTogglePrepared`. Falls back to the primary class + total count for a spell no class
 *  claims (mirrors casterForSpell's own fallback). */
export interface PrepareToggleInput {
	spells: readonly { spell: string; prepared: boolean; alwaysPrepared: boolean }[];
	sheet: CharacterSheet | null;
	entry: PreparableSpell | undefined;
	spellRef: string;
	isCantrip: boolean;
}

export function canTogglePreparedFor({
	spells,
	sheet,
	entry,
	spellRef,
	isCantrip
}: PrepareToggleInput): PrepareAttempt {
	const cls = casterForSpell(sheet, spellRef);
	const tally = cls
		? preparedTalliesByClass(spells, sheet).find((t) => t.classId === cls.classId)
		: undefined;
	const cap = tally?.cap ?? sheet?.spellcasting.classes[0]?.preparedCap ?? 0;
	const count = tally?.count ?? preparedLeveledCount(spells);
	return canTogglePrepared(entry, isCantrip, cap, count);
}

/** A castable spell paired with its rendered row — the working unit of the grouping helpers. */
type SpEntry = { sp: Character['build']['spells'][number]; row: SpellRow };

/** Bucket by spell level (0 = cantrips), ascending; leveled groups carry their castable slot pool. */
function groupByLevel(
	all: SpEntry[],
	graph: ContentGraph,
	slotsByLevel: Map<number, number>,
	spellSlotsSpent: Record<string, number>
): SpellGroup[] {
	const byLevel = new Map<number, SpellRow[]>();
	for (const x of all) {
		const spell = graph.get(x.sp.spell);
		const lvl = spell?.type === 'spell' ? spell.data.level : 0;
		byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), x.row]);
	}
	return [...byLevel.keys()]
		.sort((a, b) => a - b)
		.map((lvl) => ({
			key: String(lvl),
			label: lvl === 0 ? 'Cantrips' : ordinal(lvl),
			slots:
				lvl === 0
					? null
					: { full: slotsByLevel.get(lvl) ?? 0, spent: spellSlotsSpent[String(lvl)] ?? 0 },
			rows: byLevel.get(lvl) ?? []
		}));
}

/** Split into Prepared / Not prepared. */
function groupByPrepared(all: SpEntry[]): SpellGroup[] {
	const groups: SpellGroup[] = [];
	const prep = all.filter((x) => x.row.prepState).map((x) => x.row);
	const rest = all.filter((x) => !x.row.prepState).map((x) => x.row);
	if (prep.length) groups.push({ key: 'prep', label: 'Prepared', slots: null, rows: prep });
	if (rest.length) groups.push({ key: 'unprep', label: 'Not prepared', slots: null, rows: rest });
	return groups;
}

/** Bucket by school (missing → "Other"), alphabetical. */
function groupBySchool(all: SpEntry[], graph: ContentGraph): SpellGroup[] {
	const bySchool = new Map<string, SpellRow[]>();
	for (const x of all) {
		const spell = graph.get(x.sp.spell);
		const sch = (spell?.type === 'spell' ? spell.data.school : '') || 'Other';
		bySchool.set(sch, [...(bySchool.get(sch) ?? []), x.row]);
	}
	return [...bySchool.keys()].sort().map((sch) => ({
		key: 'sch:' + sch,
		label: titleCase(sch),
		slots: null,
		rows: bySchool.get(sch) ?? []
	}));
}

/** Group the character's spells for the spell block (Pinned first, then by level / prepared / school),
 *  attaching the castable slot pool per level. Pure — the VM just wraps it in a `$derived`. */
export interface SpellGroupsInput {
	character: Character;
	sheet: CharacterSheet | null;
	graph: ContentGraph;
	groupBy: GroupMode;
	pinned: Record<string, boolean>;
	/** effectiveIds hidden from the sheet via the spellbook eye (Issue #3) — filtered out entirely. */
	hidden?: readonly string[];
}

export function buildSpellGroups({
	character,
	sheet,
	graph,
	groupBy,
	pinned,
	hidden = []
}: SpellGroupsInput): SpellGroup[] {
	const slotsByLevel = new Map<number, number>();
	for (const p of sheet?.spellcasting.pools ?? [])
		if (!p.forcedUpcast && p.spellLevel) slotsByLevel.set(p.spellLevel, p.max);
	const all: SpEntry[] = character.build.spells
		.map((sp) => ({
			sp,
			row: spellRow(
				graph,
				sp.spell,
				sp.alwaysPrepared ? 'always' : sp.prepared ? 'on' : '',
				sheet?.level ?? 1
			)
		}))
		.filter((x): x is SpEntry => !!x.row)
		.filter((x) => !hidden.includes(x.row.ref));
	const groups: SpellGroup[] = [];
	const pins = all.filter((x) => pinned[x.row.id]);
	if (pins.length)
		groups.push({ key: 'pinned', label: '★ Pinned', slots: null, rows: pins.map((x) => x.row) });

	if (groupBy === 'level')
		groups.push(...groupByLevel(all, graph, slotsByLevel, character.play.spellSlotsSpent));
	else if (groupBy === 'prepared') groups.push(...groupByPrepared(all));
	else groups.push(...groupBySchool(all, graph));
	return groups;
}

/** resolution → the combat spell-row chip ('' for utility). */
const SP_RES_CHIP: Record<string, SpellRow['resolution']> = {
	attack: 'hit',
	save: 'save',
	auto: 'auto'
};

/** resolution → the row's result label ('' for utility); a save shows its ability. */
function spResLabel(res: string, saveAbility: string): string {
	if (res === 'attack') return 'attack roll';
	if (res === 'save') return `${saveAbility} save`;
	if (res === 'auto') return 'auto';
	return '';
}

/** Casting dice for a spell: the STRUCTURED `damage` column (healing spells now carry their base dice
 *  there too — never scraped from prose); cantrips scale by `charLevel` (the 5/11/17 steps — A15). */
function castingDice(d: RowData<'spell'>, charLevel: number): string {
	const dmg = d.damage ?? '';
	const scale = d.level === 0 ? cantripDieMultiplier(charLevel) : 1;
	return scale > 1
		? dmg.replace(/(\d+)d(\d+)/gi, (_, n: string, s: string) => `${Number(n) * scale}d${s}`)
		: dmg;
}

/** Build a spell row from the content graph (or null if the ref is missing). `charLevel` scales
 *  cantrip damage dice (the 5/11/17 steps, both editions — AUDIT A15): Fire Bolt is 2d10 at
 *  character level 5, shown AND rolled that way. */
export function spellRow(
	graph: ContentGraph,
	ref: string,
	prep: SpellRow['prepState'],
	charLevel = 1
): SpellRow | null {
	const row = graph.get(ref);
	if (row?.type !== 'spell') return null;
	const d = row.data;
	const lvl = d.level;
	const res = d.resolution ?? 'none';
	const dmg = castingDice(d, charLevel);
	// the base `damage` column's first typed part gives BOTH the type and the spell's own flat (Magic
	// Missile's "+1"): the flat rides `damageFlat` so an upcast/effect flat folds onto it, not over it.
	const basePart = dmg ? parseDamageParts(dmg)[0] : undefined;
	return {
		id: d.id,
		ref,
		name: d.name_en,
		level: lvl,
		summary: dmg || effectHint(d),
		resolution: SP_RES_CHIP[res] ?? '',
		resolutionLabel: spResLabel(res, d.save_ability ?? ''),
		levelTag: lvl === 0 ? 'cantrip' : ordinal(lvl),
		castTimeIcon: castingIcon(d.casting_time ?? ''),
		damagePool: dmg ? parseDicePool(dmg) : null,
		damageType: basePart?.type ?? '',
		damageFlat: basePart?.mod ?? 0,
		upcast: d.upcast ?? '',
		concentration: d.concentration ?? false,
		ritual: d.ritual ?? false,
		prepState: prep
	};
}
