<script lang="ts">
	// The pencil's list: which motion the block plays at 0 hit points. A group of radios, so the
	// arrow keys walk it and the choice follows them — and since the block beside it is playing what
	// is chosen, walking the list IS looking through the motions.
	//
	// It never covers the block: the block is where the choice is seen.
	import { _ } from '$lib/i18n';
	import { provenance } from '$lib/actions/provenance';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { DOWN_MOTIONS, type DownMotion } from '$lib/character/schema';
	import { DEAR_MOTIONS } from './down-motions';

	let {
		chosen,
		reduced,
		under,
		onchoose,
		onclose,
	}: {
		chosen: DownMotion;
		/** Reduce motion is in force: the choice is kept, and nothing plays. */
		reduced: boolean;
		/** There is no room beside the block, so the list hangs under it. */
		under: boolean;
		onchoose: (motion: DownMotion) => void;
		onclose: () => void;
	} = $props();

	let list: HTMLElement | undefined = $state();
	// the keyboard starts on the choice already made
	$effect(() => list?.querySelector<HTMLInputElement>('input:checked')?.focus());
</script>

<div
	class="motion-menu"
	class:under
	bind:this={list}
	role="radiogroup"
	aria-label={$_('combat.hp.motionTitle')}
	use:dismissOnEscape={onclose}
>
	<div class="eyebrow">{$_('combat.hp.motionTitle')}</div>
	<div class="motion-rows">
		{#each DOWN_MOTIONS as motion (motion)}
			<label class="motion-row" class:on={motion === chosen}>
				<input
					type="radio"
					name="hp-down-motion"
					value={motion}
					checked={motion === chosen}
					onchange={() => onchoose(motion)}
				/>
				<span class="motion-name">{$_(`combat.hp.motion.${motion}`)}</span>
				{#if DEAR_MOTIONS.has(motion)}
					<span class="motion-dear" use:provenance={$_('combat.hp.motionDearHint')}
						>{$_('combat.hp.motionDear')}</span
					>
				{/if}
			</label>
		{/each}
	</div>
	{#if reduced}
		<p class="motion-note">{$_('combat.hp.motionReduced')}</p>
	{/if}
</div>

<style>
	.motion-menu {
		position: absolute;
		z-index: 3;
		top: 0;
		/* past the pencil's tab, so the block it changes stays in full view */
		inset-inline-end: calc(100% + 2rem);
		width: 13rem;
		padding: var(--space-2-5);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		background: var(--color-surface-2);
		box-shadow: var(--shadow-2);
		font-size: var(--font-size-xs);
	}
	.motion-rows {
		display: grid;
		margin-top: var(--space-1-5);
	}
	.motion-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-1-5);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.motion-row:hover,
	.motion-row.on {
		color: var(--color-text);
	}
	.motion-row.on {
		background: var(--color-surface);
	}
	.motion-row input {
		accent-color: var(--color-text);
		margin: 0;
	}
	.motion-name {
		flex: 1;
	}
	.motion-dear {
		padding: 0 var(--space-1);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.motion-note {
		margin: var(--space-1-5) 0 0;
		color: var(--color-text-muted);
	}
	/* with nothing beside the block the list hangs under it, in two columns to stay short */
	.motion-menu.under {
		top: calc(100% + var(--space-1));
		inset-inline: 0;
		width: auto;
	}
	.under .motion-rows {
		grid-auto-flow: column;
		grid-template-rows: repeat(4, auto);
		column-gap: var(--space-2);
	}
</style>
