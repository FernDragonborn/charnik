<script lang="ts">
	// A list of things the player simply TYPED — their table's own language, a trade no SRD lists.
	// Plain strings on the character, because neither languages nor tools feed any rule the app
	// computes; a content row for each would be machinery around a word (`work/ui.md`).
	//
	// The way out is the way in: every entry carries its own remove, so nothing typed here is
	// permanent (`AGENTS.md` ▸ Reverse states).
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';

	let {
		label,
		placeholder,
		entries = $bindable([]),
	}: { label: string; placeholder: string; entries: string[] } = $props();

	let typed = $state('');

	/** Trimmed, never blank, never a duplicate — the three ways a typed list turns to noise. */
	function add() {
		const name = typed.trim();
		if (!name || entries.includes(name)) {
			typed = '';
			return;
		}
		entries = [...entries, name];
		typed = '';
	}
</script>

<div class="own">
	<span class="eyebrow">{label}</span>
	<div class="chips tags">
		{#each entries as entry (entry)}
			<span class="tag muted">
				{entry}
				<button
					class="drop"
					aria-label={$_('build.own.remove', { values: { name: entry } })}
					onclick={() => (entries = entries.filter((e) => e !== entry))}
				>
					<Icon name="x" size={11} />
				</button>
			</span>
		{/each}
	</div>
	<!-- Enter adds, because a one-field form whose only button is "add" is a field you press Enter in -->
	<form
		onsubmit={(event) => {
			event.preventDefault();
			add();
		}}
	>
		<input bind:value={typed} {placeholder} aria-label={label} />
		<button class="pill-btn" type="submit" disabled={!typed.trim()}>{$_('build.own.add')}</button>
	</form>
</div>

<style>
	.own {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		padding-top: var(--space-2);
	}
	form {
		display: flex;
		gap: var(--space-2);
	}
	input {
		flex: 1;
		min-width: 0;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	/* the remove sits INSIDE the chip: the chip is the thing, and a delete column beside a list of
	   them would be a second thing to aim at for every row */
	.drop {
		display: flex;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.7;
	}
	.drop:hover {
		opacity: 1;
	}
</style>
