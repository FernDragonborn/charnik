/*
 * The ONE test that talks to the real internet — REL-4's "unverified end to end" item.
 *
 * Everything else in the pack updater runs against a fake fetcher, which proves the logic and
 * proves nothing about GitHub. This drives the real API through the real adapter: the tree call,
 * the `ETag` → `304` that makes steady state free, the raw download, and the blob SHAs — the last
 * one being the assumption the whole design rests on ("did this file change?" answered without
 * downloading it), and the one no fake can validate.
 *
 * OPT-IN: `CHARNIK_LIVE_NETWORK=1 pnpm vitest run tests/live-github.test.ts`. Off by default, since
 * a test suite that fails when the wifi drops (or when a shared IP has burned GitHub's 60/hr) is a
 * test suite people learn to ignore.
 *
 * What it still does NOT cover: the Rust HTTP client and its capability allowlist, which only exist
 * inside a running desktop app — that is `src/routes/dev/packs/+page.svelte`'s live probe.
 */
import { describe, it, expect } from 'vitest';
import { checkRepo, parseGithubRepo, rawUrl, treeUrl } from '$lib/content/remote/github';
import { gitBlobSha } from '$lib/content/remote/diff';
import { MAX_REMOTE_BYTES, type FetchResult, type RemoteFetcher } from '$lib/content/remote/types';

/** The same seam the app uses, over node's fetch — the desktop one is the same shape in Rust. */
const nodeFetcher: RemoteFetcher = {
	async getText(url, etag): Promise<FetchResult> {
		const res = await fetch(url, {
			headers: etag === undefined ? {} : { 'If-None-Match': etag },
		});
		if (res.status === 304) return { kind: 'notModified' };
		if (!res.ok) return { kind: 'error', status: res.status, message: res.statusText };
		const body = await res.text();
		if (body.length > MAX_REMOTE_BYTES) return { kind: 'error', message: 'response too large' };
		const next = res.headers.get('etag');
		return next === null ? { kind: 'ok', body } : { kind: 'ok', body, etag: next };
	},
	async getBytes(url) {
		const res = await fetch(url);
		if (!res.ok) return { kind: 'error' as const, message: `${res.status} ${res.statusText}` };
		return { kind: 'ok' as const, bytes: new Uint8Array(await res.arrayBuffer()) };
	},
};

const REPO = 'https://github.com/FernDragonborn/charnik-content-srd';

describe.runIf(process.env.CHARNIK_LIVE_NETWORK)('the live GitHub path', () => {
	it('sees the shipped SRD as two packs, and a re-ask costs a 304', async () => {
		const first = await checkRepo(nodeFetcher, REPO);
		expect(first.kind).toBe('packs');
		if (first.kind !== 'packs') return;

		// one repo, several packs (PLAN · REL-4: a pack is a folder, a repo is where folders live)
		expect(first.packs.map((p) => p.pack)).toEqual(['srd-2014', 'srd-2024']);
		expect(first.packs[0]?.files.length).toBeGreaterThan(10);
		expect(first.etag).toBeTruthy();

		// the whole economics of checking: replaying the ETag must come back 304, which GitHub does
		// not charge against the unauthenticated 60/hr budget
		expect((await checkRepo(nodeFetcher, REPO, first.etag)).kind).toBe('unchanged');
	}, 30_000);

	it("the tree's blob SHA really is the SHA of the bytes raw serves", async () => {
		// if this ever stopped holding, every diff would be wrong in the most expensive direction:
		// files reported as changed forever, or as unchanged when they are not
		const repo = parseGithubRepo(REPO);
		expect(repo).not.toBeNull();
		if (!repo) return;

		const res = await checkRepo(nodeFetcher, REPO);
		if (res.kind !== 'packs') throw new Error('expected a tree listing');
		const file = res.packs.flatMap((p) => p.files).find((f) => f.path.endsWith('.csv'));
		expect(file).toBeDefined();
		if (!file) return;

		const bytes = await nodeFetcher.getBytes(rawUrl(repo, file.path));
		expect(bytes.kind).toBe('ok');
		if (bytes.kind !== 'ok') return;
		expect(await gitBlobSha(bytes.bytes)).toBe(file.sha);
		// and the bytes are the content file itself, headers intact
		expect(new TextDecoder().decode(bytes.bytes)).toContain('#content-');
	}, 30_000);

	it('builds the URLs GitHub actually answers on', async () => {
		const repo = parseGithubRepo(REPO);
		if (!repo) throw new Error('unparsed');
		expect((await fetch(treeUrl(repo), { method: 'HEAD' })).ok).toBe(true);
	}, 30_000);
});
