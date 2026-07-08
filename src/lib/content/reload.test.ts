import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { onBeforeReload, reloadApp } from './reload';

// ── the reload coordinator: pending writes flush before the webview reload ───────────────────────
describe('reload coordinator', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('awaits every registered flusher BEFORE reloading', async () => {
		const order: string[] = [];
		vi.stubGlobal('location', { reload: () => order.push('reload') });
		const off = onBeforeReload(async () => {
			await Promise.resolve();
			order.push('flush');
		});
		await reloadApp();
		off();
		expect(order).toEqual(['flush', 'reload']); // flush completed first
	});

	it('does not call a flusher after it is unregistered', async () => {
		const flush = vi.fn();
		vi.stubGlobal('location', { reload: vi.fn() });
		onBeforeReload(flush)(); // register then immediately unregister
		await reloadApp();
		expect(flush).not.toHaveBeenCalled();
	});

	it('runs multiple flushers before the reload', async () => {
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });
		const a = vi.fn();
		const b = vi.fn();
		const offA = onBeforeReload(a);
		const offB = onBeforeReload(b);
		await reloadApp();
		offA();
		offB();
		expect(a).toHaveBeenCalledOnce();
		expect(b).toHaveBeenCalledOnce();
		expect(reload).toHaveBeenCalledOnce();
	});
});

// ── the foundation live-reload relies on: re-reading content reflects an on-disk change ──────────
const SPELL_HEAD =
	'id,systems,source,name_en,name_uk,level,school,casting_time,range,components,duration,concentration,ritual';
const spell = (id: string) =>
	`${id},5.5e,SRD 5.2.1,${id},,3,evocation,1 action,150 feet,V,Instantaneous,false,false`;

describe('reload reflects on-disk changes', () => {
	it('re-reading a content root after a file changes shows the new data', async () => {
		const s = new MemoryStorage();
		await s.write('a/_pack.json', JSON.stringify({ source: 'SRD 5.2.1', systems: ['5.5e'] }));
		await s.write('a/spells_srd.csv', [SPELL_HEAD, spell('fireball')].join('\n'));

		const before = await loadContent(s, ['a']);
		expect(before.list('spell').length).toBe(1);

		// simulate an external edit on disk: a spell is added to the CSV
		await s.write('a/spells_srd.csv', [SPELL_HEAD, spell('fireball'), spell('shield')].join('\n'));

		const after = await loadContent(s, ['a']);
		expect(after.list('spell').length).toBe(2);
		expect(after.get('spell:SRD 5.2.1:shield')).toBeTruthy();
	});
});
