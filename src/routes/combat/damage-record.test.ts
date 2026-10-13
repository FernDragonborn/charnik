/*
 * What a Damage press RECORDS. The defenses' arithmetic is `applyDamageSensitivity`'s and is tested
 * there; this is the hit as one event of one type — its own defense, then temp HP and the
 * concentration save asked of what is left — and the record it leaves. A hit of two types is two
 * presses, and the saves they owe are merged by hand.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(() => {}, { custom: () => {} }),
}));

import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character, classRow } from '$lib/character/schema';
import { combat } from './combat-view-model.svelte';

const S = 'SRD 5.2.1';
let c: Character;

beforeEach(async () => {
	combat.graph = await loadPacks('srd-2024');
	const fresh = newCharacter('probe', 'Probe', '5.5e');
	fresh.build.classes = [classRow({ class: `class:${S}:fighter`, level: 5 })];
	fresh.build.abilities = { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
	combat.character = fresh;
	c = combat.character;
	c.play.hp.current = combat.hpMax;
	combat.effects.addEffect({
		label: 'Ring of Fire Resistance',
		tokens: ['damage_sensitivity:resist:fire'],
		durationRounds: 0,
	});
	combat.journal.log = [];
	combat.hp.owedConcentrationSaves = [];
});

/** The newest log lines as the key and values they were recorded with. */
const recorded = () => combat.journal.log.map((e) => [e.labelKey, e.labelValues]);

describe('damage · the record a hit leaves', () => {
	it('an untyped hit says how much, and nothing about a type', () => {
		const full = c.play.hp.current;
		combat.hpAmount = 7;
		combat.damageType = null;
		combat.damage();
		expect(c.play.hp.current).toBe(full - 7);
		expect(recorded()).toEqual([['combat.log.damageTaken', { final: 7 }]]);
	});

	it('a typed hit names the type, and the defense that changed the number', () => {
		combat.hpAmount = 9;
		combat.damageType = 'cold';
		combat.damage();
		combat.hpAmount = 12;
		combat.damageType = 'fire';
		combat.damage();
		expect(recorded()).toEqual([
			[
				'combat.log.damageTakenDefended.resist',
				{ final: 6, raw: 12, type: { catalog: 'damageType', id: 'fire' } },
			],
			['combat.log.damageTakenTyped', { final: 9, type: { catalog: 'damageType', id: 'cold' } }],
		]);
	});

	it('nothing is recorded for a press that dealt nothing', () => {
		combat.hpAmount = 0;
		combat.damage();
		expect(recorded()).toEqual([]);
	});
});

describe('damage · one hit of two types is two presses', () => {
	it('each press meets its own defense, and the saves they owe merge into the one the hit owes', () => {
		c.play.hp.temp = 5;
		c.play.concentration = `spell:${S}:bless`;
		const full = c.play.hp.current;
		combat.hpAmount = 14;
		combat.damageType = 'slashing';
		combat.damage();
		combat.hpAmount = 20;
		combat.damageType = 'fire';
		expect(combat.hp.damagePreview).toEqual({ raw: 20, final: 10, bucket: 'resist' });
		combat.damage();
		// 14 + 10 = 24 taken; 5 soaked by the first press
		expect(c.play.hp).toMatchObject({ temp: 0, current: full - 19 });
		expect(recorded().map(([key]) => key)).toEqual([
			'combat.log.damageTakenDefended.resist',
			'combat.log.damageTakenTyped',
		]);
		expect(combat.hp.owedConcentrationSaves.map((save) => save.dc)).toEqual([10, 10]);
		combat.hp.mergeOwedConcentrationSaves();
		expect(combat.hp.owedConcentrationSaves.map((save) => save.dc)).toEqual([12]);
	});
});

describe('healing · the record it leaves', () => {
	it('says what came back, which is less than what was entered at the maximum', () => {
		c.play.hp.current = combat.hpMax - 4;
		combat.healAmount = 10;
		combat.heal();
		expect(c.play.hp.current).toBe(combat.hpMax);
		expect(recorded()).toEqual([['combat.log.hitPointsRestored', { restored: 4 }]]);
	});

	it('nothing is recorded for a heal that restored nothing', () => {
		combat.healAmount = 10;
		combat.heal();
		expect(recorded()).toEqual([]);
	});
});

describe('damage · the types on offer', () => {
	it('lists what the character has a defense for first, then every other type', () => {
		const options = combat.damageTypeOptions;
		expect(options[0]).toBe('fire');
		expect(options).toContain('slashing');
		expect(options).toContain('psychic');
		expect(new Set(options).size).toBe(options.length);
	});
});
