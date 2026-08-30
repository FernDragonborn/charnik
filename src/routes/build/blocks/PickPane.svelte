<script lang="ts">
	// "Choose one content row" — species, lineage, background, class, subclass. A grid of every
	// option with its own meta line, and what taking one would do to the sheet underneath it.
	//
	// The article is not a third block down the column: it opens beside the grid, over the sheet,
	// where it costs this column no height and leaves the diff visible while you read (ui.md §8). It
	// is the SAME WikiDetail the compendium renders — one article renderer, never a builder-only
	// summary.
	import type { Inspector } from '../inspector.svelte';
	import { _ } from '$lib/i18n';
	import OptionGrid from './OptionGrid.svelte';
	import ChangeList from './ChangeList.svelte';

	// taken as a prop rather than reached for on the singleton, so /dev/inspector can render several
	// targets at once, each with its own Inspector over the same draft.
	let { ins }: { ins: Inspector } = $props();
</script>

{#if ins.pick}
	<OptionGrid
		options={ins.options}
		bind:query={ins.query}
		previewId={ins.previewId}
		takenIds={ins.pick.currentId ? [ins.pick.currentId] : []}
		onpreview={(id) => (ins.previewId = id)}
		ontake={ins.take}
		detail={ins.detail}
		placeholder={$_('build.inspector.searchIn', { values: { count: ins.pick.options.length } })}
	>
		<!-- Highlighting previews, so `changes` is still "what this WOULD do"; the card's take button
		     commits, so `applied` is "what that DID". Whichever is live is the one worth reading. -->
		{#snippet below()}
			{#if ins.changes.length}
				<ChangeList changes={ins.changes} />
			{:else}
				<ChangeList changes={ins.applied} taken />
			{/if}
		{/snippet}
	</OptionGrid>
{/if}
