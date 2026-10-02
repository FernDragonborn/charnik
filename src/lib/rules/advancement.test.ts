import { describe, it, expect } from 'vitest';
import { levelEarned, xpToReach } from './advancement';

const TABLE = [
	{ level: 1, xp: 0 },
	{ level: 2, xp: 300 },
	{ level: 3, xp: 900 },
];

describe('advancement · the level an XP total has earned', () => {
	it('is the highest level whose threshold the total meets — equal counts', () => {
		expect(levelEarned(TABLE, 0)).toBe(1);
		expect(levelEarned(TABLE, 299)).toBe(1);
		expect(levelEarned(TABLE, 300)).toBe(2);
		expect(levelEarned(TABLE, 5000)).toBe(3);
	});

	it('does not depend on the order the rows arrive in', () => {
		expect(levelEarned([...TABLE].reverse(), 300)).toBe(2);
	});

	it('has no answer without a table, rather than a guess', () => {
		expect(levelEarned([], 300)).toBeUndefined();
		expect(xpToReach([], 2)).toBeUndefined();
	});

	it('says what a level takes, and nothing past the last one', () => {
		expect(xpToReach(TABLE, 3)).toBe(900);
		expect(xpToReach(TABLE, 4)).toBeUndefined();
	});
});
