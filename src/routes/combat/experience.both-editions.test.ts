/*
 * Experience points at the table, over both editions' shipped Character Advancement tables. The
 * numbers are each SRD's own — 300 for level 2, 6,500 for level 5, 355,000 for level 20, identical in
 * SRD 5.1 (Beyond 1st Level) and SRD 5.2.1 (Character Creation ▸ Level Advancement) — and the rule is
 * 5.2.1's sentence: "When your XP total equals or exceeds a number in the Experience Points column,
 * you reach the corresponding level."
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(() => {}, { custom: () => {} }),
}));

import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character } from '$lib/character/schema';
import { combat } from './combat-view-model.svelte';

const EDITIONS = [
	{ system: '5.5e', pack: 'srd-2024', source: 'SRD 5.2.1' },
	{ system: '5e', pack: 'srd-2014', source: 'SRD 5.1' },
] as const;

describe.each(EDITIONS)('experience · $system', ({ system, pack, source }) => {
	async function fighter(level: number): Promise<Character> {
		combat.graph = await loadPacks(pack);
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [{ class: `class:${source}:fighter`, level }];
		combat.character = c;
		return combat.character;
	}

	it('ships the whole table, level 1 through 20', async () => {
		const graph = await loadPacks(pack);
		const rows = graph.list('advancement', { system });
		expect(rows.map((r) => r.data.level)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
		const xpAt = (level: number) => rows.find((r) => r.data.level === level)?.data.xp;
		expect([1, 2, 5, 11, 20].map(xpAt)).toEqual([0, 300, 6500, 85000, 355000]);
	});

	it('is not counted until the character says so, and says nothing while it is not', async () => {
		const c = await fighter(4);
		expect(combat.experience.mode).toBe('milestone');
		expect(combat.experience.progress).toBeNull();
		combat.experience.setMode('xp');
		expect(c.ui.levelingMode).toBe('xp');
		expect(combat.experience.progress).toEqual({ xp: 0, earned: 1, next: 6500, levelDue: false });
	});

	it('adds what is gained, and marks the level earned at its threshold — never takes it', async () => {
		const c = await fighter(4);
		combat.experience.setMode('xp');
		c.play.xp = 2700;
		combat.experience.gain = 3799;
		combat.experience.add();
		expect(combat.experience.progress).toMatchObject({ xp: 6499, earned: 4, levelDue: false });
		combat.experience.gain = 1;
		combat.experience.add();
		expect(combat.experience.progress).toMatchObject({ xp: 6500, earned: 5, levelDue: true });
		// the level is the builder's to take: the sheet's own level has not moved
		expect(combat.sheet?.level).toBe(4);
		// a correction takes XP away, and never below nothing
		combat.experience.gain = -99999;
		combat.experience.add();
		expect(c.play.xp).toBe(0);
	});

	it('has nothing further to reach at level 20', async () => {
		const c = await fighter(20);
		combat.experience.setMode('xp');
		c.play.xp = 400000;
		expect(combat.experience.progress).toEqual({
			xp: 400000,
			earned: 20,
			next: undefined,
			levelDue: false,
		});
	});
});
