<script lang="ts">
	// "Which one?" for an item the book prints once: the weapon a template is, the +N a `+1/+2/+3`
	// row is, the kind a ring or a belt is. Asked as the item is ADDED, beside the ✓ that took it, so
	// the inventory gets the one instance rather than the heading with its questions left on the row,
	// and asked AGAIN from the carried row's own name, holding its answers, which is the way back
	// from a misclick. Nothing is written until every question it asks is answered; Escape or a press
	// elsewhere writes nothing.
	import { onMount, untrack } from 'svelte';
	import { _ } from '$lib/i18n';
	import { anchored } from '$lib/actions/anchored';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { submitOnEnter } from '$lib/actions/submitOnEnter';
	import type { InstanceAnswers } from '$lib/content/item-instance';
	import { damageTypeLabel } from '$lib/combat/attacks';
	import type { InstanceAsk } from '../item-instance-picking.svelte';

	let {
		ask,
		onanswer,
		oncancel,
	}: { ask: InstanceAsk; onanswer: (answers: InstanceAnswers) => void; oncancel: () => void } =
		$props();

	let surface = $state<HTMLDivElement>();
	// the answers it is opened with: none at Add, the row's own when asked again from it
	// one popover per question: it is mounted for an ask and gone with it, so the opening answers are
	// read once
	let base = $state(untrack(() => ask.current?.base ?? ''));
	let bonus = $state<number | undefined>(untrack(() => ask.current?.bonus));
	let choice = $state(untrack(() => ask.current?.choice ?? ''));

	/** A mundane item's question has one more answer than a +N row's: none — the plain item. */
	const PLAIN = 0;
	const ready = $derived(
		(!ask.questions.bases.length || base !== '') &&
			(!ask.questions.rungs.length || bonus !== undefined) &&
			(!ask.questions.choices.length || choice !== ''),
	);
	const add = () => {
		if (!ready) return;
		onanswer({
			...(base ? { base } : {}),
			...(bonus === undefined || bonus === PLAIN ? {} : { bonus }),
			...(choice ? { choice } : {}),
		});
	};

	onMount(() => {
		surface?.querySelector<HTMLElement>('select, button')?.focus();
		return () => ask.anchor.focus();
	});
</script>

<div
	bind:this={surface}
	class="instance-ask"
	role="dialog"
	aria-labelledby="instance-ask-title"
	use:anchored={{ anchor: ask.anchor, onclose: oncancel }}
	use:dismissOnEscape={oncancel}
	use:submitOnEnter={ready ? add : undefined}
>
	<h3 id="instance-ask-title">{$_('build.inventory.whichOne', { values: { name: ask.name } })}</h3>
	{#if ask.questions.bases.length}
		<label class="field">
			<span class="eyebrow">{$_('build.inventory.whichBase')}</span>
			<select bind:value={base}>
				<option value="" disabled>{$_('combat.inventory.baseItemNone')}</option>
				{#each ask.questions.bases as option (option.ref)}
					<option value={option.ref}>{option.name}</option>
				{/each}
			</select>
		</label>
	{/if}
	{#if ask.questions.rungs.length}
		<div class="field" role="radiogroup" aria-label={$_('build.inventory.whichBonus')}>
			<span class="eyebrow">{$_('build.inventory.whichBonus')}</span>
			<div class="rungs">
				{#if ask.upgrade}
					<button
						type="button"
						class="pill-btn"
						class:accent={bonus === PLAIN}
						role="radio"
						aria-checked={bonus === PLAIN}
						onclick={() => (bonus = PLAIN)}>{$_('build.inventory.plain')}</button
					>
				{/if}
				{#each ask.questions.rungs as rung (rung.bonus)}
					<button
						type="button"
						class="pill-btn"
						class:accent={bonus === rung.bonus}
						role="radio"
						aria-checked={bonus === rung.bonus}
						onclick={() => (bonus = rung.bonus)}
						>+{rung.bonus}{#if rung.rarity}<small
								>{$_(`itemRarity.${rung.rarity}`, { default: rung.rarity })}</small
							>{/if}</button
					>
				{/each}
			</div>
		</div>
	{/if}
	{#if ask.questions.choices.length}
		<label class="field">
			<span class="eyebrow">{$_('build.inventory.whichKind')}</span>
			<select bind:value={choice}>
				<option value="" disabled>{$_('combat.inventory.choiceNone')}</option>
				{#each ask.questions.choices as option (option.id)}
					<option value={option.id}
						>{#if option.name && option.rarity}{$_('combat.inventory.varietyWithRarity', {
								values: {
									name: option.name,
									rarity: $_(`itemRarity.${option.rarity}`, { default: option.rarity }),
								},
							})}{:else}{option.name ?? damageTypeLabel(option.id, $_)}{/if}</option
					>
				{/each}
			</select>
		</label>
	{/if}
	<div class="actions">
		<button type="button" class="pill-btn" onclick={oncancel}>{$_('build.inventory.askCancel')}</button>
		<button type="button" class="pill-btn accent" disabled={!ready} onclick={add}
			>{$_(ask.current ? 'build.inventory.askSave' : 'build.inventory.askAdd')}</button
		>
	</div>
</div>

<style>
	.instance-ask {
		position: fixed;
		z-index: 62;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: min(18rem, calc(100vw - 2 * var(--space-4)));
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
	}
	h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-sm);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.rungs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
	.rungs small {
		margin-inline-start: var(--space-1);
		font-weight: 400;
		opacity: 0.8;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-1-5);
	}
</style>
