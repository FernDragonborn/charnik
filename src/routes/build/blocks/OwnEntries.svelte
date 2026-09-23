<script lang="ts">
	// A list of things the player simply TYPED — their table's own language, a trade no SRD lists.
	// Plain strings on the character, because neither languages nor tools feed any rule the app
	// computes; a content row for each would be machinery around a word (`work/ui.md`).
	//
	// Adding one is the LAST CHIP in the row, not a field beside it: a standing text input says a
	// list is a form to be filled, when almost every character types nothing here at all. Pressed, the
	// chip becomes the input in place, so the control is where the result will appear.
	//
	// The way out is the way in: every entry carries its own remove, so nothing typed here is
	// permanent (`AGENTS.md` ▸ Reverse states).
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';

	let {
		label,
		placeholder,
		entries = $bindable([]),
	}: { label: string; placeholder: string; entries: string[] } = $props();

	let typing = $state(false);
	let typed = $state('');

	/** Trimmed, never blank, never a duplicate — the three ways a typed list turns to noise. */
	function add() {
		const name = typed.trim();
		if (name && !entries.includes(name)) entries = [...entries, name];
		typed = '';
	}
	/** Leaving keeps whatever was typed rather than dropping it — a half-typed word lost to a stray
	 *  click is the kind of thing nobody reports and everybody resents. */
	function addAndClose() {
		add();
		typing = false;
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
		{#if typing}
			<!-- autofocus: the press that mounts this input IS the request to type in it -->
			<input
				class="own-input"
				autofocus
				bind:value={typed}
				{placeholder}
				aria-label={label}
				onblur={addAndClose}
				onkeydown={(event) => {
					if (event.key !== 'Enter') return;
					// Enter keeps the field open: someone adding one language usually adds two
					event.preventDefault();
					add();
				}}
				use:dismissOnEscape={() => {
					typed = '';
					typing = false;
				}}
			/>
		{:else}
			<button class="pill-btn" onclick={() => (typing = true)}
				><Icon name="plus" size={12} /> {$_('build.own.add')}</button
			>
		{/if}
	</div>
</div>

<style>
	.own {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		padding-top: var(--space-2);
	}
	/* sized like the chip it replaces, and it grows with what is typed rather than standing at form
	   width in a row of short words */
	.own-input {
		min-width: 8rem;
		max-width: 100%;
		field-sizing: content;
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
