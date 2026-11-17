<script lang="ts">
	// DEV-ONLY LIVE PROBE (audit-oct-27 D13) — durable writes on the real filesystem.
	//
	// Every write of the data folder goes through Rust's `write_file_durable`, which flushes a temp
	// sibling before renaming it in; the folder pointer and `plugins.json` go the same way. A fake
	// Storage cannot say whether that holds on Windows, nor whether the IPC carries the bytes and a
	// non-ASCII path intact, so this asks the app. It writes only into `.probe-durable/`, which pack
	// discovery and the roster both ignore, and removes it at the end. The close-flush marker it
	// leaves is read after the window is closed from outside (`tooling.md`).
	import { onMount } from 'svelte';
	import { currentDataDir } from '$lib/storage/tauri';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import { onBeforeReload } from '$lib/content/reload';
	import { invokeRaw } from '../invoke-raw';

	const DIR = '.probe-durable';
	const REPORT = 'durable-write-probe.txt';
	const CLOSE_MARKER = 'durable-close-marker.txt';

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

	/** The webview's own IPC with a raw body and headers, as `TauriStorage.writeBytes` sends it. */
	async function rawWrite(absolute: string, bytes: Uint8Array): Promise<string> {
		const internals: unknown = Reflect.get(window, '__TAURI_INTERNALS__');
		const invoke: unknown =
			typeof internals === 'object' && internals !== null ? Reflect.get(internals, 'invoke') : null;
		if (typeof invoke !== 'function') return 'no IPC entry';
		const hex = [...new TextEncoder().encode(absolute)]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		try {
			await Reflect.apply(invoke, internals, [
				'write_file_durable',
				bytes,
				{ headers: { path: hex } },
			]);
			return 'written';
		} catch (e) {
			return `refused: ${String(e)}`;
		}
	}

	async function probe(): Promise<void> {
		if (detectPlatform() !== Platform.Desktop) return;
		ran = true;
		const s = getUserStorage();
		const name = `${DIR}/характер.json`;
		await s.write(name, '{"v":1}');
		await s.write(name, '{"v":2}');
		check('a write replaces the file whole', (await s.read(name)) === '{"v":2}');
		const left = (await s.list(DIR)).map((e) => e.name);
		check('no temp sibling is left beside it', left.join(',') === 'характер.json', left.join(','));

		const bytes = new Uint8Array([0, 255, 13, 10, 7]);
		await s.writeBytes(`${DIR}/bytes.bin`, bytes);
		const back = await s.readBytes(`${DIR}/bytes.bin`);
		check('bytes arrive exactly', back.join(',') === bytes.join(','), back.join(','));

		const outside = await rawWrite('C:/Windows/Temp/charnik-probe.txt', new Uint8Array([1]));
		check('a path outside the data folder is refused', outside.startsWith('refused'), outside);
		const climbing = await rawWrite(`${await currentDataDir()}/../escape.txt`, new Uint8Array([1]));
		check('a path that climbs out with .. is refused', climbing.startsWith('refused'), climbing);

		const dir = await currentDataDir();
		const pointer = await invokeRaw('set_data_dir', { path: dir });
		check(
			'the folder pointer is rewritten',
			pointer.resolved,
			pointer.resolved ? '' : pointer.reason,
		);
		const saved = await invokeRaw('saved_data_dir');
		check(
			'…and reads back as the same folder',
			saved.resolved && saved.value === dir,
			saved.resolved ? String(saved.value) : saved.reason,
		);

		const on = await invokeRaw('set_plugin_kill_switch', { on: true });
		const off = await invokeRaw('set_plugin_kill_switch', { on: false });
		const prefs = await invokeRaw('plugin_prefs');
		check(
			'plugins.json is rewritten both ways',
			on.resolved &&
				off.resolved &&
				prefs.resolved &&
				JSON.stringify(prefs.value).includes('false'),
			JSON.stringify(prefs),
		);
	}

	onMount(async () => {
		try {
			await probe();
		} catch (e) {
			check('the probe ran to the end', false, String(e));
		}
		await getUserStorage()
			.remove(DIR)
			.catch(() => {});
		say(!ran ? '\nNOT RUN HERE' : failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
		await getUserStorage().write(REPORT, lines.join('\n'));
		// the window-close half: a flusher that writes a marker, which only a flush on close can land
		await getUserStorage()
			.remove(CLOSE_MARKER)
			.catch(() => {});
		onBeforeReload(() => getUserStorage().write(CLOSE_MARKER, `flushed on close ${Date.now()}`));
		say('close the window now: the marker file proves the flush ran');
	});
</script>

<pre>{lines.join('\n')}</pre>
