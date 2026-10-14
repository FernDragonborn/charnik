/*
 * Weapon/unarmed attack rows for the Combat view: parse a damage string, fold a weapon's own magic
 * bonus, and build the attack list from equipped inventory. Pure. Split out of combat/helpers.ts.
 */
import type { Ability } from '$lib/rules/core';
import { matchesTarget } from '$lib/effects/facts';
import {
	gatherProfGrants,
	isWeaponProficient,
	withGrantedProfs,
	type ProfGrants,
} from '$lib/rules/proficiency';
import { itemTagLabel, weaponCategoryOf, ITEM_TAG, type ItemTags } from '$lib/content/item-tags';
import { needsBaseItem, resolveItem } from '$lib/content/resolved-item';
import { weaponPropertyRows, type WeaponPropertyRow } from '$lib/content/weapon-properties';
import {
	attackProperties,
	carriesProperty,
	masteryText,
	type AttackRollMode,
	type ExtraAttack,
	type WeaponMastery,
} from './attack-properties';
import { needsAttunement } from '$lib/character/inventory';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { grantedEquipmentProfs } from '$lib/character/granted-proficiency';
import { parseDicePool, parseFormula, formatDicePool } from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import {
	EFFECT_KIND,
	parseToken,
	isWeaponOwnBonus,
	resolveEffectValue,
} from '$lib/effects/token-parser';
import { NO_VARS, withItemBonus, type ExprContext } from '$lib/effects/context';
import { effectTag } from './effects-view';
import { localizedName } from '$lib/content/detail';
import { instanceName } from '$lib/content/item-instance';
import { formatNote, type Note } from '$lib/rules/pipeline';
import type { Translate } from '$lib/i18n';

/** One typed slice of a weapon's damage: its dice pool, flat mod, and damage type. A plain weapon is
 *  one part ("1d8 slashing"); a multi-type weapon is several ("1d6 slashing" + "1d4 radiant"). */
export interface DamagePart {
	pool: Record<number, number>;
	mod: number;
	type: string;
	/** Fragments of the segment that neither the pool nor the modifier accounted for — a content
	 *  defect, so it is carried to the sheet as a note rather than discovered at the roll. Omitted
	 *  when the segment reads cleanly, which is every shipped row. */
	issues?: string[];
}

/** The one id a bare-fisted attack answers to — it has no content row, and an action that says
 *  "make two Unarmed Strikes" has to be able to name it. */
export const UNARMED_STRIKE_ID = 'unarmed_strike';

/** Catalog keys for the notes an attack row carries — the ONE owner, so the producers below and the
 *  message catalogs never drift on a bare string (like `NOTE_KEY` for the engine's rule notes). */
const ATTACK_NOTE = {
	attackBonus: 'combat.attacks.noteAttackBonus',
	damageBonus: 'combat.attacks.noteDamageBonus',
	scopedAttack: 'combat.attacks.noteScopedAttack',
	scopedDamage: 'combat.attacks.noteScopedDamage',
	notProficient: 'combat.attacks.noteNotProficient',
	noBaseWeapon: 'combat.attacks.noteNoBaseWeapon',
	notAttuned: 'combat.attacks.noteNotAttuned',
	damageUnread: 'combat.attacks.noteDamageUnread',
	advantage: 'combat.attacks.noteAdvantage',
	disadvantage: 'combat.attacks.noteDisadvantage',
} as const;

/** One line of provenance under an attack row. A rule `Note` carries its catalog key beside the
 *  English it reads as, exactly like the engine's own notes do; a `{token}` is an effect this build
 *  could not fold, and becomes a tag only where the translator is. Built here, worded by
 *  `attackNotes` — the row is composed once per render, but it is composed with no locale, so the
 *  language it reads in is the one the panel is looking at rather than the one it was built in. */
export type AttackNote = Note | { token: string };

/** Say one attack note, without a translator saying its English. */
const attackNote = (key: string, text: string, params?: Record<string, string | number>): Note => ({
	text,
	key,
	...(params ? { params } : {}),
});

/** An attack row's notes as one line, in the reader's language. */
export function attackNotes(attack: Attack, translate?: Translate): string {
	return (attack.notes ?? [])
		.map((n) => ('token' in n ? effectTag(n.token, translate) : formatNote(n, translate)))
		.join('; ');
}

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
	/** The structured damage the roll path rolls — one entry per damage type, each rolled + shown
	 *  separately (BUG-DMG-1). The ability/magic mod is folded into the first (primary) part only. */
	damageParts: DamagePart[];
	/** The tags behind the row's kind line — worded by `attackMeta`, because what a tag is CALLED is a
	 *  catalog entry and this row is built with no locale. */
	meta: AttackMeta;
	/** §A/§B the weapon's tag NAMES, which the roll path matches a scoped effect against — Archery
	 *  (attack:ranged) and GWF (min_die:damage:two_handed,melee) read these. */
	scopes: string[];
	/** FINESSE-ABILITY — present only when the weapon HAS the choice, which is what the row renders a
	 *  STR/DEX control from: `ability` is what this attack resolved with, `kindId` is where an answer
	 *  is written. A weapon with no choice to make carries nothing, so the control cannot appear where
	 *  pressing it would mean nothing. */
	finesse?: { kindId: string; ability: Ability };
	/** The extra attacks this weapon's properties let the character make this turn — Light's with a
	 *  second Light weapon in hand, Cleave's on a hit. Each is offered BESIDE the row, never rolled
	 *  for the player. Omitted when there are none. */
	extras?: ExtraAttackRow[];
	/** How this weapon's own properties make its attacks roll (Heavy's disadvantage), which the roll
	 *  path adds to whatever the sheet's effects say. Each is on the row as a note. Omitted when
	 *  there are none. */
	rollModes?: AttackRollMode[];
	/** D9 provenance — a magic weapon's own bonus folded into THIS attack ("+1 attack & damage"),
	 *  or a visible degrade note for a bonus v1 can't fold yet (dice / expression). Read through
	 *  `attackNotes`. Omitted when the row has nothing to explain. */
	notes?: AttackNote[];
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
		.map((seg) => {
			const { dice, mod, bonusDice, issues } = parseFormula(seg);
			// a part carries a POOL, which has no sign to hold a subtracted term with — so a `-1d4` is
			// surfaced as what the segment could not express rather than rolled as `+1d4`
			const unread = [...issues, ...bonusDice.map((d) => `-${d.count}d${d.sides}`)];
			return {
				pool: dice,
				mod,
				type: segmentType(seg),
				...(unread.length ? { issues: unread } : {}),
			};
		});
}

/** What a damage type is CALLED. The type is an id (`bludgeoning`) and the catalog holds the word for
 *  it; a homebrew type nobody has translated falls back to the id, which is still what its author
 *  wrote. Takes the translator rather than reaching for one, so this module stays pure and
 *  node-testable (docs/internals/ui.md ▸ Strings live in the catalogs). */
export const damageTypeLabel = (type: string, translate: Translate): string =>
	type ? translate(`damageType.${type}`, { default: type }) : '';

/** A sense id → the reader's word for it. Open vocabulary like a damage type: the SRD names four
 *  and the catalog carries those; a pack's own sense falls back to the id it wrote. */
export const senseLabel = (sense: string, translate: Translate): string =>
	sense ? translate(`senseName.${sense}`, { default: sense }) : '';

/** Render typed damage parts back to a display string ("1d8 +3 slashing", "1d6 slashing + 1d4
 *  radiant"). Inverse of `parseDamageParts` for the panel. Pure.
 *
 *  Without a translator the TYPE ID is printed, which is the right answer for a caller that has no
 *  locale to spend — a node test, or a string that is about to be re-parsed. Every surface a person
 *  reads passes one. */
export function formatDamageParts(parts: DamagePart[], translate?: Translate): string {
	return parts
		.map((p) =>
			[
				formatDicePool(p.pool),
				p.mod ? signed(p.mod) : '',
				translate ? damageTypeLabel(p.type, translate) : p.type,
			]
				.filter(Boolean)
				.join(' '),
		)
		.join(' + ');
}

/** D9: fold a weapon's own `effects` tokens into a per-weapon attack/damage bonus. A LITERAL
 *  `flat_bonus:attack` / `flat_bonus:damage` folds; an EXPRESSION folds when `ctx` can resolve it —
 *  which is how a `+1/+2/+3` row's `item_bonus` becomes this weapon's number — and degrades to a
 *  visible note when it cannot. A dice bonus stays a note (it rides the roll path). Pure. */
export function weaponBonus(
	tokens: string[],
	ctx?: ExprContext,
): {
	attack: number;
	damage: number;
	/** D9-tail: typed extra damage a magic weapon adds as its OWN part(s) — a flaming sword's
	 *  `flat_bonus:damage:fire+1d6`. Rolled + shown separately, never given the ability mod. Omitted
	 *  (undefined) when there are none, so a plain weapon's return stays `{attack, damage}`. */
	extraParts?: DamagePart[];
	notes?: AttackNote[];
} {
	let attack = 0;
	let damage = 0;
	const extraParts: DamagePart[] = [];
	const deferred: AttackNote[] = [];
	for (const tok of tokens) {
		// the SAME predicate `gatherEffects` drops these by, so a token can never be both kept out of
		// the global facts and skipped here — which would lose it silently
		if (!isWeaponOwnBonus(tok)) continue;
		const p = parseToken(tok);
		// a TYPED damage bonus becomes its own part (the roll path + panel already render multi-type
		// damage); only an untyped dice/expression bonus still degrades to a note (nowhere to type it)
		if (p.target === 'damage' && p.damageType) {
			if (p.dice) extraParts.push({ pool: parseDicePool(p.dice), mod: 0, type: p.damageType });
			else if (p.amount !== undefined)
				extraParts.push({ pool: {}, mod: p.amount, type: p.damageType });
			else deferred.push({ token: tok }); // expression-valued typed bonus needs a ctx → note
			continue;
		}
		const amount = p.amount ?? (ctx && p.valueExpr ? resolveEffectValue(p, ctx).amount : undefined);
		if (amount !== undefined) {
			if (p.target === 'attack') attack += amount;
			else damage += amount;
		} else deferred.push({ token: tok }); // untyped dice / unresolvable expression → visible degrade
	}
	const notes: AttackNote[] = [];
	if (attack)
		notes.push(
			attackNote(ATTACK_NOTE.attackBonus, `${signed(attack)} attack`, { amount: signed(attack) }),
		);
	if (damage)
		notes.push(
			attackNote(ATTACK_NOTE.damageBonus, `${signed(damage)} damage`, { amount: signed(damage) }),
		);
	notes.push(...deferred);
	return {
		attack,
		damage,
		...(extraParts.length ? { extraParts } : {}),
		...(notes.length ? { notes } : {}),
	};
}

/** An extra attack as its row offers it: what it is, and what it rolls for damage. */
export type ExtraAttackRow = ExtraAttack & { damageParts: DamagePart[] };

/** The row's own damage with the ability modifier taken back off the PRIMARY part, where it was
 *  added — only a positive one, since RAW keeps a negative modifier on the extra attack. */
const extraAttackRow = (extra: ExtraAttack, parts: DamagePart[], mod: number): ExtraAttackRow => ({
	...extra,
	damageParts: parts.map((part, i) =>
		i === 0 && !extra.addsModifier ? { ...part, mod: part.mod - Math.max(0, mod) } : part,
	),
});

/** What an attack row's sub-line is made of: what kind of weapon it is, then the first thing it can
 *  do ("martial melee · versatile 1d10"). */
interface AttackMeta {
	/** The kind tags, in a fixed order, so two weapons of the same kind never read differently
	 *  because their CSV cells were written in another order. */
	kinds: string[];
	/** The weapon's first property, name and value (`['versatile', '1d10']`). */
	property?: [name: string, value: string];
	/** The rows that say what the weapon's plain properties do, for each one a pack describes — the
	 *  sub-line has room to print one property, and the surface explains them all. */
	propertyRows: WeaponPropertyRow[];
	/** The weapon's mastery property, set ONLY when this character has drilled this kind of
	 *  weapon — RAW the property does nothing until a feature unlocks it, so a row that printed it
	 *  unconditionally would be offering something the character cannot do (MASTERY-HALF). */
	mastery?: WeaponMastery;
}

/** The rows behind an attack's properties — the plain ones in the weapon's own order, then its
 *  mastery. */
export const attackPropertyRows = ({ meta }: Attack): WeaponPropertyRow[] =>
	[...meta.propertyRows, meta.mastery?.row].filter((row) => row !== undefined);

/** An attack row's sub-line, in the reader's language. A tag's NAME is a vocabulary and reads from
 *  the catalog; its VALUE is data (`versatile 1d10`, `thrown 20/60`) and passes through untranslated. */
export function attackMeta({ meta }: Attack, translate?: Translate): string {
	const property = meta.property;
	return [
		meta.kinds.map((t) => itemTagLabel(t, translate)).join(' '),
		// a property with no NAME is a bare value (a form attack's reach), printed as written
		property
			? [property[0] && itemTagLabel(property[0], translate), property[1]].filter(Boolean).join(' ')
			: '',
		// the mastery reads as its own NAME and not as `mastery: vex`: it is the thing the player
		// chose this weapon for, and the tag name adds nothing they do not already know
		meta.mastery ? masteryText(meta.mastery, translate) : '',
	]
		.filter(Boolean)
		.join(' · ');
}

/** The tags an attack row's sub-line reads, gathered off the weapon. `mastered` is whether THIS
 *  character may use the weapon's mastery property — the tag alone never means they can. */
function metaTags(
	tags: ItemTags,
	mastery: WeaponMastery | undefined,
	rows: ReadonlyMap<string, WeaponPropertyRow>,
): AttackMeta {
	const kindOrder: string[] = [ITEM_TAG.simple, ITEM_TAG.martial, ITEM_TAG.melee, ITEM_TAG.ranged];
	const kinds = kindOrder.filter((t) => tags.has(t));
	const properties = [...tags].filter(
		([name]) => !kinds.includes(name) && name !== ITEM_TAG.mastery,
	);
	const property = properties[0];
	return {
		kinds,
		...(property ? { property } : {}),
		propertyRows: properties.flatMap(([name]) => rows.get(name) ?? []),
		...(mastery ? { mastery } : {}),
	};
}

/**
 * §A: the flat character-level bonuses this weapon's `attack` (or `damage`) actually takes — the
 * scoped ones whose every scope part matches (Archery `attack:ranged+2`, a Rage `damage.melee,str+2`),
 * the unscoped ones, and the group targets that fan out to this key (2024 exhaustion's `d20_tests-2`).
 * Only LITERAL `add` amounts fold; dice and expression bonuses ride the roll path and are said as
 * notes, because a row cannot print a die.
 *
 * BOTH axes go through here so the row and the tap cannot disagree: the damage half used to fold
 * nowhere, so a raging barbarian's row printed a number two lower than the same row rolled.
 */
function scopedFlatBonus(
	facts: CharacterSheet['facts'],
	target: 'attack' | 'damage',
	scopes: Set<string>,
): {
	amount: number;
	notes: AttackNote[];
} {
	let amount = 0;
	const notes: AttackNote[] = [];
	const noteKey = target === 'attack' ? ATTACK_NOTE.scopedAttack : ATTACK_NOTE.scopedDamage;
	const word = target === 'attack' ? 'attack' : 'damage';
	for (const f of facts.numeric) {
		if (f.op !== 'add' || !matchesTarget(f.target, target) || f.amount === undefined) continue;
		// a scope is a LIST and every part must match (`melee,str`), the same sentence `roll.ts`
		// applies — this side used to compare the whole string, so a two-part scope matched a set
		// holding both its parts and neither of them together
		if (f.scope && !f.scope.split(',').every((part) => scopes.has(part))) continue;
		amount += f.amount;
		notes.push(
			attackNote(noteKey, `${signed(f.amount)} ${word} (${f.source})`, {
				amount: signed(f.amount),
				source: f.source,
			}),
		);
	}
	return { amount, notes };
}

/**
 * Which ability an attack resolves from, and its modifier: ranged is DEX, everything else is STR,
 * and a finesse weapon is the PLAYER's call — `chosen` is what they said, and with nothing said the
 * bigger modifier is the default, which is what they would pick almost every time.
 *
 * The ANSWER is also an effect scope, because RAW keys some bonuses off the ability rather than off
 * the weapon — Rage pays out on "an attack using Strength", so the same rapier is or is not eligible
 * depending on this call. That is exactly why the default cannot simply stand: at STR 14 / DEX 16 a
 * raging barbarian's rapier does MORE damage swung with the smaller modifier, and the app used to
 * take the bigger one silently and never say a choice existed.
 */
export function attackAbility(
	tags: ItemTags,
	strMod: number,
	dexMod: number,
	chosen?: Ability,
): { ability: Ability; mod: number } {
	if (tags.has(ITEM_TAG.ranged)) return { ability: 'dex', mod: dexMod };
	if (tags.has(ITEM_TAG.finesse)) {
		if (chosen === 'str') return { ability: 'str', mod: strMod };
		if (chosen === 'dex') return { ability: 'dex', mod: dexMod };
		return dexMod > strMod ? { ability: 'dex', mod: dexMod } : { ability: 'str', mod: strMod };
	}
	return { ability: 'str', mod: strMod };
}

/**
 * The Unarmed Strike row. A melee attack that carries no weapon properties, so it reads the SAME
 * melee-scoped bonuses a weapon does — it is one of the attacks a scope names, and leaving it out made
 * a character's fists the one melee attack a melee bonus skipped. Its damage is `1 + STR` by the book.
 * Always Strength, so it carries that scope like any weapon that resolved from it — which is what makes
 * 2024's "with either a weapon or an Unarmed Strike" fall out.
 */
function unarmedStrike(sheet: CharacterSheet, prof: number, strMod: number): Attack {
	const unarmedScopes = new Set(['melee', 'str', UNARMED_STRIKE_ID]);
	const unarmedScoped = scopedFlatBonus(sheet.facts, 'attack', unarmedScopes);
	const unarmedDamage = scopedFlatBonus(sheet.facts, 'damage', unarmedScopes);
	return {
		id: UNARMED_STRIKE_ID,
		name: '',
		nameKey: 'combat.attacks.unarmedStrike',
		toHit: strMod + prof + unarmedScoped.amount,
		scopes: [...unarmedScopes],
		damageParts: [{ pool: {}, mod: 1 + strMod + unarmedDamage.amount, type: 'bludgeoning' }],
		meta: { kinds: [ITEM_TAG.melee], propertyRows: [] },
		...(unarmedScoped.notes.length || unarmedDamage.notes.length
			? { notes: [...unarmedScoped.notes, ...unarmedDamage.notes] }
			: {}),
	};
}

/** Which weapons this character is proficient with: the classes' own `weapon_profs`, plus whatever a
 *  feature or item granted. Lenient — a class that declares none stays proficient with everything.
 *  Shared, because the attack row's proficiency gate and the weapon-mastery picker must agree about
 *  what "you have proficiency with" means. */
export function weaponProfGrants(
	classes: readonly { class: string }[],
	facts: CharacterSheet['facts'],
	graph: ContentGraph,
): ProfGrants {
	return withGrantedProfs(
		gatherProfGrants(
			classes.map((c) => {
				const r = graph.get(c.class);
				return r?.type === 'class' ? r.data.weapon_profs : undefined;
			}),
		),
		grantedEquipmentProfs(facts).weapons,
	);
}

/** What a weapon's own tokens add to its own attack — nothing until an attunement it requires is
 *  held. The one variable those tokens may read is which `+N` the player said this copy is. */
function ownWeaponBonus(
	effects: Parameters<typeof weaponBonus>[0],
	item: ReturnType<typeof resolveItem>,
	inv: Character['build']['inventory'][number],
): ReturnType<typeof weaponBonus> {
	if (needsAttunement(item) && !inv.attuned)
		return {
			attack: 0,
			damage: 0,
			notes: [attackNote(ATTACK_NOTE.notAttuned, 'Not attuned — its magic does nothing')],
		};
	return weaponBonus(
		effects,
		inv.bonus === undefined ? undefined : withItemBonus(NO_VARS, inv.bonus),
	);
}

/** A damage string the parse could not fully read is a CONTENT defect, and it must be visible on the
 *  sheet rather than at the moment the number comes out one short. */
function damageUnreadNote(parts: ReturnType<typeof parseDamageParts>) {
	const unread = parts.flatMap((p) => p.issues ?? []);
	if (!unread.length) return undefined;
	const fragments = unread.map((u) => `“${u}”`).join(', ');
	return attackNote(ATTACK_NOTE.damageUnread, `Damage not fully read — ${fragments} ignored`, {
		fragments,
	});
}

/** A property's roll mode as the row says it: which way, and which property. */
const rollModeNote = ({ mode, source }: AttackRollMode): Note =>
	mode === EFFECT_KIND.advantage
		? attackNote(ATTACK_NOTE.advantage, `Advantage (${source})`, { source })
		: attackNote(ATTACK_NOTE.disadvantage, `Disadvantage (${source})`, { source });

/** Every weapon in hand, resolved once — a magic weapon carries only what it adds, and the rest
 *  (category, properties, base damage) comes from the mundane row its `base_item_id` names — plus
 *  the one question a property asks across them: is a SECOND wielded weapon carrying it? Two of one
 *  kind are two weapons. */
function wieldedWeapons(character: Character, graph: ContentGraph) {
	const wielded = character.build.inventory.flatMap((inv) => {
		const row = inv.equipped ? graph.get(inv.item) : undefined;
		if (row?.type !== 'item' || row.data.category !== 'weapon') return [];
		return [{ inv, row, item: resolveItem(graph, row, inv.base) }];
	});
	const isPaired = (property: string, scope: string | undefined): boolean =>
		wielded.reduce(
			(count, w) => count + (carriesProperty(w.item.tags, property, scope) ? w.inv.qty : 0),
			0,
		) >= 2;
	return { wielded, isPaired };
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
	const weaponGrants = weaponProfGrants(character.build.classes, sheet.facts, graph);
	// the weapon kinds this character has drilled (MASTERY-HALF) — by the BASE row's id, because that
	// is the kind: a +1 Greataxe is still a Greataxe
	const masteries = new Set(character.build.masteries ?? []);
	const propertyRows = weaponPropertyRows(graph, character.system);
	const { wielded, isPaired } = wieldedWeapons(character, graph);
	const out: Attack[] = [];
	for (const { inv, row, item } of wielded) {
		// the kind, not the row: a +1 Rapier is a Rapier, so one answer covers every copy of it
		const finesse = item.tags.has(ITEM_TAG.finesse);
		const { ability, mod } = attackAbility(
			item.tags,
			strMod,
			dexMod,
			finesse ? character.build.finesseAbility[item.kindId] : undefined,
		);
		const proficient = isWeaponProficient(weaponGrants, weaponCategoryOf(item.tags), row.id);
		// D9: a magic weapon's OWN effect tokens fold into THIS attack only (a +1 sword must not
		// grant +1 to every attack — so it can't ride gatherEffects/global facts). v1 folds LITERAL
		// flat_bonus:attack / flat_bonus:damage; a dice / expression bonus (a flaming +1d6) needs the
		// roll path or a ctx and degrades to a VISIBLE note, never a silent drop.
		// RAW, both editions: a magic item that REQUIRES attunement confers nothing until it is attuned.
		// The weapon's own bonus never reaches the global facts (D9 keeps it on this row), so the gate
		// the gather applies to every other item has to be applied here too — and SAID, because an
		// inactive +1 is indistinguishable from a weapon that never had one.
		const w = ownWeaponBonus(row.data.effects, item, inv);
		// §A: character-level weapon-category-scoped attack bonuses (Archery → ranged weapons) fold
		// into THIS weapon's to-hit only when it carries the matching category tag.
		// a tag NAME is an effect scope — one vocabulary, so `mastery:nick` scopes as `mastery`
		// …and so is the weapon's own id, which is what lets a bonus name ONE weapon
		// (`flat_bonus:damage.longsword+1`) rather than a whole category.
		// …and so is the ABILITY this attack resolved from, because RAW keys some bonuses off it
		// rather than off the weapon: Rage pays out on "an attack using Strength", so a rapier swung
		// with Dexterity must not take it while the same rapier swung with Strength does.
		const scopeSet = new Set([...item.tags.keys(), row.id, ability]);
		const scoped = scopedFlatBonus(sheet.facts, 'attack', scopeSet);
		const scopedDamage = scopedFlatBonus(sheet.facts, 'damage', scopeSet);
		const notProfNote = proficient
			? undefined
			: attackNote(ATTACK_NOTE.notProficient, 'Not proficient — no proficiency bonus');
		// A "Weapon (any melee weapon)" template names no base, so until the player says which weapon it
		// is there is nothing to inherit: no dice, no category, no scopes. Say so on the row — the
		// alternative is an attack line that looks complete and silently rolls a bare ability modifier.
		const templateNote = needsBaseItem(item)
			? attackNote(ATTACK_NOTE.noBaseWeapon, 'Base weapon not set — roll its own dice')
			: undefined;
		// The ability mod + a magic weapon's flat damage bonus land on the PRIMARY (first) damage part
		// only — RAW adds the ability modifier once, to the weapon's base damage, never to a second
		// damage type's dice. A weapon with no damage string still gets a part to carry that mod.
		const parts = parseDamageParts(item.damage);
		const damageNote = damageUnreadNote(parts);
		const properties = attackProperties({
			rows: propertyRows,
			tags: item.tags,
			mastered: masteries.has(item.kindId),
			mod,
			rules: sheet.facts.extraAttackRules,
			isPaired,
			ctx: sheet.castCtx ?? NO_VARS,
			locale,
		});
		// a property's roll mode is an effect like any other, so the effects switch turns it off too
		const rollModes = character.play.autoCalc ? properties.modes : [];
		const notes = [
			...(w.notes ?? []),
			...rollModes.map(rollModeNote),
			...properties.unread.map((token) => ({ token })),
			...scoped.notes,
			...scopedDamage.notes,
			notProfNote,
			templateNote,
			damageNote,
		].filter((n) => n !== undefined);
		// the character-level damage bonuses land on the PRIMARY part, where RAW puts them and where the
		// roll path puts them too — the row and the tap now read the same number
		const baseParts = (parts.length ? parts : [{ pool: {}, mod: 0, type: '' }]).map((p, i) =>
			i === 0 ? { ...p, mod: p.mod + mod + w.damage + scopedDamage.amount } : p,
		);
		// typed magic damage (flaming +1d6 fire) rides as extra part(s) after the weapon's own types
		const damageParts = [...baseParts, ...(w.extraParts ?? [])];
		out.push({
			id: row.id,
			// the same name the compendium, the inventory and every other row on the sheet print — the
			// instance's ("Longsword +2") for a +N weapon, never the book's heading
			name: instanceName({ graph, locale }, row, inv) ?? localizedName(row, locale),
			toHit: mod + (proficient ? prof : 0) + w.attack + scoped.amount,
			damageParts,
			meta: metaTags(item.tags, properties.mastery, propertyRows),
			scopes: [...scopeSet],
			...(finesse ? { finesse: { kindId: item.kindId, ability } } : {}),
			...(properties.extras.length
				? { extras: properties.extras.map((extra) => extraAttackRow(extra, damageParts, mod)) }
				: {}),
			...(rollModes.length ? { rollModes } : {}),
			...(notes.length ? { notes } : {}),
		});
	}
	out.push(unarmedStrike(sheet, prof, strMod));
	return out;
}
