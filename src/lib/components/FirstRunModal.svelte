<script lang="ts">
	// First-run, full-screen modal: asks WHERE to keep the user's data (characters + content) before
	// anything seeds to disk. Defaults to a visible ~/Documents/charnik; the user can point it at any
	// folder. Presentation only — the folder picker + fs-scope grant are injected so this previews in a
	// plain browser (see /dev/firstrun) and the Tauri wiring stays out of the component.
	import { untrack } from 'svelte';
	import LangSwitcher from './LangSwitcher.svelte';

	let {
		defaultDir,
		pickFolder,
		onConfirm
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
		} finally {
			busy = false;
		}
	}
</script>

<div class="dialog-backdrop"></div>
<div
	class="dialog first-run-dialog"
	role="dialog"
	aria-modal="true"
	aria-labelledby="fr-title"
	tabindex="-1"
>
	<header class="dialog-head">
		<div class="dialog-lang-corner"><LangSwitcher /></div>
		<span class="dialog-badge">📁</span>
		<h2 id="fr-title" class="dialog-title">Choose where Charnik keeps your data</h2>
		<p class="dialog-subtitle">
			Your characters and the SRD content live here as plain files you can open, edit, and back up
			any time. You can change this later in Settings.
		</p>
	</header>

	<div class="body">
		<span class="dialog-label section-label">Data folder</span>
		<div class="picker">
			<code class="path" title={dir}>{dir}</code>
			<button class="btn" onclick={choose} disabled={busy}>Choose folder…</button>
		</div>
		<p class="hint">A folder named <b>charnik</b> will be created here.</p>
	</div>

	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn primary" onclick={() => onConfirm(dir)} disabled={busy}>Save here</button>
	</footer>
</div>

<style>
	/* shared shell = global .dialog (styles/components.css); this only sets THIS dialog's width */
	.first-run-dialog {
		width: min(560px, calc(100vw - 2 * var(--space-4)));
	}
	.body {
		padding: var(--space-5) var(--space-6);
	}
	.section-label {
		display: block;
		margin-bottom: var(--space-2);
	}
	.picker {
		display: flex;
		gap: var(--space-3);
		align-items: stretch;
	}
	.path {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.hint {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	/* .dialog-* and .btn / .btn.primary are shared globals in styles/components.css */
</style>
