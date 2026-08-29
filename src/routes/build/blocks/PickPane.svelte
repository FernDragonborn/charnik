<script lang="ts">
	// "Choose one content row" — species, lineage, background, class, subclass. Search the list,
	// highlight an option, read its compendium article (the SAME WikiDetail the compendium renders —
	// one article renderer, never a builder-only summary), and see what it would do to the sheet.
	import { _ } from '$lib/i18n';
	import type { Inspector } from '../inspector.svelte';
	import WikiDetail from '$lib/components/WikiDetail.svelte';
	import OptionList from './OptionList.svelte';
	import ChangeList from './ChangeList.svelte';

	// taken as a prop rather than reached for on the singleton, so /dev/inspector can render several
	// targets at once, each with its own Inspector over the same draft.
	let { ins }: { ins: Inspector } = $props();
</script>

{#if ins.pick}
	<OptionList
		options={ins.options}
		bind:query={ins.query}
		previewId={ins.previewId}
		takenIds={ins.pick.currentId ? [ins.pick.currentId] : []}
		onpreview={(id) => (ins.previewId = id)}
		onactivate={ins.take}
		placeholder={$_('build.inspector.searchIn', { values: { count: ins.pick.options.length } })}
	/>

	<!-- ↑/↓ preview, so `changes` is still "what this WOULD do"; a click commits, so `applied` is
	     "what that DID". Whichever of the two is live is the one worth reading. -->
	{#if ins.changes.length}
		<ChangeList changes={ins.changes} />
	{:else}
		<ChangeList changes={ins.applied} taken />
	{/if}

	{#if ins.detail}
		<div class="article">
			<WikiDetail detail={ins.detail} />
		</div>
	{:else}
		<p class="subtext">{$_('build.inspector.highlightToRead')}</p>
	{/if}
{/if}

