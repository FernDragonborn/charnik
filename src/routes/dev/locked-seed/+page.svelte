<script lang="ts">
	// DEV-ONLY LIVE PROBE — a pack file another program holds open while the app refreshes its
	// shipped content (audit-oct-27 D10). Excel holds the CSV it shows; Windows then refuses the
	// rename a write ends in, and the seed used to throw out of the whole content load.
	//
	// The FIXTURE is made from a shell before the app starts, because a webview cannot hold a file
	// open from another process (`docs/internals/tooling.md` ▸ Verifying on the real desktop app):
	// `content/.probe-seed/held.csv` and `content/.probe-seed/free.csv` in the data folder, with
	// `held.csv` held by `[IO.File]::Open(path, 'Open', 'ReadWrite', 'None')`. A dot folder is no
	// pack, so nothing else reads it.
	//
	// The seed writes the real `content/.seed-version` when every file went through. So it runs only
	// once the hold is proven, under a version no build ships: a file that went through anyway would
	// fail the check below, and the probe then puts the marker back.
	import { onMount } from 'svelte';
	import { detectPlatform, getUserStorage, Platform } from '#lib/storage/provider.ts';
	import { MemoryStorage } from '#lib/storage/memory.ts';
	import { seedShippedContent } from '#lib/content/provider.ts';
	import { stampWithHash } from '#lib/content/hash.ts';

	const REPORT = 'locked-seed-probe.txt';
	const ROOT = 'content/.probe-seed';
	const HELD = `${ROOT}/held.csv`;
	const FREE = `${ROOT}/free.csv`;
	const MARKER = 'content/.seed-version';
	const NO_SHIPPED_VERSION = 987_654;

	let lines = $state<string[]>([]);
	let failures = 0;
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

	onMount(async () => {
		let ran = false;
		try {
			ran = await probe();
		} catch (e) {
			check('the probe ran to the end', false, String(e));
		}
		say(!ran ? '\nNOT RUN HERE' : failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
		await getUserStorage()
			.write(REPORT, lines.join('\n'))
			.catch((e: unknown) => say(`report not written: ${String(e)}`));
	});

	async function probe(): Promise<boolean> {
		if (detectPlatform() !== Platform.Desktop) {
			say('NOT the desktop app. Nothing run.');
			return false;
		}
		const s = getUserStorage();
		if (!(await s.exists(HELD)) || !(await s.exists(FREE))) {
			say('NOT RUN — no fixture');
			return false;
		}
		const readError = await errorOf(s.read(HELD));
		if (readError === '') {
			say('NOT RUN — the fixture exists but nothing holds it open');
			return false;
		}
		say(`the hold is real: ${readError}`);

		const listed = (await s.list(ROOT)).map((entry) => entry.name).sort();
		check(
			'the listing names the held file and the free one',
			listed.join(',') === 'free.csv,held.csv',
			listed.join(','),
		);

		// a pack's own file as the app shipped it — an unstamped one would be the user's, and kept
		await s.write(FREE, await stampWithHash(new Map([['source', 'Probe']]), 'id\nfree_v1'));
		const marker = (await s.exists(MARKER)) ? await s.read(MARKER) : null;
		const from = new MemoryStorage();
		await from.write(HELD, 'id\nheld_v2');
		await from.write(FREE, 'id\nfree_v2');
		const seeded = await errorOf(
			seedShippedContent(from, s, [ROOT], NO_SHIPPED_VERSION).then(({ failed }) => {
				check(
					'the seed names the held file as not refreshed',
					failed.join(',') === HELD,
					failed.join(','),
				);
			}),
		);
		check('the seed does not throw on a held file', seeded === '', seeded);
		check('the free file was refreshed past it', (await s.read(FREE)).includes('free_v2'));
		const after = (await s.exists(MARKER)) ? await s.read(MARKER) : null;
		check(
			'the version marker is untouched, so the next launch seeds again',
			after === marker,
			String(after),
		);
		if (after !== marker && marker !== null) await s.write(MARKER, marker);
		return true;
	}
</script>

<pre>{lines.join('\n')}</pre>
