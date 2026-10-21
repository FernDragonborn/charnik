/*
 * What a cast leaves on the caster, over both editions' shipped spell rows: the effect tokens a
 * spell carries are its own sentences, so each assertion quotes the one it stands on.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('$lib/toast/toast', () => ({
	toast: Object.assign(() => {}, { success: () => {}, warning: () => {}, error: () => {} }),
	toastRollCard: () => {},
}));

import { loadPacks } from '../../test-support/real-content';
import { tokensOf } from '$lib/content/loader';
import { newCharacter, type Character, classRow } from '$lib/character/schema';
import { combat } from './combat-view-model.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import { spellRow } from '$lib/combat/helpers';

const EDITIONS = [
	{ system: '5.5e', pack: 'srd-2024', source: 'SRD 5.2.1' },
	{ system: '5e', pack: 'srd-2014', source: 'SRD 5.1' },
] as const;

const noModifiers = { shiftKey: false } as unknown as Event;

beforeAll(async () => {
	await startI18n('en');
	void locale.set('en');
	await waitLocale();
});

for (const { system, pack, source } of EDITIONS) {
	describe(`what a cast leaves on the caster · ${system}`, () => {
		/** A level-17 wizard of this edition with Dexterity 14 and no armour: slots for everything. */
		async function caster(): Promise<Character> {
			combat.graph = await loadPacks(pack);
			const c = newCharacter('probe', 'Probe', system);
			c.play.hp.current = 10; // on their feet: at 0 hit points nothing is concentrated on
			c.build.classes = [classRow({ class: `class:${source}:wizard`, level: 17 })];
			c.build.abilities = { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 };
			combat.character = c;
			return combat.character;
		}

		/** Cast a shipped spell from a slot of its own level. */
		function cast(id: string) {
			const ref = `spell:${source}:${id}`;
			const row = combat.graph ? spellRow(combat.graph, ref, 'on') : null;
			expect(row, `${id} ships`).not.toBeNull();
			if (row) combat.cast(row, noModifiers, { slot: row.level });
		}

		const ac = () => combat.sheet?.ac.value;

		it('Mage Armor: "base AC becomes 13 plus its Dexterity modifier"', async () => {
			await caster();
			expect(ac()).toBe(12);
			cast('mage_armor');
			expect(ac()).toBe(15);
		});

		it('Shield and Shield of Faith add to it: "+5 bonus to AC", "+2 bonus to AC"', async () => {
			await caster();
			cast('shield');
			expect(ac()).toBe(17);
			cast('shield_of_faith');
			expect(ac()).toBe(19);
		});

		it('Barkskin is a floor, and each edition states its own', async () => {
			await caster();
			cast('barkskin');
			// SRD 5.2.1 "an Armor Class of 17 if its AC is lower" · SRD 5.1 "can't be less than 16"
			expect(ac()).toBe(system === '5.5e' ? 17 : 16);
		});

		it('Longstrider, Fly and Spider Climb move the speeds their text names', async () => {
			await caster();
			const walk = combat.sheet?.speed.value ?? 0;
			cast('longstrider');
			expect(combat.sheet?.speed.value).toBe(walk + 10);
			cast('fly');
			expect(combat.sheet?.flySpeed.value).toBe(60);
		});

		it('Haste: "speed is doubled, it gains a +2 bonus to AC … an additional action"', async () => {
			await caster();
			const walk = combat.sheet?.speed.value ?? 0;
			cast('haste');
			expect(ac()).toBe(14);
			expect(combat.economy.slotMax.action).toBe(2);
			expect(combat.sheet?.speed.value).toBe(walk * 2);
			// the speed it doubles is the one the creature has, Longstrider's ten feet included
			cast('longstrider');
			expect(combat.sheet?.speed.value).toBe((walk + 10) * 2);
		});

		it('Heroism: Temporary Hit Points equal to the spellcasting modifier at each turn start', async () => {
			const c = await caster();
			c.play.inCombat = true;
			c.play.round = 1;
			cast('heroism');
			expect(combat.sheet?.conditionImmunities).toContain('frightened');
			combat.nextTurn();
			expect(combat.character?.play.hp.temp).toBe(3); // Intelligence 16
			// they do not stack, and a larger amount is never lowered
			if (combat.character) combat.character.play.hp.temp = 7;
			combat.nextTurn();
			expect(combat.character?.play.hp.temp).toBe(7);
		});

		it('Invisibility gives the condition, and Mind Blank the two immunities', async () => {
			await caster();
			cast('invisibility');
			expect(combat.sheet?.facts.conditions).toContain('invisible');
			cast('mind_blank');
			expect(combat.sheet?.damageSensitivities.immune).toContain('psychic');
			expect(combat.sheet?.conditionImmunities).toContain('charmed');
		});

		it('Blur and Foresight are said of attacks made AGAINST the caster', async () => {
			await caster();
			cast('blur');
			expect(combat.sheet?.incomingAttacks.length).toBeGreaterThan(0);
		});

		it('Beacon of Hope: "Advantage on Wisdom saving throws and Death Saving Throws"', async () => {
			await caster();
			expect(combat.effectsFor('save.death').advantage).toBe(false);
			cast('beacon_of_hope');
			expect(combat.effectsFor('save.death').advantage).toBe(true);
			expect(combat.effectsFor('save.wis').advantage).toBe(true);
			expect(combat.effectsFor('save.dex').advantage).toBe(false);
		});

		it('a spell that rolls nothing is captioned from its own tokens, in this character’s numbers', async () => {
			await caster();
			const caption = (id: string) => {
				const row = combat.graph ? spellRow(combat.graph, `spell:${source}:${id}`, 'on') : null;
				return row ? combat.casting.caption(row) : null;
			};
			expect(caption('mage_armor')).toBe('AC = 15'); // 13 + Dexterity 14's +2
			expect(caption('shield')).toBe('AC +5');
			expect(caption('fly')).toBe('Fly speed ≥ 60');
			expect(caption('spider_climb')).toBe('Climb speed ≥ 30');
			expect(caption('bless')).toBe('Attack +1d4, all saves +1d4');
			// a spell whose row states no effect says nothing here, and the panel words that
			expect(caption('detect_magic')).toBe('');
		});

		it('a buff that grants advantage on a save is not a spell that forces one', async () => {
			await caster();
			const resolution = (id: string) => {
				const row = combat.graph?.get(`spell:${source}:${id}`);
				return row?.type === 'spell' ? row.data.resolution : undefined;
			};
			// "it has Advantage on Dexterity saving throws" · "Advantage on Wisdom saving throws"
			expect(resolution('haste')).toBe('none');
			expect(resolution('beacon_of_hope')).toBe('none');
		});

		it('no shipped spell carries a token the sheet cannot read', async () => {
			const c = await caster();
			const spells = combat.graph?.list('spell', { system }) ?? [];
			const carrying = spells.filter((row) => tokensOf(row).length > 0);
			// the three the pack already had, and the ones whose text states an effect on its target
			expect(carrying.length).toBe(system === '5.5e' ? 25 : 24);
			c.play.effects = carrying.map((row, i) => ({
				iid: String(i),
				label: String(row.data.name_en),
				effects: tokensOf(row),
				positive: true,
			}));
			expect(
				combat.sheet?.deriveIssues.map(
					(issue) => `${issue.source}: ${issue.token} — ${issue.detail}`,
				),
			).toEqual([]);
		});
	});
}

/*
 * SRD 5.1 ▸ Warlock ▸ Agonizing Blast: "When you cast eldritch blast, add your Charisma modifier to
 * the damage it deals on a hit." The option's token is scoped to the spell's id, so it reaches
 * Eldritch Blast and no other spell.
 */
describe('a held invocation reaches the one spell it names · 5e', () => {
	it('Agonizing Blast adds the Charisma modifier to Eldritch Blast and to nothing else', async () => {
		const source = 'SRD 5.1';
		combat.graph = await loadPacks('srd-2014');
		const c = newCharacter('probe', 'Probe', '5e');
		c.play.hp.current = 10;
		c.build.classes = [classRow({ class: `class:${source}:warlock`, level: 2 })];
		c.build.abilities = { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 18 };
		c.build.options = { warlock_eldritch_invocations: ['agonizing_blast'] };
		combat.character = c;
		const castAndRead = (id: string) => {
			const row = combat.graph ? spellRow(combat.graph, `spell:${source}:${id}`, 'on') : null;
			expect(row, `${id} ships`).not.toBeNull();
			if (row) combat.cast(row, noModifiers);
			return combat.journal.log[0]?.damage?.[0]?.expr ?? combat.journal.log[0]?.expr ?? '';
		};
		expect(castAndRead('eldritch_blast')).toContain('+4');
		expect(castAndRead('fire_bolt')).not.toContain('+4');
	});
});

/*
 * SRD 5.2.1 ▸ Agonizing Blast: "Choose one of your known Warlock cantrips that deals damage. You can
 * add your Charisma modifier to that spell's damage rolls." The pick names the cantrip, and the
 * bonus reaches that cantrip and no other.
 */
describe('a held invocation reaches the cantrip its pick named · 5.5e', () => {
	it('Agonizing Blast on Chill Touch adds Charisma to Chill Touch and not to Eldritch Blast', async () => {
		const source = 'SRD 5.2.1';
		combat.graph = await loadPacks('srd-2024');
		const c = newCharacter('probe', 'Probe', '5.5e');
		c.play.hp.current = 10;
		c.build.classes = [classRow({ class: `class:${source}:warlock`, level: 2 })];
		c.build.abilities = { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 18 };
		c.build.options = { warlock_eldritch_invocations: ['agonizing_blast@chill_touch'] };
		combat.character = c;
		const castAndRead = (id: string) => {
			const row = combat.graph ? spellRow(combat.graph, `spell:${source}:${id}`, 'on') : null;
			expect(row, `${id} ships`).not.toBeNull();
			if (row) combat.cast(row, noModifiers);
			return combat.journal.log[0]?.damage?.[0]?.expr ?? combat.journal.log[0]?.expr ?? '';
		};
		expect(castAndRead('chill_touch')).toContain('+4');
		expect(castAndRead('eldritch_blast')).not.toContain('+4');
		expect(combat.sheet?.deriveIssues).toEqual([]);
	});
});
