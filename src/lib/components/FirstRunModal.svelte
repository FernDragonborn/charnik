<script lang="ts">
	// First-run, full-screen modal: asks WHERE to keep the user's data (characters + content) before
	// anything seeds to disk. Defaults to a visible ~/Documents/charnik; the user can point it at any
	// folder. Presentation only — the folder picker + fs-scope grant are injected so this previews in a
	// plain browser (see /dev/firstrun) and the Tauri wiring stays out of the component.
	import { untrack } from 'svelte';
	import DialogShell from './DialogShell.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { toastFailure } from '#lib/toast/toast.ts';

	let {
		defaultDir,
		pickFolder,
		onConfirm,
	}: {
		/** The suggested data dir (…/Documents/charnik) shown pre-selected. */
		defaultDir: string;
		/** Open the OS folder picker; resolves to a chosen PARENT dir, or null if cancelled. */
		pickFolder: () => Promise<string | null>;
		/** User accepted this data dir — persist it, grant scope, then seed + continue. */
		onConfirm: (dir: string) => void;
	} = $props();

	// initialised once from the prop, then user-editable via the picker
	let dir = $state(untrack(() => defaultDir));
	let busy = $state(false);

	// join a picked parent with our folder name, tolerating either path separator
	function withCharnik(parent: string): string {
		const sep = parent.includes('\\') ? '\\' : '/';
		return `${parent.replace(/[\\/]+$/, '')}${sep}charnik`;
	}

	async function choose() {
		busy = true;
		try {
			const parent = await pickFolder();
			if (parent) dir = withCharnik(parent);
		} catch (e) {
			toastFailure($_('app.actionFailed'), e);
		} finally {
			busy = false;
		}
	}
</script>

<!-- no way out but its own button: nothing seeds to disk before a folder is chosen -->
<DialogShell
	titleId="fr-title"
	title={$_('firstRun.title')}
	sub={dir}
	subIsPath
	subtitle={$_('firstRun.subtitle')}
	width="min(560px, calc(100vw - 2 * var(--space-4)))"
>
	<p class="hint">{$_('firstRun.hint')}</p>
	<footer class="dialog-foot">
		<button class="btn" onclick={choose} disabled={busy}>{$_('firstRun.choose')}</button>
		<span class="dialog-spacer"></span>
		<button class="btn primary" onclick={() => onConfirm(dir)} disabled={busy}
			>{$_('firstRun.save')}</button
		>
	</footer>
</DialogShell>

<style>
	.hint {
		margin: 0;
		padding: 0 var(--space-6);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
