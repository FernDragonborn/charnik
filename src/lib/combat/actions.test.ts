import { describe, it, expect } from 'vitest';
import {
	ACTION_COST,
	ACTION_PRESET,
	actionsHiddenBy,
	isActionHidden,
	standardActions,
	type ActionPreset,
} from './actions';
import { SYSTEMS } from '$lib/rules/pipeline';

describe.each(SYSTEMS)('action presets (%s)', (system) => {
	const actions = standardActions(null, system);
	const shownBy = (preset: ActionPreset, actionsShown: string[] = []) => {
		const ui = { actionsHidden: actionsHiddenBy(actions, preset), actionsShown };
		return actions.filter((a) => !isActionHidden(a, ui)).map((a) => a.id);
	};

	it('All shows every action a character starts with', () => {
		expect(actionsHiddenBy(actions, ACTION_PRESET.all)).toEqual([]);
		expect(shownBy(ACTION_PRESET.all)).not.toContain('cry');
	});

	it('Core is the four every character takes, and every other set starts from it', () => {
		expect(shownBy(ACTION_PRESET.core)).toEqual(['attack', 'dash', 'disengage', 'dodge']);
		for (const preset of [ACTION_PRESET.melee, ACTION_PRESET.stealth, ACTION_PRESET.support])
			expect(shownBy(preset)).toEqual(expect.arrayContaining(shownBy(ACTION_PRESET.core)));
	});

	it('each set adds what that way of fighting reaches for', () => {
		expect(shownBy(ACTION_PRESET.melee)).toEqual(expect.arrayContaining(['grapple', 'shove']));
		expect(shownBy(ACTION_PRESET.support)).toEqual(expect.arrayContaining(['help', 'ready']));
		expect(shownBy(ACTION_PRESET.stealth)).toEqual(expect.arrayContaining(['hide', 'search']));
	});

	it('Class features leaves only what the features grant: no standard action stays', () => {
		expect(shownBy(ACTION_PRESET.classFeatures)).toEqual([]);
	});

	it('writes only ids this edition has', () => {
		const ids = new Set(actions.map((a) => a.id));
		for (const preset of Object.values(ACTION_PRESET))
			for (const id of actionsHiddenBy(actions, preset)) expect(ids.has(id)).toBe(true);
	});
});

describe.each(SYSTEMS)('Cry (%s)', (system) => {
	const cry = standardActions(null, system).find((a) => a.id === 'cry');

	it('is the last row, free, and off the panel until its own eye opens it', () => {
		expect(standardActions(null, system).at(-1)?.id).toBe('cry');
		expect(cry?.cost).toBe(ACTION_COST.free);
		if (!cry) return;
		expect(isActionHidden(cry, { actionsHidden: [], actionsShown: [] })).toBe(true);
		expect(isActionHidden(cry, { actionsHidden: [], actionsShown: ['cry'] })).toBe(false);
	});

	it('no preset reaches it, either way', () => {
		for (const preset of Object.values(ACTION_PRESET))
			expect(actionsHiddenBy(standardActions(null, system), preset)).not.toContain('cry');
	});
});
