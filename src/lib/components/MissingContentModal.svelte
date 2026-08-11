<script lang="ts">
	// The rules are gone (REL-4). A bundled content pack the app ships is not on disk — almost always
	// because it was uninstalled, which is allowed and sticks by design. What must NOT happen is the
	// user meeting that decision as a compendium full of nothing, so it is said once, at launch, with
	// the undo attached.
	//
	// No `onDismiss`: no backdrop click, no Escape. Not to trap anyone — both answers are one click,
	// and one of them is "I meant it, stop asking" — but because a stray click dismissing the only
	// offer to put your rules back is the exact outcome this exists to prevent.
	import { _ } from '$lib/i18n';
	import DialogShell from './DialogShell.svelte';
	import { keepMissingPacks, missingBundled } from '$lib/content/packs.svelte';
	import { restoreBundledPacks } from '$lib/content/provider';
	import { reloadContent } from '$lib/content/store.svelte';

	let busy = $state(false);

	async function restore() {
		busy = true;
		try {
			await restoreBundledPacks(missingBundled.packs);
			missingBundled.packs = [];
			await reloadContent();
		} finally {
			busy = false;
		}
	}
</script>

<DialogShell
	titleId="missing-content-title"
	title={$_('missingContent.title')}
	subtitle={$_('missingContent.subtitle', { values: { packs: missingBundled.packs.join(', ') } })}
	width="min(560px, calc(100vw - 2 * var(--space-4)))"
>
	<div class="dialog-body">
		<p>{$_('missingContent.body')}</p>
	</div>
	<footer class="dialog-foot">
		<button
			class="btn ghost"
			disabled={busy}
			onclick={() => keepMissingPacks(missingBundled.packs)}
		>
			{$_('missingContent.keepDeleted')}
		</button>
		<span class="dialog-spacer"></span>
		<button class="btn primary" disabled={busy} onclick={restore}>
			{busy ? $_('missingContent.restoring') : $_('missingContent.restore')}
		</button>
	</footer>
</DialogShell>

<style>
	p {
		margin: 0;
		line-height: 1.5;
	}
</style>
