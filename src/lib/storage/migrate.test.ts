import { describe, it, expect } from 'vitest';
import {
	copyFailures,
	isSameOrInside,
	conflictRows,
	mergeCopyList,
	mergeFailures,
	type DirFile
} from './migrate';

const f = (path: string, size: number, mtime?: number): DirFile => ({ path, size, mtime });

describe('copyFailures — the gate that must be empty before deleting the source', () => {
	const source = [f('a.csv', 100), f('sub/b.csv', 50)];
	it('is empty when every source file reached the target at the right size', () => {
		expect(copyFailures(source, [f('a.csv', 100), f('sub/b.csv', 50), f('extra', 1)])).toEqual([]);
	});
	it('flags a missing file', () => {
		expect(copyFailures(source, [f('a.csv', 100)])).toEqual(['sub/b.csv']);
	});
	it('flags a truncated / size-mismatched file', () => {
		expect(copyFailures(source, [f('a.csv', 99), f('sub/b.csv', 50)])).toEqual(['a.csv']);
	});
});

describe('conflictRows — the merge table, collisions first, newer side flagged', () => {
	const source = [f('a.csv', 100, 30), f('b.csv', 50, 10), f('only-old.csv', 5)];
	const target = [f('a.csv', 100, 20), f('b.csv', 60, 40), f('only-new.csv', 7)];
	const rows = conflictRows(source, target);

	it('lists files present in BOTH folders before single-side files', () => {
		expect(rows.slice(0, 2).map((r) => r.path)).toEqual(['a.csv', 'b.csv']);
		expect(rows.every((r, i) => (i < 2 ? r.source && r.target : !(r.source && r.target)))).toBe(
			true
		);
	});
	it('flags which side is newer on a collision', () => {
		expect(rows.find((r) => r.path === 'a.csv')?.newer).toBe('source'); // 30 > 20
		expect(rows.find((r) => r.path === 'b.csv')?.newer).toBe('target'); // 40 > 10
	});
	it('uses null for single-side files and unknown when an mtime is missing', () => {
		expect(rows.find((r) => r.path === 'only-old.csv')?.newer).toBeNull();
		expect(conflictRows([f('x', 1)], [f('x', 2, 5)])[0]?.newer).toBe('unknown');
	});
});

describe('mergeCopyList — newer-wins, keep target when undatable', () => {
	it('copies files the target lacks, and source files that are strictly newer', () => {
		const source = [f('new.csv', 1, 50), f('old.csv', 1, 10), f('missing.csv', 1, 5)];
		const target = [f('new.csv', 1, 20), f('old.csv', 1, 90)];
		expect(
			mergeCopyList(source, target)
				.map((s) => s.path)
				.sort()
		).toEqual(['missing.csv', 'new.csv']);
	});
	it('keeps the target file when either side has no mtime (undatable collision)', () => {
		expect(mergeCopyList([f('x', 1)], [f('x', 2, 5)])).toEqual([]);
	});
});

describe('mergeFailures — the gate before deleting the old folder after a merge', () => {
	const source = [f('kept.csv', 5), f('copied.csv', 9)];
	const copied = [f('copied.csv', 9)];
	it('passes when every source file is present and copies match size', () => {
		expect(mergeFailures(source, copied, [f('kept.csv', 5), f('copied.csv', 9)])).toEqual([]);
	});
	it('flags a source file missing from the merged folder', () => {
		expect(mergeFailures(source, copied, [f('copied.csv', 9)])).toEqual(['kept.csv']);
	});
	it('flags a copied file that landed at the wrong size', () => {
		expect(mergeFailures(source, copied, [f('kept.csv', 5), f('copied.csv', 1)])).toEqual([
			'copied.csv'
		]);
	});
});

describe('isSameOrInside — refuse a target that sits inside the source', () => {
	it('true for the same folder and any nesting depth', () => {
		expect(isSameOrInside('C:/data/charnik', 'C:/data/charnik')).toBe(true);
		expect(isSameOrInside('C:/data/charnik/sub', 'C:/data/charnik')).toBe(true);
	});
	it('is separator- and case-insensitive, and ignores a trailing slash', () => {
		expect(isSameOrInside('C:\\data\\charnik\\sub', 'c:/DATA/charnik/')).toBe(true);
	});
	it('false for a sibling or a prefix-only string match', () => {
		expect(isSameOrInside('C:/data/charnik2', 'C:/data/charnik')).toBe(false);
		expect(isSameOrInside('C:/other', 'C:/data/charnik')).toBe(false);
	});
});
