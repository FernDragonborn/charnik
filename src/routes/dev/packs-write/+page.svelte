<script lang="ts">
	// DEV-ONLY LIVE PROBE (REL-4) — the APPLY path, on a real filesystem.
	//
	// Its sibling `/dev/packs-live` proves the NETWORK half inside the desktop app. This one proves
	// the half a fake `Storage` cannot speak for, and which is the
	// last unverified piece of REL-4: the pack is rebuilt beside the live folder and swapped in by
	// RENAME, the folder it replaced is kept one generation as `<pack>.prev`, an interrupted swap is
	// settled at startup from the folders alone, and the diff is re-checked against disk immediately
	// before the write. Every one of those is a directory rename over a real OS — and on Windows a
	// directory rename onto an existing target FAILS, which no MemoryStorage will ever tell you.
	//
	// It WRITES, so it writes only inside a throwaway pack whose name pack discovery ignores (a
	// leading dot, `isReservedPackName`), and deletes it at the end. Nothing the user owns is touched
	// and the network is never used — the fetcher here is local bytes, because what is under test is
	// the disk.
	import { onMount } from 'svelte';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import { listFilesRecursive } from '$lib/storage/walk';
	import { FILE_CHANGE, gitBlobSha, type PackDiff } from '$lib/content/remote/diff';
	import {
		applyPackUpdate,
		hasRollback,
		recoverInterruptedApply,
		removeStaging,
		rollbackPack,
	} from '$lib/content/remote/install';
	import { stampWithHash } from '$lib/content/hash';
	import type { RemoteFetcher } from '$lib/content/remote/types';

	/** Ignored by pack discovery (leading dot), so a crashed run can never load as content. */
	const PACK = '.probe-pack';
	const ROOT = `content/${PACK}`;
	const REPORT = 'packs-write-probe.txt';
	const REPO = { owner: 'probe', repo: 'probe', branch: 'main' };

	let lines = $state<string[]>([]);
	let failures = $state(0);
	/** Whether the probe got past the platform gate — see the verdict below. */
	let ran = $state(false);
	const say = (line: string): void => {
		lines = [...lines, line];
	};
	/** One assertion, reported either way — a probe that only prints on failure teaches you nothing
	 *  about what it actually got as far as checking. */
	function check(what: string, ok: boolean, detail = ''): void {
		if (!ok) failures += 1;
		say(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
	}

	const enc = (s: string) => new TextEncoder().encode(s);
	/** Serves whatever bytes the scenario says, so the only thing under test is the write. */
	const localFetcher = (files: Record<string, string>): RemoteFetcher => ({
		getText: async () => ({ kind: 'error', message: 'the disk is what is under test' }),
		getBytes: async (url) => {
			const hit = Object.entries(files).find(([path]) => url.endsWith(path));
			return hit ? { kind: 'ok', bytes: enc(hit[1]) } : { kind: 'error', message: `no ${url}` };
		},
	});

	onMount(async () => {
		try {
			await probe();
		} catch (e) {
			check('the probe ran to the end', false, String(e));
		}
		await cleanup();
		// a probe that prints ALL PASSED for a run that did nothing is worse than one that prints
		// nothing: the verdict is the only thing anyone reads
		say(!ran ? '\nNOT RUN HERE' : failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
		await getUserStorage()
			.write(REPORT, lines.join('\n'))
			.catch((e: unknown) => say(`report not written: ${String(e)}`));
	});

	async function cleanup(): Promise<void> {
		const s = getUserStorage();
		for (const dir of [ROOT, `${ROOT}.new`, `${ROOT}.prev`]) await s.remove(dir).catch(() => {});
	}

	/** The pack as it stands before an update: one stamped CSV, a plugin two levels down, and a file
	 *  the pack format doesn't cover — all three have to survive differently. */
	async function seedPack(csvBody: string): Promise<void> {
		const s = getUserStorage();
		await s.writeBytes(
			`${ROOT}/a.csv`,
			enc(await stampWithHash(new Map([['source', 'Probe']]), csvBody)),
		);
		await s.writeBytes(`${ROOT}/plugins/probe/main.js`, enc('globalThis.probe = 1;'));
		await s.writeBytes(`${ROOT}/notes.md`, enc('my notes'));
	}

	/** A diff that rewrites `a.csv`, carrying the disk state it was computed against. */
	async function diffFor(sha: string): Promise<PackDiff> {
		const s = getUserStorage();
		return {
			pack: PACK,
			changes: [
				{
					path: `${PACK}/a.csv`,
					kind: FILE_CHANGE.changed,
					sha,
					expectLocal: await gitBlobSha(await s.readBytes(`${ROOT}/a.csv`)),
				},
			],
		};
	}

	async function probe(): Promise<void> {
		const s = getUserStorage();
		say(`platform: ${detectPlatform()}`);
		if (detectPlatform() !== Platform.Desktop) {
			say('NOT the desktop app — the point of this probe is the real filesystem. Nothing run.');
			return;
		}
		ran = true;
		await cleanup();

		// --- 1. the swap: all-old to all-new, with everything else carried across -------------------
		await seedPack('id\nold');
		const next = await stampWithHash(new Map([['source', 'Probe']]), 'id\nnew');
		const nextSha = await gitBlobSha(enc(next));

		// how many times the watcher fires for one bulk apply — a reload STORM is the failure mode.
		// `watch` returns its unsubscribe synchronously but ATTACHES asynchronously, so writing
		// immediately measures nothing: the app attaches at startup, long before any apply, and a
		// probe that races the attach reports a reassuring zero for the wrong reason.
		let watchHits = 0;
		const unwatch = s.watch('content', () => (watchHits += 1));
		await new Promise((r) => setTimeout(r, 1500));

		const res = await applyPackUpdate({
			storage: s,
			fetcher: localFetcher({ [`${PACK}/a.csv`]: next }),
			repo: REPO,
			diff: await diffFor(nextSha),
		});

		check('apply reported no error', res.error === undefined, res.error?.kind ?? '');
		say(`apply wrote: ${res.written.join(', ') || '(nothing)'}`);
		for (const dir of [ROOT, `${ROOT}.new`, `${ROOT}.prev`])
			say(
				`  ${dir}: ${(await s.exists(dir)) ? (await listFilesRecursive(s, dir)).join(', ') || '(empty)' : '(absent)'}`,
			);
		check('the CSV is the new one', (await s.read(`${ROOT}/a.csv`)).includes('new'));
		check('a file the update never mentioned survived', await s.exists(`${ROOT}/notes.md`));
		check('a plugin TWO levels down survived', await s.exists(`${ROOT}/plugins/probe/main.js`));
		check('the replaced folder is kept as .prev', await hasRollback(s, PACK));
		check(
			'.prev holds the OLD bytes',
			(await s.read(`${ROOT}.prev/a.csv`).catch(() => '')).includes('old'),
		);
		check('the staging folder is gone', !(await s.exists(`${ROOT}.new`)));

		// give the OS watcher a moment to deliver, then report rather than assert: the count is
		// platform-dependent, what matters is that it is a handful and not one per file
		await new Promise((r) => setTimeout(r, 1200));
		unwatch();
		say(
			`watcher fired ${watchHits}x for one apply (debounced downstream; a storm would be dozens)`,
		);

		// --- 2. rollback: the undo an applied update never had --------------------------------------
		check('rollback reports it happened', await rollbackPack(s, PACK));
		check('the CSV is the old one again', (await s.read(`${ROOT}/a.csv`)).includes('old'));
		check('and there is nothing left to roll back to', !(await hasRollback(s, PACK)));

		// --- 3. compare-and-set: the disk moved after the diff was shown ----------------------------
		const stale = await diffFor(nextSha);
		await s.writeBytes(`${ROOT}/a.csv`, enc('id\nedited in another window'));
		const refused = await applyPackUpdate({
			storage: s,
			fetcher: localFetcher({ [`${PACK}/a.csv`]: next }),
			repo: REPO,
			diff: stale,
		});
		check('a moved file refuses the whole update', refused.error !== undefined);
		check(
			'and the edit made in between is still there',
			(await s.read(`${ROOT}/a.csv`)).includes('another window'),
		);

		// --- 4. the three interrupted states, settled from the folders alone ------------------------
		await cleanup();
		await seedPack('id\nlive');
		await s.writeBytes(`${ROOT}.new/a.csv`, enc('id\nhalf-built'));
		await recoverInterruptedApply(s, PACK);
		check(
			'killed BEFORE the swap: the half-built tree is discarded',
			!(await s.exists(`${ROOT}.new`)),
		);
		check('…and the live pack is untouched', (await s.read(`${ROOT}/a.csv`)).includes('live'));

		// the GENUINE mid-swap state is `.prev` AND `.new`: both writers keep the replacement tree on
		// disk until the very last rename, so at the only moment the pack is missing both exist
		await cleanup();
		await s.writeBytes(`${ROOT}.prev/a.csv`, enc('id\nrescued'));
		await s.writeBytes(`${ROOT}.new/a.csv`, enc('id\nnever made it'));
		await recoverInterruptedApply(s, PACK);
		check('killed BETWEEN the two renames: the pack comes back from .prev', await s.exists(ROOT));
		check('…with its bytes', (await s.read(`${ROOT}/a.csv`)).includes('rescued'));
		check('…and the tree that never landed is gone', !(await s.exists(`${ROOT}.new`)));

		// …and a `.prev` ALONE is not that state at all — it is a pack whose live folder left by some
		// other route (a file manager, an older build's uninstall). Renaming it back handed the user a
		// pack they had deleted, one launch later.
		await cleanup();
		await s.writeBytes(`${ROOT}.prev/a.csv`, enc('id\ndeleted on purpose'));
		await recoverInterruptedApply(s, PACK);
		check('an ORPHANED .prev does not resurrect the pack', !(await s.exists(ROOT)));
		check('…and is not left lying around either', !(await s.exists(`${ROOT}.prev`)));

		await cleanup();
		await s.writeBytes(`${ROOT}.new/a.csv`, enc('id\npromoted'));
		await recoverInterruptedApply(s, PACK);
		check('killed AFTER the second rename: the new tree is promoted', await s.exists(ROOT));
		check('…with its bytes', (await s.read(`${ROOT}/a.csv`)).includes('promoted'));

		// --- 5. rename onto an EXISTING directory — the Windows trap --------------------------------
		// `Storage.rename` does not promise to overwrite, and the apply removes the target first
		// because of it. If that promise is wrong on this OS the swap silently stops working.
		await cleanup();
		await s.writeBytes(`${ROOT}/a.csv`, enc('id\nsource'));
		await s.writeBytes(`${ROOT}.prev/a.csv`, enc('id\ntarget in the way'));
		const overwrote = await s
			.rename(ROOT, `${ROOT}.prev`)
			.then(() => true)
			.catch(() => false);
		say(
			`rename onto an existing directory: ${overwrote ? 'SUCCEEDED (the apply removes it first anyway)' : 'refused — which is why the apply removes the target first'}`,
		);

		// --- 6. uninstall takes the staging folders with it -----------------------------------------
		// `uninstallPack` itself refuses a reserved name (this probe pack starts with a dot), so what is
		// under test is the helper it calls. Leaving a `.prev` behind is what made an uninstall
		// un-uninstall itself at the next launch, via the recovery above.
		await cleanup();
		await seedPack('id\nlive');
		await s.writeBytes(`${ROOT}.prev/a.csv`, enc('id\nan older version'));
		await s.writeBytes(`${ROOT}.new/a.csv`, enc('id\nleftover'));
		await s.remove(ROOT);
		await removeStaging(s, PACK);
		check('uninstall clears .prev', !(await s.exists(`${ROOT}.prev`)));
		check('…and .new', !(await s.exists(`${ROOT}.new`)));
		await recoverInterruptedApply(s, PACK);
		check('…so the next launch finds nothing to put back', !(await s.exists(ROOT)));

		// --- 7. does THIS filesystem fold case? ------------------------------------------------------
		// The registry compares folder names case-insensitively because NTFS/APFS do. No MemoryStorage
		// can answer this, and getting it wrong installs one pack on top of another.
		await cleanup();
		await seedPack('id\nlive');
		const folds = await s.exists(`content/${PACK.toUpperCase()}`);
		say(
			`this filesystem ${folds ? 'FOLDS case (as assumed — the registry compares names case-insensitively)' : 'is case-SENSITIVE (the case-folded compare is then merely conservative)'}`,
		);
	}
</script>

<h1>Dev · live pack APPLY probe</h1>
<p>
	Writes only inside <code>{ROOT}</code>, and deletes it afterwards. Report also written to
	<code>{REPORT}</code> in your data folder.
</p>
<pre>{lines.join('\n')}</pre>

<style>
	h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-h4);
		margin: 0 0 var(--space-2);
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
