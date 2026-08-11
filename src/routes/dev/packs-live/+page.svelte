<script lang="ts">
	// DEV-ONLY LIVE PROBE (REL-4) — the one thing unit tests and `/dev/packs` can't do: run the pack
	// updater's network path for real, inside the desktop app, through the RUST http client and the
	// capability allowlist that only exist there. Everything else about this feature is verified
	// against a fake fetcher (`tests/live-github.test.ts` covers GitHub itself from node); what this
	// answers is "does the shipped binary actually reach GitHub, and does the diff agree with disk?".
	//
	// It runs on mount and writes its report next to your data as `packs-live-probe.txt`, so a run
	// can be inspected after the window is closed. It only READS — nothing is applied, nothing is
	// installed, and the registry is untouched.
	import { onMount } from 'svelte';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import { checkRepo, parseGithubRepo, rawUrl } from '$lib/content/remote/github';
	import { diffPack, gitBlobSha } from '$lib/content/remote/diff';
	import { tauriFetcher } from '$lib/content/remote/tauri-fetch';

	const REPO = 'https://github.com/FernDragonborn/charnik-content-srd';
	const REPORT = 'packs-live-probe.txt';

	let lines = $state<string[]>([]);
	const say = (line: string): void => {
		lines = [...lines, line];
	};

	onMount(async () => {
		await probe();
		await getUserStorage()
			.write(REPORT, lines.join('\n'))
			.catch((e: unknown) => say(`report not written: ${String(e)}`));
	});

	async function probe(): Promise<void> {
		say(`platform: ${detectPlatform()}`);
		if (detectPlatform() !== Platform.Desktop) {
			say('NOT the desktop app — this probe only means something in Tauri (Rust http client).');
			return;
		}
		const repo = parseGithubRepo(REPO);
		if (!repo) return say('FAIL: the repo URL did not parse');

		// 1 — the one request that answers for a whole repo
		const first = await checkRepo(tauriFetcher, REPO);
		say(`tree request: ${first.kind}`);
		if (first.kind !== 'packs') return say('FAIL: no tree listing — see the message above');
		say(`packs found: ${first.packs.map((p) => `${p.pack} (${p.files.length} files)`).join(', ')}`);
		say(`etag: ${first.etag ?? '(none — the 304 path would not work)'}`);

		// 2 — the economics: replaying the ETag must cost a 304, not a fresh tree
		const again = await checkRepo(tauriFetcher, REPO, first.etag);
		say(`re-check with ETag: ${again.kind}${again.kind === 'unchanged' ? ' (304 — free)' : ''}`);

		// 3 — a real download, and the assumption the whole diff rests on
		const file = first.packs.flatMap((p) => p.files).find((f) => f.path.endsWith('.csv'));
		if (!file) return say('FAIL: the repo listed no CSV');
		const bytes = await tauriFetcher.getBytes(rawUrl(repo, file.path));
		if (bytes.kind !== 'ok') return say(`FAIL: download of ${file.path}: ${bytes.message}`);
		const sha = await gitBlobSha(bytes.bytes);
		say(`downloaded ${file.path}: ${bytes.bytes.length} bytes`);
		say(`blob sha matches the tree: ${sha === file.sha ? 'YES' : `NO (${sha} ≠ ${file.sha})`}`);

		// 4 — the diff against what is really installed in this data dir
		for (const pack of first.packs) {
			const diff = await diffPack(getUserStorage(), pack);
			const per = diff.changes.reduce<Record<string, number>>(
				(acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] ?? 0) + 1 }),
				{}
			);
			const summary = Object.entries(per)
				.map(([k, n]) => `${n} ${k}`)
				.join(', ');
			say(`diff ${pack.pack}: ${summary === '' ? 'up to date' : summary}`);
		}
	}
</script>

<h1>Dev · live pack-update probe</h1>
<p>Read-only. Report also written to <code>{REPORT}</code> in your data folder.</p>
<pre>{lines.join('\n')}</pre>

<style>
	h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-h4);
		margin: 0 0 8px;
	}
	pre {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
	}
</style>
