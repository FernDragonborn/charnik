import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { takeReloadMark } from '../stores/flash';
import { loadContent } from './loader';
import { RELOAD_INTENT, onBeforeReload, reloadApp, reloadIntentOf } from './reload';

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

	it('holds the reload back when a flusher failed, so the unsaved edit is not discarded', async () => {
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });
		const off = onBeforeReload(() => Promise.reject(new Error('disk full')));
		await reloadApp();
		off();
		expect(reload).not.toHaveBeenCalled();
	});

	it('leaves word for the page that loads next, once, and only when it reloads', async () => {
		const kept = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => kept.get(key) ?? null,
			setItem: (key: string, value: string) => void kept.set(key, value),
			removeItem: (key: string) => void kept.delete(key),
		});
		vi.stubGlobal('location', { reload: vi.fn() });
		expect(takeReloadMark()).toBe(false);

		const off = onBeforeReload(() => Promise.reject(new Error('disk full')));
		await reloadApp();
		off();
		// held back: nothing was reloaded, so nothing says it was
		expect(takeReloadMark()).toBe(false);

		await reloadApp();
		expect(takeReloadMark()).toBe(true);
		expect(takeReloadMark()).toBe(false);
	});
});

// ── which reload a key asks for ────────────────────────────────────────────────────────────────────
describe('reloadIntentOf', () => {
	const press = (code: string, held: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
		code,
		ctrlKey: held.ctrl ?? false,
		metaKey: held.meta ?? false,
		shiftKey: held.shift ?? false,
	});

	it('on desktop, F5 and Ctrl+R are one key: the refresh that reloads nothing', () => {
		expect(reloadIntentOf(press('F5'), true)).toBe(RELOAD_INTENT.refresh);
		expect(reloadIntentOf(press('KeyR', { ctrl: true }), true)).toBe(RELOAD_INTENT.refresh);
		expect(reloadIntentOf(press('KeyR', { meta: true }), true)).toBe(RELOAD_INTENT.refresh);
	});

	it('on desktop, Shift or Ctrl+F5 makes it the page reload', () => {
		expect(reloadIntentOf(press('KeyR', { ctrl: true, shift: true }), true)).toBe(
			RELOAD_INTENT.reload,
		);
		expect(reloadIntentOf(press('F5', { ctrl: true }), true)).toBe(RELOAD_INTENT.reload);
		expect(reloadIntentOf(press('F5', { shift: true }), true)).toBe(RELOAD_INTENT.reload);
	});

	it('leaves a bare R and every other key alone', () => {
		expect(reloadIntentOf(press('KeyR'), true)).toBe(RELOAD_INTENT.none);
		expect(reloadIntentOf(press('KeyR', { shift: true }), true)).toBe(RELOAD_INTENT.none);
		expect(reloadIntentOf(press('KeyK', { ctrl: true }), true)).toBe(RELOAD_INTENT.none);
	});

	it('on the web takes only F5, and leaves Ctrl+R to the browser', () => {
		expect(reloadIntentOf(press('F5'), false)).toBe(RELOAD_INTENT.reload);
		expect(reloadIntentOf(press('KeyR', { ctrl: true }), false)).toBe(RELOAD_INTENT.none);
		expect(reloadIntentOf(press('KeyR', { ctrl: true, shift: true }), false)).toBe(
			RELOAD_INTENT.none,
		);
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
