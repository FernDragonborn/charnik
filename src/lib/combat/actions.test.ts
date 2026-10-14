import { describe, it, expect } from 'vitest';
import { ACTION_PRESET, actionsHiddenBy, standardActions } from './actions';
import { SYSTEMS } from '$lib/rules/pipeline';

describe.each(SYSTEMS)('action presets (%s)', (system) => {
	const actions = standardActions(null, system);
	const shown = (preset: (typeof ACTION_PRESET)[keyof typeof ACTION_PRESET]) => {
		const hidden = actionsHiddenBy(actions, preset);
		return actions.map((a) => a.id).filter((id) => !hidden.includes(id));
	};

	it('All hides nothing', () => {
		expect(actionsHiddenBy(actions, ACTION_PRESET.all)).toEqual([]);
	});

	it('Core is the four every character takes, and every other set starts from it', () => {
		expect(shown(ACTION_PRESET.core)).toEqual(['attack', 'dash', 'disengage', 'dodge']);
		for (const preset of [ACTION_PRESET.melee, ACTION_PRESET.stealth, ACTION_PRESET.support])
			expect(shown(preset)).toEqual(expect.arrayContaining(shown(ACTION_PRESET.core)));
	});

	it('each set adds what that way of fighting reaches for', () => {
		expect(shown(ACTION_PRESET.melee)).toEqual(expect.arrayContaining(['grapple', 'shove']));
		expect(shown(ACTION_PRESET.support)).toEqual(expect.arrayContaining(['help', 'ready']));
		expect(shown(ACTION_PRESET.stealth)).toEqual(expect.arrayContaining(['hide', 'search']));
	});

	it('writes only ids this edition has', () => {
		const ids = new Set(actions.map((a) => a.id));
		for (const preset of Object.values(ACTION_PRESET))
			for (const id of actionsHiddenBy(actions, preset)) expect(ids.has(id)).toBe(true);
	});
});
