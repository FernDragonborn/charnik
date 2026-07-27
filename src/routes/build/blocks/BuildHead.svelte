<script lang="ts">
	// Build page header: title, character-name input, ruleset (5e/5.5e) + enforcement (Strict/Free)
	// toggles. The `.segment-group` toggles are styled by the shared build.css (confined to .build-page).
	import { build } from '../state.svelte';
	const b = build;
</script>

<div class="boost-head">
	<h1>Build</h1>
	<label class="namewrap">
		<span class="visually-hidden">Character name</span>
		<input class="nameinput" placeholder="Name your character…" bind:value={b.draft.name} />
	</label>
	<span class="spacer"></span>
	<div class="segment-group" role="group" aria-label="Ruleset">
		<button class:on={b.draft.system === '5e'} onclick={() => (b.draft.system = '5e')}>5e</button>
		<button class:on={b.draft.system === '5.5e'} onclick={() => (b.draft.system = '5.5e')}>5.5e</button>
	</div>
	<div class="segment-group" role="group" aria-label="Enforcement">
		<button class:on={b.draft.strict} onclick={() => (b.draft.strict = true)} title="enforce rules">Strict</button>
		<button class:free={true} class:on={!b.draft.strict} onclick={() => (b.draft.strict = false)} title="change anything">Free</button>
	</div>
</div>

<style>
	/* `.visually-hidden` is the global screen-reader util in app.css — no local copy (C2). */
	.boost-head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		margin: 0;
	}
	.namewrap {
		flex: 1;
		min-width: 200px;
		max-width: 360px;
	}
	.nameinput {
		width: 100%;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-md);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 9px;
		padding: 9px 12px;
	}
	.nameinput:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.spacer {
		flex: 1;
	}
</style>
