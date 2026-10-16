import { describe, it, expect } from 'vitest';
import { newCharacter, type CharacterPlay } from '$lib/character/schema';
import { LOG_KIND } from '$lib/character/log-kind';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { playChanges } from './changes';

const names = { resource: (id: string) => `pool:${id}`, spell: (ref: string) => `spell:${ref}` };
const effect = (iid: string, label: string) => ({ iid, label, effects: [], positive: false });

describe.each(['5e', '5.5e'] as const)('play changes as log lines · %s', (system) => {
	const before: CharacterPlay = newCharacter('probe', 'Probe', system).play;
	const keys = (after: CharacterPlay, said: (typeof LOG_KIND)[keyof typeof LOG_KIND][] = []) =>
		playChanges(before, after, names, said).map((l) => [l.kind, l.name.key, l.name.values]);

	it('says nothing when nothing moved', () => {
		expect(keys({ ...before })).toEqual([]);
	});

	it('names each slot level and pool that moved, and which way', () => {
		const after = {
			...before,
			spellSlotsSpent: { '1': 2, [PACT_SLOT_KEY]: 1 },
			resourcesSpent: { rage: 1 },
		};
		expect(keys(after)).toEqual([
			[LOG_KIND.slot, 'combat.log.slotSpent', { count: 2, level: 1 }],
			[LOG_KIND.slot, 'combat.log.pactSlotSpent', { count: 1 }],
			[LOG_KIND.resource, 'combat.log.resourceSpent', { name: 'pool:rage', count: 1 }],
		]);
		expect(playChanges(after, before, names, []).map((l) => l.name.key)).toEqual([
			'combat.log.slotRestored',
			'combat.log.pactSlotRestored',
			'combat.log.resourceRegained',
		]);
	});

	it('reads concentration and effects by what began and what ended', () => {
		const from = { ...before, concentration: 'bless', effects: [effect('a', 'Bless')] };
		const to = { ...before, concentration: 'haste', effects: [effect('b', 'Haste')] };
		expect(playChanges(from, to, names, []).map((l) => [l.name.key, l.name.values])).toEqual([
			['combat.log.concentrationEnded', { spell: 'spell:bless' }],
			['combat.log.concentrationBegun', { spell: 'spell:haste' }],
			['combat.log.effectOff', { name: 'Bless' }],
			['combat.log.effectOn', { name: 'Haste' }],
		]);
	});

	it('leaves out what the action already said', () => {
		const after = { ...before, resourcesSpent: { rage: 1 }, effects: [effect('r', 'Rage')] };
		expect(keys(after, [LOG_KIND.resource]).map(([kind]) => kind)).toEqual([LOG_KIND.effect]);
		// a hit says what it took from temporary hit points itself
		const hit = { ...before, hp: { ...before.hp, temp: 0 } };
		expect(
			playChanges({ ...before, hp: { ...before.hp, temp: 5 } }, hit, names, [LOG_KIND.damage]),
		).toEqual([]);
	});

	it('lets a rest stand for everything it gave back', () => {
		const spent = {
			...before,
			spellSlotsSpent: { '1': 2 },
			resourcesSpent: { rage: 2 },
			exhaustion: 2,
			concentration: 'bless',
			effects: [effect('a', 'Bless')],
		};
		expect(playChanges(spent, { ...before, exhaustion: 1 }, names, [LOG_KIND.rest])).toEqual([]);
	});

	it('says temporary hit points, exhaustion and experience as from → to', () => {
		const after = { ...before, hp: { ...before.hp, temp: 7 }, exhaustion: 1, xp: 300 };
		expect(keys(after)).toEqual([
			[LOG_KIND.tempHp, 'combat.log.tempHp', { from: 0, to: 7 }],
			[LOG_KIND.exhaustion, 'combat.log.exhaustion', { from: 0, to: 1 }],
			[LOG_KIND.experience, 'combat.log.experience', { from: 0, to: 300 }],
		]);
	});
});
