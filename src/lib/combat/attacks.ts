/*
 * Weapon/unarmed attack rows for the Combat view: parse a damage string, fold a weapon's own magic
 * bonus, and build the attack list from equipped inventory. Pure. Split out of combat/helpers.ts.
 */
import { gatherProfGrants, isWeaponProficient } from '$lib/rules/proficiency';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { parseDicePool } from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import { parseToken, EFFECT_KIND } from '$lib/effects/token-parser';
import { effectTag } from './effects-view';

/** A weapon/unarmed attack row. */
export interface Attack {
	name: string;
	toHit: number;
	dmg: string;
	meta: string;
	/** D9 provenance — a magic weapon's own bonus folded into THIS attack ("+1 attack & damage"),
	 *  or a visible degrade note for a bonus v1 can't fold yet (dice / expression). */
	note?: string;
}

/** Parse a weapon/spell damage string ("1d8 +3 slashing", "1d6 −1 bludgeoning") into its dice pool +
 *  flat mod. Handles the unicode minus `signed()` emits. Pure. */
export function parseDamage(dmg: string): { pool: Record<number, number>; mod: number } {
	const pool = parseDicePool(dmg);
	// A7: a die's count must not be read as a flat mod — in "2d6+10d4" the `+10` precedes `d4`, so match
	// a signed number only when NOT followed by (more digits then) `d` (a die is `<count>d<sides>`,
	// never spaced). `(?!\d*d)` — not just `(?!d)` — else the regex backtracks a multi-digit count
	// ("+10d4" → matches "+1"). Damage-type words never start with `d`, so a real "+3 slashing" parses.
	const m = /([+\-−])\s*(\d+)(?!\d*d)/i.exec(dmg);
	const mod = m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
	return { pool, mod };
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
		out.push({
			name: row.data.name_en,
			toHit: mod + (proficient ? prof : 0) + w.attack,
			dmg: `${row.data.damage ?? ''} ${signed(mod + w.damage)} ${row.data.damage_type ?? ''}`.trim(),
			meta: [row.data.item_type, props.split(/[,;]/)[0]].filter(Boolean).join(' · '),
			...(note ? { note } : {})
		});
	}
	out.push({
		name: 'Unarmed Strike',
		toHit: strMod + prof,
		dmg: `${1 + strMod} bludgeoning`,
		meta: 'melee'
	});
	return out;
}
