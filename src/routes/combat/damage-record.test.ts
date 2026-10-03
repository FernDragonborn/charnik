/*
 * What a Damage press RECORDS, and a hit of more than one type. The defenses' arithmetic is
 * `applyDamageSensitivity`'s and is tested there; this is the hit as one event — each part against
 * its own type, temp HP and the concentration save asked of the total — and the record it leaves.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(() => {}, { custom: () => {} }),
}));

import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character } from '$lib/character/schema';
import { combat } from './combat-view-model.svelte';

const S = 'SRD 5.2.1';
let c: Character;

beforeEach(async () => {
	combat.graph = await loadPacks('srd-2024');
	const fresh = newCharacter('probe', 'Probe', '5.5e');
	fresh.build.classes = [{ class: `class:${S}:fighter`, level: 5 }];
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
	combat.hp.moreParts = [];
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

describe('damage · one hit, two types', () => {
	it('each part meets its own defense, and the hit points take the sum', () => {
		const full = c.play.hp.current;
		combat.hpAmount = 7;
		combat.damageType = 'slashing';
		combat.hp.addPart();
		combat.hp.moreParts = [{ amount: 12, type: 'fire' }];
		expect(combat.hp.previewOf(combat.hp.moreParts[0]!)).toEqual({
			raw: 12,
			final: 6,
			bucket: 'resist',
		});
		combat.damage();
		expect(c.play.hp.current).toBe(full - 13);
		expect(recorded().map(([key]) => key)).toEqual([
			'combat.log.damageTakenDefended.resist',
			'combat.log.damageTakenTyped',
		]);
		// the extra part belonged to that hit, not to the next one
		expect(combat.hp.moreParts).toEqual([]);
	});

	it('is ONE hit: temp HP soaks the total, and one concentration save is owed for it', () => {
		c.play.hp.temp = 5;
		c.play.concentration = `spell:${S}:bless`;
		const full = c.play.hp.current;
		combat.hpAmount = 14;
		combat.damageType = 'slashing';
		combat.hp.moreParts = [{ amount: 20, type: 'fire' }];
		combat.damage();
		// 14 + 10 = 24 taken; 5 soaked
		expect(c.play.hp).toMatchObject({ temp: 0, current: full - 19 });
		expect(combat.pendingConcentrationSave?.dc).toBe(12);
	});

	it('a part can be taken back before the press', () => {
		combat.hp.addPart();
		combat.hp.addPart();
		combat.hp.removePart(0);
		expect(combat.hp.moreParts).toHaveLength(1);
	});
});

describe('healing · the record it leaves', () => {
	it('says what came back, which is less than what was entered at the maximum', () => {
		c.play.hp.current = combat.hpMax - 4;
		combat.hpAmount = 10;
		combat.heal();
		expect(c.play.hp.current).toBe(combat.hpMax);
		expect(recorded()).toEqual([['combat.log.hitPointsRestored', { restored: 4 }]]);
	});

	it('nothing is recorded for a heal that restored nothing', () => {
		combat.hpAmount = 10;
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
