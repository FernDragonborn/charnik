<script lang="ts">
	// "Choose one content row" as the inspector asks it — species, lineage, background, class,
	// subclass, and a feat slot. A grid of every option with its own meta line, and what taking one
	// would do to the sheet underneath it.
	//
	// The article is not a third block down the column: it opens beside the grid, over the sheet,
	// where it costs this column no height and leaves the diff visible while you read (ui.md §8). It
	// is the SAME WikiDetail the compendium renders — one article renderer, never a builder-only
	// summary.
	//
	// Every pick target comes through here, feat slots included, so the diff's own rule — what it
	// WOULD do while you read, what it DID once you clicked — is stated once rather than per pane.
	import type { Snippet } from 'svelte';
	import { _ } from '$lib/i18n';
	import type { Inspector } from '../inspector.svelte';
	import OptionGrid from './OptionGrid.svelte';
	import ChangeList from './ChangeList.svelte';

	// `ins` is a prop rather than the singleton reached for, so /dev/inspector can render several
	// targets at once, each with its own Inspector over the same draft.
	let {
		ins,
		placeholder,
		extra,
	}: {
		ins: Inspector;
		placeholder?: string;
		/** Whatever the target owes once something is in it — a feat slot's own sub-choices. It goes
		 *  in the SAME scroll region as the options, because the pane gets exactly one. */
		extra?: Snippet;
	} = $props();
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
		placeholder={placeholder ??
			$_('build.inspector.searchIn', { values: { count: ins.pick.options.length } })}
	>
		<!-- Highlighting previews, so `changes` is still "what this WOULD do"; the card's take button
		     commits, so `applied` is "what that DID". Whichever is live is the one worth reading. -->
		{#snippet below()}
			{#if ins.changes}
				<ChangeList changes={ins.changes} />
			{:else}
				<ChangeList changes={ins.applied} taken />
			{/if}
			{#if extra}{@render extra()}{/if}
		{/snippet}
	</OptionGrid>
{/if}
