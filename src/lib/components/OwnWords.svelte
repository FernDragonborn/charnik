<script lang="ts">
	// "Say it the way your table says it." Any article's description can be replaced with the
	// player's own prose, and put back. The content is never touched — this writes an override keyed
	// by the row (`content/overrides.svelte.ts`), which every surface that prints prose reads through.
	//
	// Scope is the one real choice: a rewrite belongs to the character you are playing by default, and
	// can be promoted to the whole install. The toggle only appears when a character is open, because
	// with none there is nothing for "just this one" to mean.
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { overrides, OVERRIDE_SCOPE, type OverrideScope } from '$lib/content/overrides.svelte';
	import Icon from './Icon.svelte';

	let {
		rowId,
		original,
		rewriting = $bindable(false),
	}: {
		rowId: string;
		original: string;
		/** Whether the editor is open, bound OUT so the surface can drop the rendered copy of this
		 *  prose while it is. Otherwise the same words stand twice — once read, once in the box. */
		rewriting?: boolean;
	} = $props();

	const locale = $derived(app.activeLocale);
	const mine = $derived(overrides.textFor(rowId, locale));
	const scope = $derived(overrides.scopeOf(rowId, locale));

	let text = $state('');
	/** Where a SAVE will put it. Seeded from where the words already live, so re-saving an install-wide
	 *  rewrite does not quietly demote it to this character. */
	let target = $state<OverrideScope>(OVERRIDE_SCOPE.character);

	/** Says both what the pencil does and, when a rewrite is in force, how far it reaches — the state
	 *  the old standing pill carried. The SCOPE word, not the in-use sentence: that one opened with
	 *  "your words", which `ownWords.edit` has already said. */
	const ownWordsLabel = $derived(
		mine
			? `${$_('ownWords.edit')} · ${$_(scope === OVERRIDE_SCOPE.install ? 'ownWords.scopeAll' : 'ownWords.scopeCharacter')}`
			: $_('ownWords.write'),
	);

	function open() {
		text = mine ?? original;
		target = scope ?? (overrides.hasCharacter ? OVERRIDE_SCOPE.character : OVERRIDE_SCOPE.install);
		rewriting = true;
	}
	function save() {
		// identical to the shipped words is not a rewrite — it is a restore that happens to be typed
		overrides.write(rowId, locale, text.trim() === original.trim() ? '' : text, target);
		rewriting = false;
	}
</script>

<div class="own-words">
	{#if rewriting}
		<textarea class="text-field own-body" bind:value={text} placeholder={original}></textarea>
		<div class="row">
			{#if overrides.hasCharacter}
				<!-- `accent` is the app's ONE "this control is on" modifier (components.css). `on` was
				     styled by nothing here, so the scope toggle changed the target and said nothing —
				     a control with no feedback reads as a broken one. -->
				<div class="scope" role="group" aria-label={$_('ownWords.scope')}>
					<button
						class="pill-btn"
						class:accent={target === OVERRIDE_SCOPE.character}
						aria-pressed={target === OVERRIDE_SCOPE.character}
						onclick={() => (target = OVERRIDE_SCOPE.character)}
						>{$_('ownWords.scopeCharacter')}</button
					>
					<button
						class="pill-btn"
						class:accent={target === OVERRIDE_SCOPE.install}
						aria-pressed={target === OVERRIDE_SCOPE.install}
						onclick={() => (target = OVERRIDE_SCOPE.install)}>{$_('ownWords.scopeAll')}</button
					>
				</div>
			{/if}
			<span class="spacer"></span>
			<!-- the three verbs are icons: the panel this opens in is a narrow column, and three worded
			     buttons beside the scope pills wrapped onto a second line there. Each keeps its word as
			     the title and the accessible name. -->
			{#if mine}
				<button
					class="icon-button"
					title={$_('ownWords.restore')}
					aria-label={$_('ownWords.restore')}
					onclick={() => {
						overrides.restore(rowId, locale);
						rewriting = false;
					}}><Icon name="rotate-ccw" size={14} /></button
				>
			{/if}
			<button
				class="icon-button"
				title={$_('app.cancel')}
				aria-label={$_('app.cancel')}
				onclick={() => (rewriting = false)}><Icon name="x" size={14} /></button
			>
			<button
				class="icon-button accent"
				title={$_('ownWords.save')}
				aria-label={$_('ownWords.save')}
				onclick={save}><Icon name="save" size={14} /></button
			>
		</div>
	{:else}
		<!-- one pencil at rest. The scope pills and the restore live INSIDE the editor: at rest they
		     were three controls and a sentence standing under every article for a thing most readers
		     never do. A rewrite in use accents the pencil and says so in its title, so the way back
		     out is one click from where the way in is. -->
		<button
			class="icon-button own-pencil"
			class:accent={!!mine}
			onclick={open}
			title={ownWordsLabel}
			aria-label={ownWordsLabel}><Icon name="pencil" size={13} /></button
		>
	{/if}
</div>

<style>
	/* FLOATED, and rendered before the prose: that puts it at the top-right of the TEXT it rewrites,
	   with the words wrapping around it rather than under it. Not the article's own corner — the
	   compendium's "Edit compendium" already owns that, and two pencils stacked there read as one
	   control that moved. */
	.own-pencil {
		float: inline-end;
		margin-inline-start: var(--space-2);
	}
	/* `accent` on an icon-button: the shared class carries the state everywhere else, and there is
	   no global rule for what it looks like on an icon, only on a pill */
	.row .icon-button.accent,
	.own-pencil.accent {
		color: var(--color-accent);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.spacer {
		flex: 1;
	}
	.scope {
		display: flex;
		gap: var(--space-1);
	}
	.own-body {
		width: 100%;
		min-height: 140px;
		resize: vertical;
		font-family: var(--font-body);
		font-size: var(--font-size-body);
		line-height: 1.5;
		padding: var(--space-2-5) var(--space-3);
		margin-bottom: var(--space-2);
	}
	.own-body:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
