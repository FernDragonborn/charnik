<script lang="ts">
	// DEV-ONLY LIVE PROBE — what script in the page can do to the updater.
	//
	// The app updates through two Rust commands that take nothing from the page
	// (`src-tauri/src/self_update.rs`), and the capability grants neither the updater plugin's own
	// commands nor the process plugin's. Both halves are a fact about the BUILT app — a capability
	// file and a handler list — so this asks the running webview, the way hostile script would: by
	// the raw IPC entry, with no wrapper to be polite on its behalf.
	//
	// It never installs anything: `install_app_update` is called only when the check found nothing,
	// where the answer is a refusal.
	import { onMount } from 'svelte';
	import { invokeRaw } from '../invoke-raw';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';

	const REPORT = 'self-update-probe.txt';
	/** Nothing listens here, so a check that honoured it could not reach the release endpoint. */
	const DEAD_PROXY = 'http://127.0.0.1:9';

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

	async function refused(what: string, command: string, args: Record<string, unknown> = {}) {
		const outcome = await invokeRaw(command, args);
		check(what, !outcome.resolved, outcome.resolved ? 'it answered' : outcome.reason);
	}

	onMount(async () => {
		try {
			await probe();
		} catch (e) {
			check('the probe ran to the end', false, String(e));
		}
		say(!ran ? '\nNOT RUN HERE' : failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
		await getUserStorage()
			.write(REPORT, lines.join('\n'))
			.catch((e: unknown) => say(`report not written: ${String(e)}`));
	});

	async function probe(): Promise<void> {
		say(`platform: ${detectPlatform()}`);
		if (detectPlatform() !== Platform.Desktop) {
			say('NOT the desktop app — the capability is the thing under test. Nothing run.');
			return;
		}
		ran = true;

		// --- 1. the plugins' own commands are not the page's to call --------------------------------
		await refused('the updater plugin’s check is refused', 'plugin:updater|check', {
			proxy: DEAD_PROXY,
			allowDowngrades: true,
		});
		await refused('…and its download-and-install', 'plugin:updater|download_and_install', {
			rid: 0,
		});
		// `exit` rather than `restart`: were it granted, a restart would land back on this page and
		// run it again, while an exit leaves no fresh report — which reads as the failure it is
		await refused('the process plugin’s exit is refused', 'plugin:process|exit', { code: 0 });

		// --- 2. the app's own check takes nothing from its caller -----------------------------------
		const found = await invokeRaw('check_app_update', {
			proxy: DEAD_PROXY,
			allowDowngrades: true,
			target: 'not-a-target',
		});
		check(
			'the app’s check answers, whatever arguments ride along',
			found.resolved && (found.value === null || typeof found.value === 'string'),
			found.resolved ? `found: ${String(found.value)}` : found.reason,
		);

		// --- 3. and an install has nothing to install until a check found something -----------------
		if (found.resolved && found.value === null)
			await refused('an install with nothing found is refused', 'install_app_update');
		else say('     install not driven: a real update is on offer, and this probe never installs');
	}
</script>

<h1>Dev · self-update probe</h1>
<p>Installs nothing. Report also written to <code>{REPORT}</code> in your data folder.</p>
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
