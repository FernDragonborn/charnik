<script lang="ts">
	import Icon from './Icon.svelte';
	import { _ } from '$lib/i18n';
	// Multi-select for a spell's `classes` column: tick which EXISTING classes (pulled from the loaded
	// content) it's available to, and/or add a class that isn't in the CSVs by name. Existing classes are
	// stored by their id (so they resolve); a custom one is stored by its raw name (it won't resolve by
	// id — that's the accepted trade-off for content the user hasn't added as a class row). Reads the
	// comma-separated column string via `value`, reports edits via `onChange`.
	let {
		value,
		options,
		onChange,
	}: {
		/** the current `classes` column string (comma-separated). */
		value: string;
		/** the classes that exist in the content — { id, name } for the checklist. */
		options: { id: string; name: string }[];
		/** called with the new comma-separated value on any change. */
		onChange: (value: string) => void;
	} = $props();

	const tokens = $derived(
		value
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
	);
	const optionIds = $derived(new Set(options.map((o) => o.id)));
	// tokens that don't match any known class id = custom, user-typed class names
	const customTokens = $derived(tokens.filter((t) => !optionIds.has(t)));
	const has = (id: string) => tokens.includes(id);

	function setTokens(next: string[]) {
		onChange([...new Set(next)].join(','));
	}
	function toggle(id: string) {
		setTokens(has(id) ? tokens.filter((t) => t !== id) : [...tokens, id]);
	}
	function removeToken(t: string) {
		setTokens(tokens.filter((x) => x !== t));
	}

	let custom = $state('');
	function addCustom() {
		const name = custom.trim();
		if (name) setTokens([...tokens, name]);
		custom = '';
	}
</script>

<div class="class-picker">
	<div class="options">
		{#each options as o (o.id)}
			<button
				type="button"
				class="cls"
				class:on={has(o.id)}
				aria-pressed={has(o.id)}
				onclick={() => toggle(o.id)}
			>
				<span class="box"
					>{#if has(o.id)}<Icon name="check" size={12} />{/if}</span
				>{o.name}
			</button>
		{/each}
	</div>

	{#if customTokens.length}
		<div class="customs">
			{#each customTokens as t (t)}
				<span class="custom-chip">
					{t}
					<button
						type="button"
						class="rm"
						aria-label={$_('app.remove', { values: { name: t } })}
						onclick={() => removeToken(t)}><Icon name="x" size={11} /></button
					>
				</span>
			{/each}
		</div>
	{/if}

	<div class="add-row">
		<input
			class="add-input"
			placeholder={$_('homebrewForm.classPlaceholder')}
			bind:value={custom}
			onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
		/>
		<button type="button" class="add-btn" disabled={!custom.trim()} onclick={addCustom}
			>{$_('app.add')}</button
		>
	</div>
	<p class="hint">{$_('homebrewForm.classHint')}</p>
</div>

<style>
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
	.cls {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--font-size-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.cls:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.cls.on {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
		background: var(--color-accent-soft);
	}
	.cls .box {
		width: 14px;
		height: 14px;
		display: grid;
		place-items: center;
		font-size: var(--font-size-micro);
		border: 1px solid currentColor;
		border-radius: var(--radius-xs);
	}
	.customs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
		margin-top: var(--space-2);
	}
	.custom-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-full);
		padding: var(--space-1) var(--space-1-5) var(--space-1) var(--space-2-5);
		color: var(--color-text);
	}
	.custom-chip .rm {
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: var(--font-size-body);
		line-height: 1;
		padding: 0 2px;
	}
	.custom-chip .rm:hover {
		color: var(--color-accent-bright);
	}
	.add-row {
		display: flex;
		gap: var(--space-1-5);
		margin-top: var(--space-2);
	}
	.add-input {
		flex: 1;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-2-5);
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}
	.add-btn {
		font-size: var(--font-size-sm);
		font-weight: 600;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface-2);
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-3);
		color: var(--color-text);
		cursor: pointer;
	}
	.add-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: var(--space-2) 0 0;
	}
</style>
