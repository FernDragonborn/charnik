<script lang="ts">
	// DEV-ONLY LIVE PROBE — what script in the page can reach beyond the app's own window.
	//
	// Two facts about the BUILT app, so they are asked of the running webview the way hostile script
	// would ask: the dialog plugin's commands are not granted (its `open` and `save` would put any
	// folder the user is talked into picking into the fs scope), and no page gets a second window
	// (`lib.rs` ▸ `open_main_window`). Plus the layout's link handler, which must take a middle click
	// the way it takes a left one and leave a right click to the context menu.
	//
	// Nothing here opens a browser: the links use a scheme the app never hands to the OS, and the
	// window request is `about:blank`, which the Rust handler refuses without opening anything.
	import { onMount } from 'svelte';
	import { invokeRaw } from '../invoke-raw';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';

	const REPORT = 'page-reach-probe.txt';
	/** Cross-origin, so the layout cancels it; not http(s), so it is never handed to the OS. */
	const UNOPENABLE_LINK = 'ftp://example.invalid/probe';
	const MIDDLE_BUTTON = 1;
	const RIGHT_BUTTON = 2;

	let lines = $state<string[]>([]);
	let failures = $state(0);
	let ran = $state(false);
	let link = $state<HTMLAnchorElement | null>(null);
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

	/** Did the layout cancel this press on the probe link? */
	function cancels(type: string, button: number): boolean {
		const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
		link?.dispatchEvent(event);
		return event.defaultPrevented;
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

		// --- 1. the dialog plugin is not the page's ----------------------------------------------------
		// refused at the ACL, before any dialog is drawn — a granted one would wait here for a click
		await refused('the dialog plugin’s open is refused', 'plugin:dialog|open', {
			options: { directory: true, recursive: true },
		});
		await refused('…and its save', 'plugin:dialog|save', { options: {} });
		await refused('…and its message', 'plugin:dialog|message', { message: 'probe' });

		// --- 2. no second window --------------------------------------------------------------------------
		const opened = window.open('about:blank');
		check('window.open gets no window', opened === null, opened === null ? '' : 'a window opened');
		opened?.close();

		// --- 3. the link handler takes a middle click, and leaves a right click alone ---------------------
		check('a left click on an outside link is cancelled', cancels('click', 0));
		check('a middle click on it is cancelled too', cancels('auxclick', MIDDLE_BUTTON));
		check('a right click is left to the context menu', !cancels('auxclick', RIGHT_BUTTON));
	}
</script>

<h1>Dev · page-reach probe</h1>
<p>Opens nothing. Report also written to <code>{REPORT}</code> in your data folder.</p>
<!-- the subject of check 3; never clicked by a person -->
<a bind:this={link} href={UNOPENABLE_LINK}>probe link</a>
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
