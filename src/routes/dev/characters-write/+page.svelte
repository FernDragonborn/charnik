<script lang="ts">
	// DEV-ONLY LIVE PROBE — character persistence on a real filesystem.
	//
	// Its sibling `/dev/packs-write` proves the pack APPLY path over a real OS; this one proves the
	// half beside it that the September audit read and reasoned about but never RAN
	// (`work/code-quality.md` ▸ AUDIT-COVERAGE): the portrait write, the rotating backup rings and the
	// restore that reads them, `readCharacterFiles`, and the draft filename encoding — which is the
	// one that failed outright on Windows, because `encodeURIComponent` leaves `*` alone and Windows
	// refuses it in a name.
	//
	// A `MemoryStorage` test proves none of it: fakes overwrite happily, encode nothing, and accept
	// every byte a name can hold.
	//
	// It WRITES, so it writes only under a throwaway character id and a throwaway draft, and deletes
	// both at the end. The network is never used.
	import { onMount } from 'svelte';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import {
		backupCharacter,
		deleteCharacter,
		listCharacterBackups,
		loadCharacter,
		readCharacterFiles,
		readCharacterPhoto,
		restoreCharacterBackup,
		saveCharacter,
		writeCharacterPhoto,
	} from '$lib/character/repository';
	import { newCharacter } from '$lib/character/schema';
	import {
		deleteDraft,
		findUnreadableDrafts,
		listDrafts,
		readDraft,
		writeDraft,
		type DraftTarget,
	} from '$lib/drafts/store';

	/** Not a slug any roster of the user's can hold — a leading dot, and the probe deletes it anyway. */
	const ID = '.probe-character';
	const DIR = `characters/${ID}`;
	const REPORT = 'characters-write-probe.txt';

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

	const bytes = (...n: number[]) => new Uint8Array(n);
	const picked = (ext: 'webp' | 'png', ...n: number[]) => ({
		bytes: bytes(...n),
		ext,
		mime: `image/${ext}` as const,
	});
	/** Every draft this probe writes, so cleanup does not depend on the run reaching the end. Typed to
	 *  the `editor` member rather than the union — the probe only writes those, and the check below
	 *  asks for the `source` only that member has. */
	type EditorDraft = Extract<DraftTarget, { kind: 'editor' }>;
	const draftsWritten: EditorDraft[] = [];

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
		await s.remove(DIR).catch(() => {});
		for (const target of draftsWritten) await deleteDraft(s, target).catch(() => {});
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

		// --- 1. the portrait: one file, whatever extension it arrived under -------------------------
		// The failure this closes is a second portrait under a different extension: the sheet shows the
		// name the save carries, and the orphan sits in a folder the user is invited to open.
		await saveCharacter(s, newCharacter(ID, 'Probe', '5e'));
		const first = await writeCharacterPhoto(s, ID, picked('webp', 1, 2, 3));
		check('a picked portrait lands under its own extension', first === 'photo.webp', first);
		check(
			'…and reads back byte for byte',
			[...(await readCharacterPhoto(s, ID, first))].join(',') === '1,2,3',
		);
		const second = await writeCharacterPhoto(s, ID, picked('png', 9, 9));
		check('a second portrait lands under ITS extension', second === 'photo.png', second);
		const stray = (await s.list(DIR)).filter((e) => e.name.startsWith('photo.')).map((e) => e.name);
		check(
			'…and the first one is gone, not orphaned',
			stray.join(',') === 'photo.png',
			stray.join(','),
		);

		// --- 2. the rings, on a filesystem that can refuse a write ----------------------------------
		const t0 = Date.now();
		await backupCharacter(s, ID, 'save', t0);
		await backupCharacter(s, ID, 'save', t0 + 5 * 60_000); // inside the throttle
		await backupCharacter(s, ID, 'save', t0 + 11 * 60_000);
		await backupCharacter(s, ID, 'save', t0 + 22 * 60_000);
		for (let i = 0; i < 5; i++) await backupCharacter(s, ID, 'launch', t0 + i * 60_000);
		const ring = await listCharacterBackups(s, ID);
		const tiers = (tier: string) => ring.filter((b) => b.tier === tier).length;
		check('the save ring keeps 2', tiers('save') === 2, String(tiers('save')));
		check('the launch ring keeps 3', tiers('launch') === 3, String(tiers('launch')));
		check(
			'the listing is newest-first across both rings',
			ring.every((b, i) => i === 0 || (ring[i - 1]?.ts ?? 0) >= b.ts),
		);

		// --- 3. the restore, which is the reader those rings never had ------------------------------
		const renamed = await loadCharacter(s, ID);
		if (renamed.ok && renamed.character) {
			const moved = structuredClone(renamed.character);
			moved.build.name = 'Probe the Renamed';
			await saveCharacter(s, moved);
		}
		check(
			'the live save moved on',
			(await loadCharacter(s, ID)).character?.build.name === 'Probe the Renamed',
		);
		const target = ring[ring.length - 1];
		const restored = target ? await restoreCharacterBackup(s, ID, target.path) : null;
		check('a snapshot restores', restored?.ok === true, restored?.error ?? '');
		check(
			'…and the sheet is the snapshot again',
			(await loadCharacter(s, ID)).character?.build.name === 'Probe',
		);
		await s.write(`${DIR}/character.bak.save.1.json`, '{ not json');
		const refused = await restoreCharacterBackup(s, ID, `${DIR}/character.bak.save.1.json`);
		check('a corrupt snapshot is REFUSED, not written over the save', refused.ok === false);
		check(
			'…and the working character survived it',
			(await loadCharacter(s, ID)).character?.build.name === 'Probe',
		);

		// --- 4. `readCharacterFiles`, which no test has ever driven ---------------------------------
		const raw = await readCharacterFiles(s);
		const mine = raw.find((f) => f.slug === ID);
		check('every saved character is read as raw json', mine !== undefined);
		check('…and it is the file, not a parse of it', (mine?.json ?? '').startsWith('{'));
		say(`  ${raw.length} character file(s) read, this one ${mine?.json.length ?? 0} bytes`);

		// --- 5. the draft filename, which is where a real OS says no --------------------------------
		// `encodeURIComponent` leaves nine characters unescaped and exactly one of them — `*` — is
		// illegal in a Windows filename. The write used to fail with ENOENT into a caller that treats
		// it as fire-and-forget.
		for (const source of ['SRD 5.2.1', 'My*Pack', "Jane's Pack", 'a<b>c', 'a:b', 'a|b', 'a?b']) {
			const t: EditorDraft = { kind: 'editor', type: 'item', source, id: 'axe' };
			draftsWritten.push(t);
			const wrote = await writeDraft(s, t, { name: 'Axe' })
				.then(() => '')
				.catch((e: unknown) => String(e));
			const back = wrote === '' ? await readDraft(s, t) : null;
			check(`source ${JSON.stringify(source)} round-trips`, wrote === '' && back !== null, wrote);
		}
		const listed = await listDrafts(s);
		check(
			'…and every one of them is listed',
			draftsWritten.every((t) =>
				listed.some((d) => d.target.kind === 'editor' && d.target.source === t.source),
			),
		);
		check('nothing landed in the unreadable pile', (await findUnreadableDrafts(s)).length === 0);

		// --- 6. what this probe CANNOT reach, said out loud -----------------------------------------
		// A handle held open by another process needs that other process; the folder picker is an OS
		// dialog outside any webview (`testing.md`); a junction for `walkTree`'s symlink skip is a
		// filesystem fixture rather than an app run. Naming them is what keeps the next reader from
		// assuming this probe covered them.
		say('');
		say('not reachable from here: a file held open by another process, the native folder picker,');
		say('and a junction for walkTree — the first two need a second process, the third a fixture.');

		// deleteCharacter is the last thing, so a failure above still has its folder to inspect
		await deleteCharacter(s, ID);
		check('deleting a character takes the whole folder', !(await s.exists(DIR)));
	}
</script>

<h1>Dev · character persistence on the real filesystem</h1>
<p>
	Writes only inside <code>{DIR}</code> and a few throwaway drafts, and deletes them afterwards.
	Report also written to <code>{REPORT}</code> in your data folder.
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
