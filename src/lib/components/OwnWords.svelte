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

	let { rowId, original }: { rowId: string; original: string } = $props();

	const locale = $derived(app.activeLocale);
	const mine = $derived(overrides.textFor(rowId, locale));
	const scope = $derived(overrides.scopeOf(rowId, locale));

	let editing = $state(false);
	let text = $state('');
	/** Where a SAVE will put it. Seeded from where the words already live, so re-saving an install-wide
	 *  rewrite does not quietly demote it to this character. */
	let target = $state<OverrideScope>(OVERRIDE_SCOPE.character);

	function open() {
		text = mine ?? original;
		target = scope ?? (overrides.hasCharacter ? OVERRIDE_SCOPE.character : OVERRIDE_SCOPE.install);
		editing = true;
	}
	function save() {
		// identical to the shipped words is not a rewrite — it is a restore that happens to be typed
		overrides.write(rowId, locale, text.trim() === original.trim() ? '' : text, target);
		editing = false;
	}
</script>

<div class="own-words">
	{#if editing}
		<textarea class="text-field own-body" bind:value={text} placeholder={original}></textarea>
		<div class="row">
			{#if overrides.hasCharacter}
				<div class="scope" role="group" aria-label={$_('ownWords.scope')}>
					<button
						class="pill-btn"
						class:on={target === OVERRIDE_SCOPE.character}
						aria-pressed={target === OVERRIDE_SCOPE.character}
						onclick={() => (target = OVERRIDE_SCOPE.character)}
						>{$_('ownWords.scopeCharacter')}</button
					>
					<button
						class="pill-btn"
						class:on={target === OVERRIDE_SCOPE.install}
						aria-pressed={target === OVERRIDE_SCOPE.install}
						onclick={() => (target = OVERRIDE_SCOPE.install)}>{$_('ownWords.scopeAll')}</button
					>
				</div>
			{/if}
			<span class="spacer"></span>
			<button class="hb-btn" onclick={() => (editing = false)}>{$_('app.cancel')}</button>
			<button class="hb-btn primary" onclick={save}>{$_('ownWords.save')}</button>
		</div>
	{:else}
		<div class="row">
			<button class="hb-btn" onclick={open}>
				<Icon name="pencil" size={12} />
				{$_(mine ? 'ownWords.edit' : 'ownWords.write')}
			</button>
			{#if mine}
				<span class="durpill"
					>{$_(
						scope === OVERRIDE_SCOPE.install ? 'ownWords.inUseAll' : 'ownWords.inUseCharacter',
					)}</span
				>
				<span class="spacer"></span>
				<button class="hb-btn" onclick={() => overrides.restore(rowId, locale)}
					>{$_('ownWords.restore')}</button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.own-words {
		margin-top: var(--space-2-5);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
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
