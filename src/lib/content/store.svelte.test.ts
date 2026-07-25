import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContentGraph } from './loader';

/*
 * T1: the content-store load/reload error-capture paths — the one place a regression strands users on
 * an endless "Loading content…". We mock the provider so getContentGraph can succeed OR throw, and
 * assert: a failure is RECORDED on content.error (never thrown) and drops the rejected cache, a later
 * success CLEARS the error (recovery), reload rotates the guid, and remount also resets user storage.
 */
const getContentGraph = vi.fn<() => Promise<ContentGraph>>();
const resetContentGraph = vi.fn();
const resetUserStorage = vi.fn();

vi.mock('./provider', () => ({ getContentGraph, resetContentGraph }));
vi.mock('$lib/storage/provider', () => ({ resetUserStorage }));

const { content, loadContentStore, reloadContent } = await import('./store.svelte');

const fakeGraph = (tag: string) => ({ rows: [], guidTag: tag }) as unknown as ContentGraph;

beforeEach(() => {
	vi.clearAllMocks();
	content.graph = null;
	content.guid = '';
	content.error = null;
});

describe('loadContentStore', () => {
	it('on success stores the graph, a fresh guid, and clears error', async () => {
		getContentGraph.mockResolvedValueOnce(fakeGraph('a'));
		const g = await loadContentStore();
		expect(g).toBe(content.graph);
		expect(content.graph).toBeTruthy();
		expect(content.guid).not.toBe('');
		expect(content.error).toBeNull();
	});

	it('is a no-op when a graph is already loaded (does not re-fetch)', async () => {
		content.graph = fakeGraph('already');
		await loadContentStore();
		expect(getContentGraph).not.toHaveBeenCalled();
	});

	it('records a load failure on content.error instead of throwing, and drops the cache', async () => {
		getContentGraph.mockRejectedValueOnce(new Error('bad bundle'));
		await expect(loadContentStore()).resolves.toBeNull();
		expect(content.graph).toBeNull();
		expect(content.error).toContain('bad bundle');
		expect(resetContentGraph).toHaveBeenCalledTimes(1); // rejected cache dropped so a retry can re-run
	});

	it('recovers: after a failure a later successful load clears the error (no endless Loading)', async () => {
		getContentGraph.mockRejectedValueOnce(new Error('transient'));
		await loadContentStore();
		expect(content.error).toContain('transient');
		getContentGraph.mockResolvedValueOnce(fakeGraph('recovered'));
		await loadContentStore(); // graph is still null, so this retries
		expect(content.error).toBeNull();
		expect(content.graph).toBeTruthy();
	});
});

describe('reloadContent', () => {
	it('rotates the guid and clears error on success', async () => {
		content.graph = fakeGraph('old');
		content.guid = 'old-guid';
		getContentGraph.mockResolvedValueOnce(fakeGraph('new'));
		await reloadContent();
		expect(content.guid).not.toBe('old-guid');
		expect(content.error).toBeNull();
		expect(resetContentGraph).toHaveBeenCalled(); // cache dropped before the rebuild
	});

	it('captures a reload failure on content.error', async () => {
		getContentGraph.mockRejectedValueOnce(new Error('reload boom'));
		await reloadContent();
		expect(content.error).toContain('reload boom');
	});

	it('remount also resets the user storage (so a moved data folder is re-resolved)', async () => {
		getContentGraph.mockResolvedValueOnce(fakeGraph('remounted'));
		await reloadContent({ remount: true });
		expect(resetUserStorage).toHaveBeenCalledTimes(1);
	});

	it('without remount it does NOT reset user storage', async () => {
		getContentGraph.mockResolvedValueOnce(fakeGraph('same'));
		await reloadContent();
		expect(resetUserStorage).not.toHaveBeenCalled();
	});
});
