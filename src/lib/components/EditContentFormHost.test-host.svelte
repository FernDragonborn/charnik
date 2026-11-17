<script lang="ts">
	// The compendium's shape around the form: `onsave` flips the `{#if}` that holds it, so the form is
	// torn down by its parent's block in the next flush — not by an `unmount()` that flushes it first.
	import EditContentForm from './EditContentForm.svelte';

	let { onsave }: { onsave: (id: string) => void } = $props();
	let open = $state(true);
</script>

{#if open}
	<EditContentForm
		type="language"
		resumeDraft={{ systems: '5e' }}
		onsave={(id) => {
			open = false;
			onsave(id);
		}}
		oncancel={() => (open = false)}
	/>
{/if}
