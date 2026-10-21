/*
 * "At a level" is `<what>@<level>` (`level-gate.ts`): `2@3,2@10` is two at level 3 and two more at 10.
 * The form the ladder columns had before, `level:count`, grants nothing and is said with its new step.
 */
import { describe, it, expect } from 'vitest';
import { countAtLevel, levelLadderIssues, readLevelLadder } from './level-gate';
import { loadPacks } from '../../test-support/real-content';
import type { ContentGraph } from './loader';

describe('a ladder of counts by level', () => {
	it('reads its steps and sums those reached', () => {
		expect(readLevelLadder('2@3, 2@10')).toEqual({
			steps: [
				{ count: 2, level: 3 },
				{ count: 2, level: 10 },
			],
			unread: [],
		});
		expect(countAtLevel('1@1,2@2,2@5', 4)).toBe(3);
	});

	it('says the old form with the step it is now, and anything else as unread', () => {
		const graph = {
			list: () => [
				{ id: 'old', root: 'pack', file: 'class_features.csv', data: { choose: '2:2,5:1' } },
				{ id: 'odd', root: 'pack', file: 'class_features.csv', data: { mastery_slots: 'two' } },
			],
		} as unknown as ContentGraph;
		const issues = levelLadderIssues(graph, '5.5e');
		expect(issues.map((i) => [i.id, i.key, i.values])).toEqual([
			['old', 'contentIssue.levelLadderOldForm', { column: 'choose', now: '2@2' }],
			['old', 'contentIssue.levelLadderOldForm', { column: 'choose', now: '1@5' }],
			['odd', 'contentIssue.levelLadderUnread', { column: 'mastery_slots' }],
		]);
	});

	it.each(['srd-2014', 'srd-2024'] as const)('every shipped ladder in %s reads', async (pack) => {
		const graph = await loadPacks(pack);
		const system = pack === 'srd-2014' ? '5e' : '5.5e';
		expect(levelLadderIssues(graph, system)).toEqual([]);
	});
});
