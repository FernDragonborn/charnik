import { describe, it, expect } from 'vitest';
import { reorderRowSubset, uniqueRowKeys } from './row-order';

it('moves only the visible category and keeps the saved hidden rows', () => {
	expect(
		reorderRowSubset(
			['dash', 'rage', 'flurry', 'help'],
			['dash', 'rage', 'hide', 'flurry'],
			['flurry', 'rage'],
		),
	).toEqual(['dash', 'flurry', 'hide', 'rage', 'help']);
});

describe('uniqueRowKeys — a keyed list never sees one key twice', () => {
	it('leaves unrepeated ids alone and numbers the repeats', () => {
		expect(uniqueRowKeys(['longsword', 'dagger', 'longsword', 'longsword'])).toEqual([
			'longsword',
			'dagger',
			'longsword#2',
			'longsword#3',
		]);
		expect(uniqueRowKeys([])).toEqual([]);
	});
});
