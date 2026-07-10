<script lang="ts">
	// The article title field shown in edit/translate mode. Extracted because every article head
	// (species, class, spell, monster, …) needs the exact same display-font input bound to the draft
	// name — keeping it in one place stops the identical input + styles being re-declared per head and
	// keeps the editable title visually uniform across article types. The read-only `<h1>` stays in each
	// head, since its margins depend on that head's own layout.
	let {
		value = $bindable(''),
		placeholder
	}: {
		value?: string;
		/** Shown when the name is empty — the article's display title, so an untranslated entry still
		 *  reads as itself instead of a blank box. */
		placeholder: string;
	} = $props();
</script>

<input class="edit-title" bind:value {placeholder} />

<style>
	.edit-title {
		width: 100%;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 28px;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		color: var(--color-text);
		padding: 4px 10px;
		margin: 4px 0 12px;
	}
	.edit-title:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
