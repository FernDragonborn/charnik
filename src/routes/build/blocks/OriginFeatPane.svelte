<script lang="ts">
	// The 5.5e origin feat. GRANTED by the background, never chosen — so this is not a picker: there
	// is no list, nothing to take, and no way to clear it (change the background instead). What it is
	// still worth opening for is the article, and the choices the feat itself asks back.
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	import { rowDetail } from '../rows';
	import { ORIGIN_SLOT_KEY } from '../draft';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import FeatSubChoices from './FeatSubChoices.svelte';
	const b = build;

	const ref = $derived(b.feats.originFeatRef);
	const detail = $derived(rowDetail(b.row(ref), 'feat'));
</script>

{#if !ref}
	<p class="subtext">{$_('build.feats.noOriginFeat')}</p>
{:else}
	<div class="granted">
		<span class="tag gold">{$_('build.feats.origin')}</span>
		<b>{rowName(b.row(ref))}</b>
	</div>
	<FeatSubChoices choiceKey={ORIGIN_SLOT_KEY} />
	<WikiDetail {detail} />
{/if}

<style>
	.granted {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: none;
	}
	.granted b {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
</style>
