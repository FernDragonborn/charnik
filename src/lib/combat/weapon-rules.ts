/*
 * What a feature lets an attack do (`weapon_rule`) — Martial Arts' Dexterity and its die. A rule
 * holds for an attack its scope names, and only while EVERY weapon wielded is one that some token of
 * the same word names: RAW's "while you are unarmed or wielding only Monk weapons". The armour and
 * shield half of that sentence is the token's own guard.
 */
import { WEAPON_RULE_WORD, scopeMatches, type WeaponRuleWord } from '$lib/effects/token-parser';
import type { EffectFacts } from '$lib/effects/facts';
import { parseDiceTerm } from '$lib/rules/dice';
import { ITEM_TAG, type ItemTags } from '$lib/content/item-tags';
import type { Ability } from '$lib/rules/core';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

type Scopes = ReadonlySet<string>;

export interface AttackRules {
	/** The attack may resolve from Dexterity, the player's call as a finesse weapon's is. */
	dex: boolean;
	/** The die it may roll in place of its own damage die, by sides. */
	dieSides?: number;
}

export function weaponRulesFor(
	facts: EffectFacts,
	attack: Scopes,
	wielded: readonly Scopes[],
): AttackRules {
	const rules = (word: WeaponRuleWord) => facts.weaponRules.filter((r) => r.word === word);
	const covers = (word: WeaponRuleWord, scopes: Scopes) =>
		rules(word).some((r) => scopeMatches(r.scope, scopes));
	const holds = (word: WeaponRuleWord) =>
		covers(word, attack) && wielded.every((weapon) => covers(word, weapon));

	const dieRule = holds(WEAPON_RULE_WORD.die)
		? rules(WEAPON_RULE_WORD.die).find((r) => scopeMatches(r.scope, attack))
		: undefined;
	const formula = facts.rolls.find((roll) => roll.id === dieRule?.value)?.formula;
	const die = formula ? parseDiceTerm(formula) : null;
	return { dex: holds(WEAPON_RULE_WORD.dex), ...(die ? { dieSides: die.sides } : {}) };
}

/** A weapon's tags as it swings under a `dex` rule: as a finesse weapon does, so the one
 *  STR/DEX choice the sheet already offers is offered here too. */
export const swingTags = (tags: ItemTags, rules: AttackRules): ItemTags =>
	rules.dex && !tags.has(ITEM_TAG.finesse) ? new Map([...tags, [ITEM_TAG.finesse, '']]) : tags;

/** One die of `sides` in place of the pool, where it is the bigger — "You can roll 1d6 in place of
 *  the normal damage", which no player declines for a smaller one. */
export function withRuleDie(
	pool: Record<number, number>,
	rules: AttackRules,
): Record<number, number> {
	if (!rules.dieSides) return pool;
	const average = Object.entries(pool).reduce(
		(sum, [sides, count]) => sum + (count * (Number(sides) + 1)) / 2,
		0,
	);
	return (rules.dieSides + 1) / 2 > average ? { [rules.dieSides]: 1 } : pool;
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

/** How a weapon — or the fists — swings: its ability, and what a feature lets it do (Martial Arts'
 *  Dexterity and die). `finesse` is whether the player has a STR/DEX choice to make here. */
export function swingOf(
	character: Character,
	sheet: CharacterSheet,
	weapon: { item: { tags: ItemTags; kindId: string }; scopes: Scopes },
	wielded: readonly Scopes[],
) {
	const rules = weaponRulesFor(sheet.facts, weapon.scopes, wielded);
	const tags = swingTags(weapon.item.tags, rules);
	const finesse = tags.has(ITEM_TAG.finesse);
	// the kind, not the row: a +1 Rapier is a Rapier, so one answer covers every copy of it
	const chosen = finesse ? character.build.finesseAbility[weapon.item.kindId] : undefined;
	const { str, dex } = sheet.abilities;
	return { ...attackAbility(tags, str.mod, dex.mod, chosen), rules, finesse };
}
