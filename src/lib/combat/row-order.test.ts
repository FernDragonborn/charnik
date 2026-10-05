import { describe, it, expect } from 'vitest';
import { uniqueRowKeys } from './row-order';

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
