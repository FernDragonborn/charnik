/*
 * Weapon/unarmed attack rows for the Combat view: parse a damage string, fold a weapon's own magic
 * bonus, and build the attack list from equipped inventory. Pure. Split out of combat/helpers.ts.
 */
import { gatherProfGrants, isWeaponProficient } from '$lib/rules/proficiency';
import { weaponCategoryOf, ITEM_TAG, type ItemTags } from '$lib/content/item-tags';
import { resolveItem } from '$lib/content/resolved-item';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { parseDicePool, parseFlatModifier, formatDicePool } from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import { parseToken, EFFECT_KIND } from '$lib/effects/token-parser';
import { effectTag } from './effects-view';
import { localizedName } from '$lib/content/detail';

/** One typed slice of a weapon's damage: its dice pool, flat mod, and damage type. A plain weapon is
 *  one part ("1d8 slashing"); a multi-type weapon is several ("1d6 slashing" + "1d4 radiant"). */
export interface DamagePart {
	pool: Record<number, number>;
	mod: number;
	type: string;
}

/** The one id a bare-fisted attack answers to — it has no content row, and an action that says
 *  "make two Unarmed Strikes" has to be able to name it. */
export const UNARMED_STRIKE_ID = 'unarmed_strike';

/** A weapon/unarmed attack row. */
export interface Attack {
	/** The BARE content id of the weapon behind it (`UNARMED_STRIKE_ID` for fists) — what an action
	 *  token names when it fires this attack, so the match survives translation and re-sourcing.
	 *  `name` is what a person reads; it is not an identity. */
	id: string;
	/** The weapon row's name in the READER's language. Empty for the one attack that has no row —
	 *  see `nameKey`. */
	name: string;
	/** A catalog key naming this attack, for the one that is not a content row. Read through
	 *  `attackName`, which is the only place that has to know about the pair. */
	nameKey?: string;
	toHit: number;
	/** Human-readable damage (built from `damageParts`); shown in the panel. */
	dmg: string;
	/** The structured damage the roll path rolls — one entry per damage type, each rolled + shown
	 *  separately (BUG-DMG-1). The ability/magic mod is folded into the first (primary) part only. */
	damageParts: DamagePart[];
	meta: string;
	/** §A/§B the weapon's tag NAMES, which the roll path matches a scoped effect against — Archery
	 *  (attack:ranged) and GWF (min_die:damage:two_handed,melee) read these. */
	scopes: string[];
	/** D9 provenance — a magic weapon's own bonus folded into THIS attack ("+1 attack & damage"),
	 *  or a visible degrade note for a bonus v1 can't fold yet (dice / expression). */
	note?: string;
}

/** What to print for an attack. A weapon carries its row's localized name; the unarmed strike is not
 *  a content row, so it carries a key instead — and nothing outside here has to know which is which.
 *  Takes the translator rather than importing one, like `skillLabel`. */
export const attackName = (attack: Attack, t: (key: string) => string): string =>
	attack.nameKey ? t(attack.nameKey) : attack.name;

/** The trailing damage-type word(s) of a segment ("1d8 +3 slashing" → "slashing"), or "" if none. */
function segmentType(segment: string): string {
	return (/([a-z][a-z ]*?)\s*$/i.exec(segment.trim())?.[1] ?? '').trim();
}

/** Parse a weapon/spell damage string into its typed parts. Multiple types are `;`-separated
 *  ("1d6 slashing; 1d4 radiant"); a plain weapon is one part ("1d8 slashing"). Each part carries its
 *  own dice pool, flat mod, and type — dice and modifier read by the roller's own parsers, so a
 *  segment and a roll formula can never disagree about what "+2" means. Empty string → no parts. Pure. */
export function parseDamageParts(dmg: string): DamagePart[] {
	return dmg
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((seg) => ({
			pool: parseDicePool(seg),
			mod: parseFlatModifier(seg),
			type: segmentType(seg),
		}));
}

/** Render typed damage parts back to a display string ("1d8 +3 slashing", "1d6 slashing + 1d4
 *  radiant"). Inverse of `parseDamageParts` for the panel. Pure. */
export function formatDamageParts(parts: DamagePart[]): string {
	return parts
		.map((p) =>
			[formatDicePool(p.pool), p.mod ? signed(p.mod) : '', p.type].filter(Boolean).join(' '),
		)
		.join(' + ');
}

/** D9: fold a weapon's own `effects` tokens into a per-weapon attack/damage bonus. Only LITERAL
 *  `flat_bonus:attack` / `flat_bonus:damage` fold in v1; a dice / expression bonus becomes a visible
 *  note (it rides the roll path / needs a ctx — deferred, never silently dropped). Pure. */
export function weaponBonus(tokens: string[]): {
	attack: number;
	damage: number;
	/** D9-tail: typed extra damage a magic weapon adds as its OWN part(s) — a flaming sword's
	 *  `flat_bonus:damage:fire+1d6`. Rolled + shown separately, never given the ability mod. Omitted
	 *  (undefined) when there are none, so a plain weapon's return stays `{attack, damage}`. */
	extraParts?: DamagePart[];
	note?: string;
} {
	let attack = 0;
	let damage = 0;
	const extraParts: DamagePart[] = [];
	const deferred: string[] = [];
	for (const tok of tokens) {
		const p = parseToken(tok);
		if (p.kind !== EFFECT_KIND.flatBonus || (p.target !== 'attack' && p.target !== 'damage'))
			continue;
		// a TYPED damage bonus becomes its own part (the roll path + panel already render multi-type
		// damage); only an untyped dice/expression bonus still degrades to a note (nowhere to type it)
		if (p.target === 'damage' && p.damageType) {
			if (p.dice) extraParts.push({ pool: parseDicePool(p.dice), mod: 0, type: p.damageType });
			else if (p.amount !== undefined)
				extraParts.push({ pool: {}, mod: p.amount, type: p.damageType });
			else deferred.push(effectTag(tok)); // expression-valued typed bonus needs a ctx → note
			continue;
		}
		if (p.amount !== undefined) {
			if (p.target === 'attack') attack += p.amount;
			else damage += p.amount;
		} else deferred.push(effectTag(tok)); // untyped dice / expression → visible degrade
	}
	const parts: string[] = [];
	if (attack) parts.push(`${signed(attack)} attack`);
	if (damage) parts.push(`${signed(damage)} damage`);
	parts.push(...deferred);
	const note = parts.length ? parts.join(', ') : undefined;
	return {
		attack,
		damage,
		...(extraParts.length ? { extraParts } : {}),
		...(note ? { note } : {}),
	};
}

/** The sub-line under an attack row: what kind of weapon it is, then the first thing it can do
 *  ("martial melee · versatile 1d10"). The kind tags lead in a fixed order so two weapons of the
 *  same kind never read differently because their CSV cells were written in another order. */
function attackMeta(tags: ItemTags): string {
	const kindOrder: string[] = [ITEM_TAG.simple, ITEM_TAG.martial, ITEM_TAG.melee, ITEM_TAG.ranged];
	const kind = kindOrder.filter((t) => tags.has(t));
	const first = [...tags].find(([name]) => !kind.includes(name));
	return [kind.join(' '), first ? [first[0], first[1]].filter(Boolean).join(' ') : '']
		.filter(Boolean)
		.join(' · ');
}

/** §A: sum the character-level weapon-scoped `flat_bonus:attack:<category>` bonuses (Archery
 *  `attack:ranged+2`, later Dueling/GWF) that match a weapon in `scopes`. Only LITERAL `add` amounts
 *  fold (a scoped dice/expression bonus rides the roll path — none shipped). Returns bonus + a note. */
function scopedAttackBonus(
	facts: CharacterSheet['facts'],
	scopes: Set<string>,
): {
	attack: number;
	note?: string;
} {
	let attack = 0;
	const tags: string[] = [];
	for (const f of facts.numeric) {
		if (f.op !== 'add' || f.target !== 'attack' || !f.weaponScope) continue;
		if (!scopes.has(f.weaponScope) || f.amount === undefined) continue;
		attack += f.amount;
		tags.push(`${signed(f.amount)} attack (${f.source})`);
	}
	return { attack, ...(tags.length ? { note: tags.join(', ') } : {}) };
}

/** Equipped weapons (+ Unarmed Strike) as attack rows, with to-hit/damage from the sheet. Pure. */
export function computeAttacks(
	character: Character,
	sheet: CharacterSheet,
	graph: ContentGraph,
	locale = 'en',
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
		}),
	);
	const out: Attack[] = [];
	for (const inv of character.build.inventory) {
		if (!inv.equipped) continue;
		const row = graph.get(inv.item);
		if (row?.type !== 'item' || row.data.category !== 'weapon') continue;
		// a magic weapon carries only what it adds; the rest — category, properties, base damage —
		// comes from the mundane row its `base_item_id` names
		const item = resolveItem(graph, row);
		const ranged = item.tags.has(ITEM_TAG.ranged);
		// ranged is DEX, finesse is the better of the two, everything else is STR
		let mod = strMod;
		if (ranged) mod = dexMod;
		else if (item.tags.has(ITEM_TAG.finesse)) mod = Math.max(strMod, dexMod);
		const proficient = isWeaponProficient(weaponGrants, weaponCategoryOf(item.tags), row.id);
		// D9: a magic weapon's OWN effect tokens fold into THIS attack only (a +1 sword must not
		// grant +1 to every attack — so it can't ride gatherEffects/global facts). v1 folds LITERAL
		// flat_bonus:attack / flat_bonus:damage; a dice / expression bonus (a flaming +1d6) needs the
		// roll path or a ctx and degrades to a VISIBLE note, never a silent drop.
		const w = weaponBonus(row.data.effects);
		// §A: character-level weapon-category-scoped attack bonuses (Archery → ranged weapons) fold
		// into THIS weapon's to-hit only when it carries the matching category tag.
		// a tag NAME is an effect scope — one vocabulary, so `mastery:nick` scopes as `mastery`
		const scopeSet = new Set(item.tags.keys());
		const scoped = scopedAttackBonus(sheet.facts, scopeSet);
		const notProfNote = proficient ? undefined : 'Not proficient — no proficiency bonus';
		// A "Weapon (any melee weapon)" template names no base, so there is nothing to inherit: no
		// dice, no category, no scopes. Say so on the row — the alternative is an attack line that
		// looks complete and silently rolls a bare ability modifier.
		const templateNote =
			item.tags.size === 0 && !item.damage ? 'Base weapon not set — roll its own dice' : undefined;
		const note =
			[w.note, scoped.note, notProfNote, templateNote].filter(Boolean).join('; ') || undefined;
		// The ability mod + a magic weapon's flat damage bonus land on the PRIMARY (first) damage part
		// only — RAW adds the ability modifier once, to the weapon's base damage, never to a second
		// damage type's dice. A weapon with no damage string still gets a part to carry that mod.
		const parts = parseDamageParts(item.damage);
		const baseParts = (parts.length ? parts : [{ pool: {}, mod: 0, type: '' }]).map((p, i) =>
			i === 0 ? { ...p, mod: p.mod + mod + w.damage } : p,
		);
		// typed magic damage (flaming +1d6 fire) rides as extra part(s) after the weapon's own types
		const damageParts = [...baseParts, ...(w.extraParts ?? [])];
		out.push({
			id: row.id,
			// the same name the compendium and every other row on the sheet print
			name: localizedName(row, locale),
			toHit: mod + (proficient ? prof : 0) + w.attack + scoped.attack,
			dmg: formatDamageParts(damageParts),
			damageParts,
			meta: attackMeta(item.tags),
			scopes: [...scopeSet],
			...(note ? { note } : {}),
		});
	}
	// an unarmed strike is a melee attack, but carries no weapon properties. It reads the SAME
	// melee-scoped attack bonuses a weapon does — it is one of the attacks that scope names, and
	// leaving it out made a character's fists the one melee attack a melee bonus skipped. Its damage
	// is `1 + STR` by the book; effects (a Rage +2) fold in at the roll, as they do for every weapon.
	const unarmedScopes = new Set(['melee']);
	const unarmedScoped = scopedAttackBonus(sheet.facts, unarmedScopes);
	out.push({
		id: UNARMED_STRIKE_ID,
		name: '',
		nameKey: 'combat.attacks.unarmedStrike',
		toHit: strMod + prof + unarmedScoped.attack,
		scopes: [...unarmedScopes],
		dmg: `${1 + strMod} bludgeoning`,
		damageParts: [{ pool: {}, mod: 1 + strMod, type: 'bludgeoning' }],
		meta: 'melee',
		...(unarmedScoped.note ? { note: unarmedScoped.note } : {}),
	});
	return out;
}
