import { describe, it, expect } from 'vitest';
import { newCharacter } from '$lib/character/schema';
import { gainExperience } from './experience';

describe.each(['5e', '5.5e'] as const)('experience · %s', (system) => {
	it('adds what was earned, takes a correction away, and never goes below zero', () => {
		const c = newCharacter('probe', 'Probe', system);
		const earned = gainExperience(c, { amount: 300.4 }).character;
		expect(earned.play.xp).toBe(300);
		expect(gainExperience(earned, { amount: -50 }).character.play.xp).toBe(250);
		expect(gainExperience(earned, { amount: -900 }).character.play.xp).toBe(0);
		expect(c.play.xp).toBe(0);
	});
});
