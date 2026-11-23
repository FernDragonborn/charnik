/*
 * The delta a play act leaves on its log line, and the Undo that takes it back (audit-oct-27 U7):
 * a rest, a new day and a dropped row each come back exactly, and an Undo after the state moved on
 * refuses rather than putting back a state that never was.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacks } from '../../test-support/real-content';
import { newCharacter, type Character, classRow, inventoryRow } from '#lib/character/schema.ts';
import { deriveSheet } from '#lib/character/derive.ts';
import type { ContentGraph } from '#lib/content/loader.ts';
import { playDelta, undoDelta } from './delta';
import { rest } from './rests';
import { dropItem } from './inventory';
import type { PlayContext } from './outcome';

const EDITIONS = {
	'5e': { pack: 'srd-2014', source: 'SRD 5.1' },
	'5.5e': { pack: 'srd-2024', source: 'SRD 5.2.1' },
} as const;
type System = keyof typeof EDITIONS;

const graphs = {} as Record<System, ContentGraph>;
beforeAll(async () => {
	graphs['5e'] = await loadPacks('srd-2014');
	graphs['5.5e'] = await loadPacks('srd-2024');
});

describe.each(['5e', '5.5e'] as const)('undoing a play act · %s', (system) => {
	const { source } = EDITIONS[system];
	const ctx: PlayContext = {
		derive: (character) => deriveSheet(character, graphs[system]),
		locale: 'en',
		get graph() {
			return graphs[system];
		},
	};
	const worn = (): Character => {
		const c = newCharacter('probe', 'Probe', system);
		c.build.classes = [classRow({ class: `class:${source}:fighter`, level: 5 })];
		c.play.hp.current = 9;
		c.play.hitDiceSpent = { d10: 2 };
		c.play.resourcesSpent = { second_wind: 1 };
		c.build.inventory = ['dagger', 'shield', 'torch'].map((id) =>
			inventoryRow({ item: `item:${source}:${id}`, qty: 2, equipped: false, attuned: false }),
		);
		return c;
	};

	it('a long rest writes only what it moved, and its Undo puts every one of them back', () => {
		const before = worn();
		const after = rest(before, { kind: 'long' }, ctx).character;
		const delta = playDelta(before, after);

		expect(delta.map((step) => step.path.join('.'))).toContain('play.hp.current');
		expect(delta.some((step) => step.path[0] === 'build')).toBe(false);
		expect(undoDelta(after, delta)).toEqual(before);
	});

	it('a dropped row comes back where it was, with its quantity', () => {
		const before = worn();
		const row = before.build.inventory[1]?.iid ?? '';
		const after = dropItem(before, { row }, ctx).character;
		const delta = playDelta(before, after);

		expect(delta).toHaveLength(1);
		expect(undoDelta(after, delta)).toEqual(before);
	});

	it('refuses once what it changed has moved on', () => {
		const before = worn();
		const after = rest(before, { kind: 'long' }, ctx).character;
		const delta = playDelta(before, after);
		const hurt = { ...after, play: { ...after.play, hp: { ...after.play.hp, current: 1 } } };

		expect(undoDelta(hurt, delta)).toBeNull();
	});
});

describe('the Undo act', () => {
	it('says it could not when the state moved on, and leaves the character alone', async () => {
		const { undoAct } = await import('./undo');
		const c = newCharacter('probe', 'Probe', '5.5e');
		const delta = [{ path: ['play', 'hp', 'current'], from: 3, to: 9 }];
		const outcome = undoAct(c, { delta });
		expect(outcome.refused).toBe(true);
		expect(outcome.character).toBe(c);
		c.play.hp.current = 9;
		expect(undoAct(c, { delta }).character.play.hp.current).toBe(3);
	});
});
