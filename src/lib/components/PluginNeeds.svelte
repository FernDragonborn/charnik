<script lang="ts">
	// The plugins a sheet counts on and is not getting, said where the sheet is read. A plugin token
	// that does not resolve leaves the sheet standing and its numbers short, so the fact has to be
	// said beside those numbers, not three tabs away in content health. Renders nothing for a sheet
	// that needs none.
	import { base } from '$app/paths';
	import Icon from './Icon.svelte';
	import { _ } from '$lib/i18n';
	import { plugins } from '$lib/effects/plugin-store.svelte';
	import { pluginNeeds } from '$lib/effects/plugin-needs';
	import type { EffectIssue } from '$lib/effects/token-parser';

	let { issues }: { issues: readonly EffectIssue[] } = $props();
	const needs = $derived(pluginNeeds(issues, plugins));
</script>

{#if needs.length}
	<div class="plugin-needs" role="status">
		<Icon name="triangle-alert" size={13} />
		<div class="said">
			<span>{$_('settings.plugins.needs.title', { values: { count: needs.length } })}:</span>
			{#each needs as need (need.namespace)}
				<span class="need"
					><b>{need.name}</b> — {$_(`settings.plugins.needs.state.${need.state}`)}</span
				>
			{/each}
		</div>
		<!-- where plugins do not run there is nothing in Settings to do about it -->
		{#if plugins.supported}
			<a class="pill-btn" href="{base}/settings?tab=plugins">{$_('settings.plugins.needs.open')}</a>
		{/if}
	</div>
{/if}

<style>
	.plugin-needs {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-warning);
		border-radius: var(--radius);
		color: var(--color-warning);
		font-size: var(--font-size-sm);
	}
	.said {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
	}
	.need {
		color: var(--color-text);
	}
	.pill-btn {
		flex: none;
	}
</style>
