import { describe, it, expect } from 'vitest';

/*
 * FINESSE-ABILITY. The choice RAW gives the player every swing, and the reason it is not just a
 * bigger number: the ability an attack resolves from is an effect SCOPE, so a rapier swung with
 * Strength takes Rage's damage and the same rapier swung with Dexterity does not — which is exactly
 * when the auto-pick was wrong, and silently.
 */
import { attackAbility } from './attacks';
import { parseItemTags } from '$lib/content/item-tags';

const tags = (s: string) => parseItemTags(s);
const RAPIER = tags('martial, melee, finesse');
const GREATAXE = tags('martial, melee, heavy, two_handed');
const LONGBOW = tags('martial, ranged, finesse'); // finesse AND ranged: ranged wins, RAW

describe('with nothing chosen, the bigger modifier', () => {
	it('takes DEX when DEX is bigger', () => {
		expect(attackAbility(RAPIER, 2, 3)).toEqual({ ability: 'dex', mod: 3 });
	});
	it('takes STR when STR is bigger', () => {
		expect(attackAbility(RAPIER, 3, 2)).toEqual({ ability: 'str', mod: 3 });
	});
	it('breaks a tie towards STR, which is what a non-finesse weapon would have used', () => {
		expect(attackAbility(RAPIER, 3, 3)).toEqual({ ability: 'str', mod: 3 });
	});
});

describe('the player has said which', () => {
	it('takes the SMALLER modifier when they asked for it — the Rage case', () => {
		// STR 14 / DEX 16: the auto-pick is +3 DEX, but rage pays out on a Strength attack, so +2 STR
		// plus rage damage is more on the same swing. The number alone cannot know that.
		expect(attackAbility(RAPIER, 2, 3, 'str')).toEqual({ ability: 'str', mod: 2 });
	});
	it('takes DEX on a weapon whose STR is better', () => {
		expect(attackAbility(RAPIER, 3, 1, 'dex')).toEqual({ ability: 'dex', mod: 1 });
	});
});

describe('a weapon with no choice to make ignores one', () => {
	it('a non-finesse melee weapon is Strength, whatever was asked for', () => {
		expect(attackAbility(GREATAXE, 1, 5, 'dex')).toEqual({ ability: 'str', mod: 1 });
		expect(attackAbility(GREATAXE, 1, 5)).toEqual({ ability: 'str', mod: 1 });
	});
	it('a ranged weapon is Dexterity, and ranged outranks finesse', () => {
		expect(attackAbility(LONGBOW, 5, 1, 'str')).toEqual({ ability: 'dex', mod: 1 });
	});
});
