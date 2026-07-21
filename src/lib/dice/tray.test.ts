import { describe, it, expect, vi } from 'vitest';
import { registerDiceTray, openDiceTray, type DiceTrayRequest } from './tray.svelte';

// the no-handler fallback rolls + toasts; stub the toast so the test asserts only the routing
vi.mock('svelte-sonner', () => ({ toast: () => {} }));

describe('dice tray contract', () => {
	it('routes requests to a registered handler, then stops after unregister', () => {
		const seen: string[] = [];
		const off = registerDiceTray((r) => seen.push(r.formula));
		openDiceTray({ label: 'x', formula: '2d6' });
		expect(seen).toEqual(['2d6']);
		off();
		// no handler → fallback (mocked toast), so nothing more reaches the (unregistered) handler
		openDiceTray({ label: 'x', formula: '1d20' });
		expect(seen).toEqual(['2d6']);
	});

	it('D8: carries the rich fields (pool, advantage, queued damage) through the seam unchanged', () => {
		let got: DiceTrayRequest | null = null;
		const off = registerDiceTray((r) => (got = r));
		const req: DiceTrayRequest = {
			label: 'Longsword — to hit',
			formula: '1d20 + 5',
			pool: { 20: 1 },
			mod: 5,
			advantage: 1,
			queuedDamage: { label: 'Longsword damage', dice: { 8: 1 }, mod: 3 }
		};
		openDiceTray(req);
		off();
		expect(got).toEqual(req);
	});
});
