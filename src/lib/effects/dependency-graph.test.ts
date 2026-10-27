/*
 * The SCC pass under the dependency order: what it groups, the order it emits, and that content
 * cannot make it overflow the stack.
 */
import { describe, it, expect } from 'vitest';
import { stronglyConnected } from './dependency-graph';

const graph = (n: number, edges: [number, number][]): Set<number>[] => {
	const adj = Array.from({ length: n }, () => new Set<number>());
	for (const [from, to] of edges) adj[from]?.add(to);
	return adj;
};

describe('stronglyConnected', () => {
	it('groups a cycle, and emits sinks first', () => {
		// 0 → 1 → 2 → 1, 2 → 3
		const comps = stronglyConnected(
			4,
			graph(4, [
				[0, 1],
				[1, 2],
				[2, 1],
				[2, 3],
			]),
		);
		expect(comps.map((c) => [...c].sort())).toEqual([[3], [1, 2], [0]]);
	});

	it('walks a chain as long as content can write without overflowing the stack', () => {
		const n = 100_000;
		const edges: [number, number][] = [];
		for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
		const comps = stronglyConnected(n, graph(n, edges));
		expect(comps.length).toBe(n);
		expect(comps[0]).toEqual([n - 1]);
	});
});
