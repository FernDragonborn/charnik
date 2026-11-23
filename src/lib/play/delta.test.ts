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

describe('rewinding through the log', () => {
	it('takes several acts back newest first, to the state before the oldest', async () => {
		const { rewindActs } = await import('./undo');
		const c = newCharacter('probe', 'Probe', '5.5e');
		c.play.hp.current = 4;
		c.play.hp.temp = 5;
		// oldest: hp 9 → 6; then temp 0 → 5; then hp 6 → 4
		const deltas = [
			[{ path: ['play', 'hp', 'current'], from: 6, to: 4 }],
			[{ path: ['play', 'hp', 'temp'], from: 0, to: 5 }],
			[{ path: ['play', 'hp', 'current'], from: 9, to: 6 }],
		];
		const outcome = rewindActs(c, { deltas });
		expect(outcome.refused).toBeUndefined();
		expect(outcome.character.play.hp).toMatchObject({ current: 9, temp: 0 });
		expect(outcome.notices[0]?.text).toEqual({
			key: 'combat.notice.rewound',
			values: { count: 3 },
		});
	});

	it('takes none back when one on the way changed something that moved since', async () => {
		const { rewindActs } = await import('./undo');
		const c = newCharacter('probe', 'Probe', '5.5e');
		c.play.hp.current = 4;
		c.play.hp.temp = 2; // the act said 0 → 5; something spent three since
		const outcome = rewindActs(c, {
			deltas: [
				[{ path: ['play', 'hp', 'current'], from: 6, to: 4 }],
				[{ path: ['play', 'hp', 'temp'], from: 0, to: 5 }],
			],
		});
		expect(outcome.refused).toBe(true);
		expect(outcome.character).toBe(c);
	});
});

describe('which acts a take-back reaches', () => {
	const hurt = [{ path: ['play', 'hp', 'current'], from: 9, to: 6 }];
	const spent = [{ path: ['play', 'hp', 'temp'], from: 0, to: 5 }];

	it('every line from the newest down to the one taken back that changed something', async () => {
		const { deltasBackTo } = await import('./undo');
		const newest = { delta: spent };
		const said = { kind: 'notice' as const };
		const oldest = { delta: hurt };
		const log = [newest, said, oldest];
		expect(deltasBackTo(log, oldest)).toEqual([spent, hurt]);
		expect(deltasBackTo(log, newest)).toEqual([spent]);
		expect(deltasBackTo(log, said)).toBeNull(); // nothing to take back on a line that moved nothing
	});

	it('stops at a level-up, a build change the log does not take back', async () => {
		const { deltasBackTo } = await import('./undo');
		const oldest = { delta: hurt };
		const log = [{ delta: spent }, { kind: 'level' as const }, oldest];
		expect(deltasBackTo(log, oldest)).toBeNull();
		expect(deltasBackTo(log, log[0] ?? oldest)).toEqual([spent]);
	});
});
