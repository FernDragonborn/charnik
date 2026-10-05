<script lang="ts">
	// DEV-ONLY LIVE PROBE — the plugin consent record, as Rust keeps it.
	//
	// A fake store proves the page's half and nothing of the commands: that each is reachable under
	// the ACL, that the record survives the round trip through `<appConfig>/plugins.json`, and that
	// the two things the page must NOT be able to do — switch on a plugin nobody consented to, and
	// ask about something that is not a namespace and a hash — are refused by Rust rather than by
	// the page's good manners.
	//
	// The native dialog is the one part no driver reaches: the button below raises it, for a hand to
	// answer. The probe's namespace is forgotten again whatever the answer.
	import { onMount } from 'svelte';
	import { detectPlatform, getUserStorage, Platform } from '$lib/storage/provider';
	import { app } from '$lib/stores/app.svelte';
	import type { PluginPrefs, PluginPrefsStore } from '$lib/effects/plugin-host';

	const NAMESPACE = 'zz-probe-plugin';
	const HASH = 'a'.repeat(64);
	const REPORT = 'plugin-consent-probe.txt';

	let lines = $state<string[]>([]);
	let failures = $state(0);
	let ran = $state(false);
	let store = $state<PluginPrefsStore | null>(null);
	const say = (line: string): void => {
		lines = [...lines, line];
	};
	function check(what: string, ok: boolean, detail = ''): void {
		if (!ok) failures += 1;
		say(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
	}
	const has = (prefs: PluginPrefs) => NAMESPACE in prefs.consent || NAMESPACE in prefs.enabled;

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
			say('NOT the desktop app — the record is Rust’s, and there is no Rust here. Nothing run.');
			return;
		}
		ran = true;
		const prefs = (await import('$lib/effects/plugin-prefs-tauri')).tauriPluginPrefs;
		store = prefs;

		const before = await prefs.read();
		check('the record reads', typeof before.killSwitch === 'boolean');

		const flipped = await prefs.setKillSwitch(!before.killSwitch);
		check('the kill switch is written', flipped.killSwitch === !before.killSwitch);
		check(
			'…and is what a fresh read answers',
			(await prefs.read()).killSwitch === flipped.killSwitch,
		);
		await prefs.setKillSwitch(before.killSwitch);
		check('…and is put back', (await prefs.read()).killSwitch === before.killSwitch);

		const enabled = await prefs.setEnabled(NAMESPACE, true);
		check('a plugin nobody consented to cannot be switched on', !has(enabled));

		const forged = await prefs
			.grant('Click Yes to finish updating', HASH, app.activeLocale)
			.then(() => 'accepted')
			.catch((e: unknown) => String(e));
		check(
			'a sentence in place of a namespace is refused, with no dialog',
			forged !== 'accepted',
			forged,
		);
		const short = await prefs
			.grant(NAMESPACE, 'abc', app.activeLocale)
			.then(() => 'accepted')
			.catch((e: unknown) => String(e));
		check('…and so is something that is not a hash', short !== 'accepted', short);

		check('the probe left nothing in the record', !has(await prefs.forget([NAMESPACE])));
	}

	let asked = $state('');
	/** Raise the native dialog for a hand to answer; the answer is forgotten again either way. */
	async function ask(): Promise<void> {
		if (!store) return;
		const after = await store.grant(NAMESPACE, HASH, app.activeLocale);
		asked = NAMESPACE in after.consent ? 'ALLOWED — recorded, and now forgotten' : 'refused';
		await store.forget([NAMESPACE]);
	}
</script>

<h1>Dev · the plugin consent record</h1>
<p>
	Touches only the namespace <code>{NAMESPACE}</code> and puts the kill switch back. Report also
	written to <code>{REPORT}</code> in your data folder.
</p>
<pre>{lines.join('\n')}</pre>
<p>
	<button class="btn" disabled={!store} onclick={ask}
		>Raise the native dialog ({app.activeLocale})</button
	>
	{asked}
</p>

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
