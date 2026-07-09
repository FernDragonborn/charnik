import { describe, it, expect, vi } from 'vitest';
import { registerDiceTray, openDiceTray } from './tray.svelte';

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
});
