<script lang="ts">
	// DEV-ONLY LIVE PROBE — the storage edges only a real OS has.
	//
	// `/dev/characters-write` covers the happy paths of character persistence. This one covers what
	// the other probe names as out of its reach, plus plugin discovery over the Tauri `Storage`:
	//   1. `walkTree` (via `listDataDirFiles`) against a real junction, one looping back and one
	//      pointing outside the data folder.
	//   2. A write and a delete against a file another process holds open.
	//   3. The data-folder move's copy and rollback halves, driven by a source file that cannot be read.
	//   4. Plugin discovery: an uppercase folder on a case-insensitive filesystem, a namespace claimed
	//      twice, and what the watcher reports when a plugin lands inside a watched pack.
	//
	// Parts 1–3 need FIXTURES this page cannot make: a webview cannot create a junction or hold a file
	// open from another process. They are built from a shell before the app starts — see
	// `docs/internals/tooling.md` ▸ Verifying on the real desktop app — and a part whose fixture is
	// missing says NOT RUN rather than passing.
	//
	// A move that SUCCEEDED would repoint the user's data folder, because `set_data_dir` trusts every
	// child of the folder granted at startup. So part 3 runs only once it has proved its source file
	// unreadable, and puts the pointer back if it moved anyway.
	import { onMount } from 'svelte';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import {
		currentDataDir,
		listDataDirFiles,
		migrateDataDir,
		setDataDirOverride,
	} from '$lib/storage/tauri';
	import { deleteCharacter } from '$lib/character/repository';
	import { discoverPlugins } from '$lib/effects/plugin-host';

	const REPORT = 'storage-edges-probe.txt';
	const WALK = '.probe-walk';
	const LOCKED_ID = '.probe-locked';
	const LOCKED_DIR = `characters/${LOCKED_ID}`;
	const MIGRATE_SRC = '.probe-migrate-src';
	const MIGRATE_DST = '.probe-migrate-dst';
	const PACK = 'content/.probe-pack';
	const PLUGIN_NAMES = ['probe-dup', 'Probe-Case'];

	/** Whether the user already had a `plugins/` folder — if not, the one this page makes goes too. */
	let pluginsFolderExisted = true;
	let lines = $state<string[]>([]);
	let failures = $state(0);
	let ran = $state(false);
	const say = (line: string): void => {
		lines = [...lines, line];
	};
	function check(what: string, ok: boolean, detail = ''): void {
		if (!ok) failures += 1;
		say(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
	}
	const errorOf = (p: Promise<unknown>): Promise<string> =>
		p.then(
			() => '',
			(e: unknown) => String(e),
		);
	const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
	/** A walk into a looping junction never returns, so every walk races a deadline. */
	const withDeadline = <T,>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
		Promise.race([p, pause(ms).then(() => 'timeout' as const)]);

	onMount(async () => {
		try {
			await probe();
		} catch (e) {
			check('the probe ran to the end', false, String(e));
		}
		await cleanup();
		say(!ran ? '\nNOT RUN HERE' : failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
		await getUserStorage()
			.write(REPORT, lines.join('\n'))
			.catch((e: unknown) => say(`report not written: ${String(e)}`));
	});

	/** Only what this page wrote itself. The shell fixtures are removed by the shell that made them:
	 *  a locked file cannot be deleted until its holder lets go. */
	async function cleanup(): Promise<void> {
		const s = getUserStorage();
		await s.remove(PACK).catch(() => {});
		for (const name of PLUGIN_NAMES) await s.remove(`plugins/${name}`).catch(() => {});
		if (!pluginsFolderExisted) await s.remove('plugins').catch(() => {});
		await s.remove(MIGRATE_DST).catch(() => {});
	}

	async function probe(): Promise<void> {
		say(`platform: ${detectPlatform()}`);
		if (detectPlatform() !== Platform.Desktop) {
			say('NOT the desktop app — the point of this probe is the real filesystem. Nothing run.');
			return;
		}
		ran = true;
		pluginsFolderExisted = await getUserStorage().exists('plugins');
		const root = await currentDataDir();
		say(`data folder: ${root}`);
		await cleanup();
		await walkIntoJunctions(root);
		await lockedFile();
		await moveHalves(root);
		await pluginDiscovery();
	}

	// --- 1. junctions ------------------------------------------------------------------------------
	async function walkIntoJunctions(root: string): Promise<void> {
		say('\n1. walkTree against real junctions');
		const s = getUserStorage();
		if (!(await s.exists(`${WALK}/real/a.txt`))) {
			say('   NOT RUN — no junction fixture');
			return;
		}
		const walked = await withDeadline(listDataDirFiles(`${root}/${WALK}`), 10_000);
		check('the walk returns at all (a followed loop never would)', walked !== 'timeout');
		if (walked === 'timeout') return;
		const paths = walked.map((f) => f.path).sort();
		check(
			'it lists the real file and nothing behind either junction',
			paths.join(',') === 'real/a.txt',
			paths.join(','),
		);
	}

	// --- 2. a file another process holds open --------------------------------------------------------
	async function lockedFile(): Promise<void> {
		say('\n2. writing and deleting against a file another process holds open');
		const s = getUserStorage();
		const held = `${LOCKED_DIR}/character.json`;
		if (!(await s.exists(held))) {
			say('   NOT RUN — no locked fixture');
			return;
		}
		const readError = await errorOf(s.read(held));
		if (readError === '') {
			say('   NOT RUN — the fixture exists but nothing holds it open');
			return;
		}
		say(`   the hold is real: ${readError}`);

		// the write every save ends in: a temp sibling renamed over the held file
		const temps = async () =>
			(await s.list(LOCKED_DIR)).map((e) => e.name).filter((n) => n.includes('.tmp-'));
		const tempsBefore = new Set(await temps());
		const saveError = await errorOf(s.write(held, '{}'));
		check('a write onto a held file is REFUSED loudly', saveError !== '', saveError);
		const leftovers = (await temps()).filter((n) => !tempsBefore.has(n));
		check('…and takes its temp file with it', leftovers.length === 0, leftovers.join(', '));

		const deleteError = await errorOf(deleteCharacter(s, LOCKED_ID));
		check('deleting a held character is REFUSED loudly', deleteError !== '', deleteError);
		const remaining = (await s.list(LOCKED_DIR).catch(() => [])).map((e) => e.name).sort();
		say(`   what the refused delete left: ${remaining.join(', ') || 'nothing'}`);
		check('…and the held file itself is still there', remaining.includes('character.json'));
	}

	// --- 3. the data-folder move, as far as it can go without repointing -----------------------------
	async function moveHalves(root: string): Promise<void> {
		say('\n3. the data-folder move: refusal, copy failure and rollback');
		const s = getUserStorage();

		const inside = await migrateDataDir(root, `${root}/.probe-inside`, false);
		check(
			'a target inside the current folder is refused before anything is copied',
			inside.stage === 'target_inside_source' && !(await s.exists('.probe-inside')),
			inside.stage ?? 'ok',
		);

		const held = `${MIGRATE_SRC}/locked.bin`;
		if (!(await s.exists(held)) || (await errorOf(s.read(held))) === '') {
			say('   copy half NOT RUN — no source file held open (a copy that succeeded would repoint)');
			return;
		}
		const moved = await migrateDataDir(`${root}/${MIGRATE_SRC}`, `${root}/${MIGRATE_DST}`, false);
		const after = await currentDataDir();
		if (after !== root) {
			await setDataDirOverride(root);
			check('the pointer stayed where it was', false, `moved to ${after}, put back`);
		}
		check(
			'a source file that cannot be read fails the COPY stage',
			moved.stage === 'copy',
			moved.stage ?? 'ok',
		);
		say(`   its error: ${moved.error ?? '(none)'}`);
		check('…and the half-copied target is swept away', !(await s.exists(MIGRATE_DST)));
		check('…and the source is untouched', await s.exists(`${MIGRATE_SRC}/free.txt`));
	}

	// --- 4. plugin discovery over the real filesystem ----------------------------------------------
	async function pluginDiscovery(): Promise<void> {
		say('\n4. plugin discovery');
		const s = getUserStorage();
		const manifest = (namespace: string) =>
			JSON.stringify({ api: 1, namespace, name: 'Probe', version: '0.0.1' });
		const main = 'globalThis.handlers = { f: { passive() { return {}; } } };';
		const place = async (dir: string, namespace: string) => {
			await s.write(`${dir}/plugin.json`, manifest(namespace));
			await s.write(`${dir}/main.js`, main);
		};

		await place('plugins/probe-dup', 'probe-dup');
		await s.mkdir(`${PACK}/plugins`);
		const events: string[] = [];
		const stop = s.watch(PACK, (path) => events.push(path));
		await pause(800); // `watch` attaches asynchronously; an early write is simply not seen
		await place(`${PACK}/plugins/probe-dup`, 'probe-dup');

		// the case-folding hazard: the folder is created capitalised, then written to in lower case —
		// on Windows both names are one folder, and the listing reports the name it was CREATED with
		await s.mkdir('plugins/Probe-Case');
		await place('plugins/probe-case', 'probe-case');
		await pause(1500);
		stop();

		const found = await discoverPlugins(s);
		const mine = found.filter((p) => p.namespace.toLowerCase().startsWith('probe-'));
		for (const p of mine) say(`   ${p.origin} · ${p.namespace} · ${p.ok ? 'loaded' : p.problem}`);
		check(
			'the hand-placed probe-dup loads',
			mine.some((p) => p.namespace === 'probe-dup' && p.ok),
		);
		check(
			'the pack copy of probe-dup is REPORTED as a second claimant, not shadowed silently',
			mine.some(
				(p) => p.namespace === 'probe-dup' && !p.ok && (p.problem ?? '').includes('already'),
			),
		);
		const cased = mine.find((p) => p.namespace.toLowerCase() === 'probe-case');
		check(
			'a folder written in lower case into a capitalised one is REPORTED, not dropped',
			cased !== undefined && !cased.ok,
			cased ? `listed as "${cased.namespace}"` : 'absent from discovery',
		);
		say(`   watcher events from the pack while a plugin landed in it: ${events.length}`);
		for (const path of [...new Set(events)].slice(0, 6)) say(`     ${path}`);
	}
</script>

<h1>Dev · storage edges on the real filesystem</h1>
<p>
	Needs the shell fixtures described in <code>docs/internals/tooling.md</code>; a part without its
	fixture says NOT RUN. Report also written to <code>{REPORT}</code> in your data folder.
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
