<script lang="ts">
	// Story notes: one bullet per line, plain text, saved onto the character. No parsing, no schema,
	// no mechanics — the sheet renders the lines as bullets and nothing else ever reads them.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	const b = build;

	/** Writing prompts, as catalog keys — a prompt only helps in a language you think in. */
	const PROMPT_KEYS = ['promptOwe', 'promptLeft', 'promptRecognise', 'promptRefuse'];
</script>

<p class="subtext">{$_('build.story.notesHint')}</p>

<label>
	<span class="visually-hidden">{$_('build.story.notesLabel')}</span>
	<textarea
		class="text-field notes"
		rows="10"
		placeholder={$_('build.story.notesPlaceholder')}
		bind:value={b.draft.notes}
	></textarea>
</label>

<div class="chips">
	{#each PROMPT_KEYS as key (key)}
		{@const prompt = $_(`build.story.${key}`)}
		<button
			class="pick-chip"
			onclick={() => (b.draft.notes = `${b.draft.notes.replace(/\n*$/, '')}\n${prompt} `.trimStart())}
		>
			{prompt}
		</button>
	{/each}
</div>

<style>
	.notes {
		width: 100%;
		resize: vertical;
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		line-height: 1.6;
	}
</style>
