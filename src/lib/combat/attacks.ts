/*
 * Weapon/unarmed attack rows for the Combat view: parse a damage string, fold a weapon's own magic
 * bonus, and build the attack list from equipped inventory. Pure. Split out of combat/helpers.ts.
 */
import { gatherProfGrants, isWeaponProficient } from '$lib/rules/proficiency';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { parseDicePool, formatDicePool } from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import { parseToken, EFFECT_KIND } from '$lib/effects/token-parser';
import { effectTag } from './effects-view';

/** One typed slice of a weapon's damage: its dice pool, flat mod, and damage type. A plain weapon is
 *  one part ("1d8 slashing"); a multi-type weapon is several ("1d6 slashing" + "1d4 radiant"). */
export interface DamagePart {
	pool: Record<number, number>;
	mod: number;
	type: string;
}

/** A weapon/unarmed attack row. */
export interface Attack {
	name: string;
	toHit: number;
	/** Human-readable damage (built from `damageParts`); shown in the panel. */
	dmg: string;
	/** The structured damage the roll path rolls — one entry per damage type, each rolled + shown
	 *  separately (BUG-DMG-1). The ability/magic mod is folded into the first (primary) part only. */
	damageParts: DamagePart[];
	meta: string;
	/** D9 provenance — a magic weapon's own bonus folded into THIS attack ("+1 attack & damage"),
	 *  or a visible degrade note for a bonus v1 can't fold yet (dice / expression). */
	note?: string;
}

/** The flat mod inside a single damage segment ("1d8 +3 slashing" → +3). Handles the unicode minus
 *  `signed()` emits. A die's count must NOT read as a flat mod — in "2d6+10d4" the `+10` precedes
 *  `d4`, so match a signed number only when NOT followed by (more digits then) `d` (a die is
 *  `<count>d<sides>`, never spaced). `(?!\d*d)` — not just `(?!d)` — else the regex backtracks a
 *  multi-digit count ("+10d4" → "+1"). Type words never start with `d`, so "+3 slashing" parses. */
function segmentMod(segment: string): number {
	const m = /([+\-−])\s*(\d+)(?!\d*d)/i.exec(segment);
	return m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
}

/** The trailing damage-type word(s) of a segment ("1d8 +3 slashing" → "slashing"), or "" if none. */
function segmentType(segment: string): string {
	return (/([a-z][a-z ]*?)\s*$/i.exec(segment.trim())?.[1] ?? '').trim();
}

/** Parse a weapon/spell damage string into its typed parts. Multiple types are `;`-separated
 *  ("1d6 slashing; 1d4 radiant"); a plain weapon is one part ("1d8 slashing"). Each part carries its
 *  own dice pool, flat mod, and type. Empty string → no parts. Pure. */
export function parseDamageParts(dmg: string): DamagePart[] {
	return dmg
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((seg) => ({ pool: parseDicePool(seg), mod: segmentMod(seg), type: segmentType(seg) }));
}

/** Render typed damage parts back to a display string ("1d8 +3 slashing", "1d6 slashing + 1d4
 *  radiant"). Inverse of `parseDamageParts` for the panel. Pure. */
export function formatDamageParts(parts: DamagePart[]): string {
	return parts
		.map((p) =>
			[formatDicePool(p.pool), p.mod ? signed(p.mod) : '', p.type].filter(Boolean).join(' ')
		)
		.join(' + ');
}

/** D9: fold a weapon's own `effects` tokens into a per-weapon attack/damage bonus. Only LITERAL
 *  `flat_bonus:attack` / `flat_bonus:damage` fold in v1; a dice / expression bonus becomes a visible
 *  note (it rides the roll path / needs a ctx — deferred, never silently dropped). Pure. */
export function weaponBonus(tokens: string[]): { attack: number; damage: number; note?: string } {
	let attack = 0;
	let damage = 0;
	const deferred: string[] = [];
	for (const tok of tokens) {
		const p = parseToken(tok);
		if (p.kind !== EFFECT_KIND.flatBonus || (p.target !== 'attack' && p.target !== 'damage'))
			continue;
		if (p.amount !== undefined) {
			if (p.target === 'attack') attack += p.amount;
			else damage += p.amount;
		} else deferred.push(effectTag(tok)); // dice / expression → visible degrade
	}
	const parts: string[] = [];
	if (attack) parts.push(`${signed(attack)} attack`);
	if (damage) parts.push(`${signed(damage)} damage`);
	parts.push(...deferred);
	return parts.length ? { attack, damage, note: parts.join(', ') } : { attack, damage };
}

/** Equipped weapons (+ Unarmed Strike) as attack rows, with to-hit/damage from the sheet. Pure. */
export function computeAttacks(
	character: Character,
	sheet: CharacterSheet,
	graph: ContentGraph
): Attack[] {
	const prof = sheet.proficiencyBonus,
		strMod = sheet.abilities.str.mod,
		dexMod = sheet.abilities.dex.mod;
	// A7: weapon proficiency gate. A weapon you're not proficient with omits the proficiency bonus
	// from its to-hit (RAW). Grants come from the character's classes; lenient — a class (or set of
	// classes) that declares no weapon_profs stays proficient with everything.
	const weaponGrants = gatherProfGrants(
		character.build.classes.map((c) => {
			const r = graph.get(c.class);
			return r?.type === 'class' ? r.data.weapon_profs : undefined;
		})
	);
	const out: Attack[] = [];
	for (const inv of character.build.inventory) {
		if (!inv.equipped) continue;
		const row = graph.get(inv.item);
		if (row?.type !== 'item' || row.data.category !== 'weapon') continue;
		const props = (row.data.properties ?? '').toLowerCase();
		const ranged = (row.data.item_type ?? '').includes('ranged');
		const mod = ranged ? dexMod : props.includes('finesse') ? Math.max(strMod, dexMod) : strMod;
		const proficient = isWeaponProficient(weaponGrants, row.data.item_type, row.id);
		// D9: a magic weapon's OWN effect tokens fold into THIS attack only (a +1 sword must not
		// grant +1 to every attack — so it can't ride gatherEffects/global facts). v1 folds LITERAL
		// flat_bonus:attack / flat_bonus:damage; a dice / expression bonus (a flaming +1d6) needs the
		// roll path or a ctx and degrades to a VISIBLE note, never a silent drop.
		const w = weaponBonus(row.data.effects);
		const notProfNote = proficient ? undefined : 'Not proficient — no proficiency bonus';
		const note = [w.note, notProfNote].filter(Boolean).join('; ') || undefined;
		// The ability mod + a magic weapon's flat damage bonus land on the PRIMARY (first) damage part
		// only — RAW adds the ability modifier once, to the weapon's base damage, never to a second
		// damage type's dice. A weapon with no damage string still gets a part to carry that mod.
		const parts = parseDamageParts(row.data.damage ?? '');
		const damageParts = (parts.length ? parts : [{ pool: {}, mod: 0, type: '' }]).map((p, i) =>
			i === 0 ? { ...p, mod: p.mod + mod + w.damage } : p
		);
		out.push({
			name: row.data.name_en,
			toHit: mod + (proficient ? prof : 0) + w.attack,
			dmg: formatDamageParts(damageParts),
			damageParts,
			meta: [row.data.item_type, props.split(/[,;]/)[0]].filter(Boolean).join(' · '),
			...(note ? { note } : {})
		});
	}
	out.push({
		name: 'Unarmed Strike',
		toHit: strMod + prof,
		dmg: `${1 + strMod} bludgeoning`,
		damageParts: [{ pool: {}, mod: 1 + strMod, type: 'bludgeoning' }],
		meta: 'melee'
	});
	return out;
}
