/*
 * A demo character that references REAL shipped content (SRD 5.2.1), so the Combat screen
 * exercises the full pipeline against the actual content graph (getContentGraph()). Runtime
 * effects (Bless, Shield of Faith) are play-state, so they layer regardless of content.
 * Replaced by real character load/create once the roster + Build view land.
 */
import { characterSchema, newCharacter, type Character } from '../character/schema';

const S = 'SRD 5.2.1';

export function demoCharacter(): Character {
	const c = newCharacter('valen', 'Valen the Blue', '5.5e');
	c.build.species = `species:${S}:elf`;
	c.build.classes = [{ class: `class:${S}:wizard`, level: 3 }];
	c.build.abilities = { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 };
	c.build.skills = ['arcana', 'history', 'investigation', 'perception', 'stealth'];
	c.build.inventory = [
		{ item: `item:${S}:leather-armor`, qty: 1, equipped: true, attuned: false },
		{ item: `item:${S}:quarterstaff`, qty: 1, equipped: true, attuned: false },
		{ item: `item:${S}:dagger`, qty: 2, equipped: true, attuned: false }
	];
	const spell = (id: string, prepared = true, alwaysPrepared = false) => ({
		spell: `spell:${S}:${id}`,
		prepared,
		alwaysPrepared
	});
	c.build.spells = [
		spell('fire-bolt', false, true),
		spell('mage-hand', false, true),
		spell('ray-of-frost', false, true),
		spell('magic-missile'),
		spell('shield'),
		spell('scorching-ray'),
		spell('misty-step'),
		spell('fireball'),
		spell('counterspell'),
		spell('fly'),
		spell('healing-word') // resolution "auto" → demonstrates the teal auto pill
	];
	c.play.hp = { current: 14, max: undefined, temp: 5 };
	c.play.spellSlotsSpent = { '1': 1, '2': 0, '3': 1 };
	c.play.effects = [
		{
			iid: 'shield-of-faith',
			label: 'Shield of Faith',
			effects: ['flat-bonus:ac+2'],
			positive: true,
			durationRounds: 100,
			startedRound: 0
		},
		{
			iid: 'bless',
			label: 'Bless',
			effects: ['flat-bonus:saves+1d4'],
			positive: true,
			durationRounds: 10,
			startedRound: 0
		},
		{
			iid: 'bane',
			label: 'Bane',
			effects: ['flat-bonus:saves-1d4'],
			positive: false,
			durationRounds: 10,
			startedRound: 0
		},
		{
			iid: 'arcane-recovery',
			label: 'Arcane Recovery',
			effects: ['grant-resource:arcane-recovery:1:long'],
			positive: true
		}
	];
	return characterSchema.parse(c);
}
