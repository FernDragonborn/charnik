<script lang="ts">
	// The `upcast` cell, built rather than typed. An author who knows their spell gains a d6 per slot
	// should not have to know that this is spelled `damage:per_slot(1d6)` — but what lands in the CSV
	// IS that string, because the file and the form must never hold two names for one fact.
	//
	// It WRITES the token and hands it to the field beside it, which stays editable: the grammar is
	// wider than the two shapes here (a `step()` ladder, a typed sub-slot, a guard), so the builder
	// covers what an author reaches for and never becomes the only way in.
	import { _ } from '$lib/i18n';
	import Icon from './Icon.svelte';
	import { UPCAST_KINDS, parseUpcast } from '$lib/effects/upcast';

	// `string | undefined` because a draft cell is a partial record read under
	// `noUncheckedIndexedAccess` — the cell may simply not be there yet, and saying so is the honest
	// type rather than making every caller invent an empty string.
	let { value = $bindable('') }: { value?: string | undefined } = $props();

	/** The two shapes the grammar says simply. `perSlot` is a DELTA added for every slot above the
	 *  spell's own level; `total` is the whole value at the slot cast from — which is what a count or
	 *  a duration is, since neither has a structured base to add onto. */
	const SHAPES = ['perSlot', 'total'] as const;
	type Shape = (typeof SHAPES)[number];

	let kind = $state<string>('damage');
	let shape = $state<Shape>('perSlot');
	let amount = $state('');

	/** The token this would write — shown BEFORE it is added, because seeing `damage:per_slot(1d6)`
	 *  is what teaches the grammar the raw field also accepts. */
	const token = $derived(
		amount.trim()
			? `${kind}:${shape === 'perSlot' ? `per_slot(${amount.trim()})` : `slot+${amount.trim()}`}`
			: '',
	);
	/** Why the token cannot be added, in the reader's language — read off the SAME parser the loader
	 *  uses, so the form can never offer a token the app would refuse. */
	const problem = $derived.by(() => {
		if (!token) return '';
		const parsed = parseUpcast(token)[0];
		return parsed && 'error' in parsed ? $_('homebrewForm.upcastRefused') : '';
	});

	function add() {
		if (!token || problem) return;
		const cell = (value ?? '').trim();
		value = cell ? `${cell}; ${token}` : token;
		amount = '';
	}
</script>

<div class="upcast-builder">
	<span class="ub-label">{$_('homebrewForm.upcastBuild')}</span>
	<select bind:value={kind} aria-label={$_('homebrewForm.upcastKind')}>
		{#each UPCAST_KINDS as k (k)}
			<option value={k}>{$_(`upcastKind.${k}`, { default: k.replace(/_/g, ' ') })}</option>
		{/each}
	</select>
	<select bind:value={shape} aria-label={$_('homebrewForm.upcastShape')}>
		{#each SHAPES as s (s)}
			<option value={s}>{$_(`homebrewForm.upcastShape_${s}`)}</option>
		{/each}
	</select>
	<input
		bind:value={amount}
		placeholder={$_('homebrewForm.upcastAmount')}
		aria-label={$_('homebrewForm.upcastAmount')}
	/>
	<button type="button" class="pill-btn" disabled={!token || !!problem} onclick={add}>
		<Icon name="plus" size={12} />
		{$_('homebrewForm.upcastAdd')}
	</button>
	{#if token}
		<code class="ub-preview" class:bad={!!problem}>{token}</code>
	{/if}
	{#if problem}<span class="ub-problem">{problem}</span>{/if}
</div>

<style>
	.upcast-builder {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
		margin-top: var(--space-1-5);
	}
	.ub-label {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}
	.upcast-builder input {
		width: 8ch;
	}
	.ub-preview {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.ub-preview.bad {
		color: var(--color-accent-bright);
	}
	.ub-problem {
		font-size: var(--font-size-micro);
		color: var(--color-accent-bright);
	}
</style>
