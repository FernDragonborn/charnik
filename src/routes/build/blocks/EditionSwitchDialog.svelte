<script lang="ts">
	// "Switching to 5.5e will drop these" — the confirmation the ruleset toggle owes, because the
	// picks the other edition has no row for cannot survive the switch and cannot be seen after it.
	// Presentation only: what is lost is computed by the view-model, and the switch is its method.
	import { _ } from '$lib/i18n';
	import DialogShell from '$lib/components/DialogShell.svelte';
	import type { ContentType } from '$lib/content/schemas';

	let {
		system,
		losing,
		onConfirm,
		onCancel,
	}: {
		system: string;
		/** Every pick the target edition has no row for, in the order the draft holds them. */
		losing: { type: ContentType; ref: string; name: string }[];
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<DialogShell
	titleId="edition-switch-title"
	title={$_('build.edition.title', { values: { system } })}
	subtitle={$_('build.edition.subtitle', { values: { count: losing.length } })}
	width="min(560px, calc(100vw - 2 * var(--space-4)))"
	onDismiss={onCancel}
>
	<div class="dialog-body">
		<ul class="losing">
			{#each losing as pick (pick.ref)}
				<li>
					<span class="pname">{pick.name}</span>
					<span class="dialog-label">{$_(`contentType.${pick.type}`, { default: pick.type })}</span>
				</li>
			{/each}
		</ul>
	</div>

	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onCancel}>{$_('build.edition.keep')}</button>
		<button class="btn primary" onclick={onConfirm}
			>{$_('build.edition.switch', { values: { system } })}</button
		>
	</footer>
</DialogShell>

<style>
	.losing {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.losing li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
	}
	.pname {
		font-family: var(--font-display);
		font-weight: 600;
	}
</style>
