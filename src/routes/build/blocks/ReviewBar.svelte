<script lang="ts">
	// The bottom of the sheet: what is still open, and the one button that turns a draft into a
	// character. Each unfinished line is a LINK to the control that fixes it — a list of complaints
	// you can't act on is just nagging.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	const b = build;

	// the parent owns navigation-on-save (goto Combat); this bar just triggers it.
	let { create }: { create: () => void } = $props();
</script>

<div class="card review" class:ready={b.canCreate}>
	<div class="left">
		{#if b.blocking.length}
			<span class="eyebrow"
				>{$_('build.review.stillToDo', { values: { count: b.blocking.length } })}</span
			>
			<div class="todos">
				{#each b.blocking as todo (todo.key + JSON.stringify(todo.values ?? {}))}
					{@const target = b.todoTarget(todo)}
					{@const text = $_(`build.todo.${todo.key}`, { values: todo.values })}
					{#if target}
						<button class="pill-btn todo" onclick={() => b.inspector.open(target)}>{text}</button>
					{:else}
						<span class="pill-btn todo static">{text}</span>
					{/if}
				{/each}
			</div>
		{:else}
			<span class="eyebrow ready-label">{$_('build.review.ready')}</span>
			<p class="subtext">{$_('build.review.readyBody')}</p>
		{/if}
		{#if b.sheet?.missing.length}
			<p class="subtext warn">
				{$_('build.review.missingContent', { values: { list: b.sheet.missing.join(', ') } })}
			</p>
		{/if}
	</div>

	<button class="create" disabled={!b.canCreate || b.saving} onclick={create}>
		{#if b.saving}
			{$_('build.review.saving')}
		{:else}
			<Icon name="sparkles" size={13} />
			{$_(b.edit ? 'build.review.save' : 'build.review.create')}
		{/if}
	</button>
</div>

<style>
	.review {
		display: flex;
		align-items: flex-start;
		gap: 18px;
		margin-top: var(--space-1);
		border-color: var(--color-accent-deep);
		background: linear-gradient(180deg, var(--color-accent-soft), var(--color-surface));
	}
	.review.ready {
		border-color: var(--color-good);
		background: linear-gradient(180deg, var(--color-good-soft), var(--color-surface));
	}
	.left {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.ready-label {
		color: var(--color-good);
	}
	.todos {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
	.todo {
		border-color: var(--color-accent-deep);
		color: var(--color-accent-bright);
	}
	.todo:hover {
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
	}
	.todo.static {
		cursor: default;
	}
	.todo.static:hover {
		background: transparent;
	}
	.create {
		flex: none;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: var(--color-accent-text);
		border-radius: var(--radius);
		padding: var(--space-2-5) 20px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
	}
	.create:hover:not(:disabled) {
		background: var(--color-accent);
	}
	.create:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.create:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}

	@media (max-width: 700px) {
		.review {
			flex-direction: column;
		}
	}
</style>
