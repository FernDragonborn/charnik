import { describe, expect, it } from 'vitest';
import { firstDifference } from './first-difference';

describe('firstDifference', () => {
	it('reads the same sheet whatever order its fields arrive in', () => {
		const sent = { hp: { current: 7, max: 12 }, conditions: ['prone'], name: 'Probe' };
		const arrived = { conditions: ['prone'], hp: { max: 12, current: 7 }, name: 'Probe' };
		expect(firstDifference(sent, arrived, 'view')).toBeNull();
	});

	it('names the field that changed, was lost, or was added on the way', () => {
		const sent = { hp: { current: 7, max: 12 }, conditions: ['prone', 'poisoned'] };
		expect(firstDifference(sent, { ...sent, hp: { current: 7, max: 11 } }, 'view')).toBe(
			'view.hp.max',
		);
		expect(firstDifference(sent, { ...sent, conditions: ['prone'] }, 'view')).toBe(
			'view.conditions.1',
		);
		expect(firstDifference(sent, { ...sent, extra: 1 }, 'view')).toBe('view.extra');
		expect(firstDifference({ list: [] }, { list: {} }, 'view')).toBe('view.list');
	});
});
