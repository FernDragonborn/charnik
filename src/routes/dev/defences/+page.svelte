<script lang="ts">
	// DEV-ONLY: the defences card carrying every KIND of chip at once.
	//
	// Three of those kinds ship on eleven magic items and on nothing the demo character owns, so the
	// card rendered them zero times in every state the visual harness covers and nobody had ever
	// looked at them (DEFENCE-CHIPS-UNSEEN). This page is the state they were missing: one draft
	// wearing the items that grant a QUALIFIED defence ("+2 AC against ranged attacks"), an INCOMING
	// statement ("attacks against you have disadvantage") and a scoped one, so the kinds read side by
	// side and a regression in any of them is one screenshot away.
	//
	// The draft is written directly rather than through the inventory API, because each of these items
	// REQUIRES ATTUNEMENT to confer anything (derive-gather) and attuning is a play-sheet control â
	// the builder has none, which is the other half of why the card had never shown one of these.
	//
	// Not linked from the app; gated to dev builds by /dev/+layout.
	import { onMount } from 'svelte';
	import { build } from '../../build/build-view-model.svelte';
	import SheetDefenses from '../../build/blocks/SheetDefenses.svelte';
	import DefenseStrip from '$lib/components/DefenseStrip.svelte';
	import '$lib/styles/build.css';
	import { inventoryRow } from '$lib/character/schema';

	/** One item per chip kind, by the id its row has in the 2024 pack. An id the loaded content does
	 *  not have is SAID rather than skipped quietly â a thinner card would read as a regression. */
	const WANTED = [
		'arrow_catching_shield', // flat_bonus:ac.ranged+2 â a qualified BONUS
		'mantle_of_spell_resistance', // advantage:saves.spell â a qualified SWING
		'cloak_of_displacement', // disadvantage:attacked â an incoming statement
		'spellguard_shield', // disadvantage:attacked.spell â a SCOPED incoming statement
	];

	let missing = $state<string[]>([]);
	let ready = $state(false);

	onMount(async () => {
		await build.load();
		build.reset();
		build.draft.name = 'Defences Probe';
		build.draft.speciesId = build.speciesList[0]?.effectiveId ?? null;
		build.draft.backgroundId = build.backgroundList[0]?.effectiveId ?? null;
		build.classRows.setClass(0, build.classList[0]?.effectiveId ?? null);

		const byId = new Map(build.itemList.map((row) => [row.id, row.effectiveId]));
		const absent: string[] = [];
		build.draft.inventory = WANTED.flatMap((id) => {
			const ref = byId.get(id);
			if (ref === undefined) {
				absent.push(id);
				return [];
			}
			return [inventoryRow({ item: ref, qty: 1, equipped: true, attuned: true })];
		});
		missing = absent;
		ready = true;
	});
</script>

<div class="page build-page">
	<h1>Dev preview: every kind of defence chip</h1>
	<p class="hint">
		One draft wearing the items that grant a qualified defence, an incoming-attack statement and a
		scoped one. The question this page answers is whether the three read as different KINDS of
		statement rather than as three more resistances, and whether the strip wraps at 393px, where one
		chip is a whole sentence.
	</p>
	{#if missing.length}
		<p class="hint warn">Not in the loaded content, so not shown: {missing.join(', ')}</p>
	{/if}

	{#if ready}
		<SheetDefenses />
		<!-- the same strip at the width the play sheet gives it, where the groups run on one line -->
		{#if build.sheet}
			<div class="wide-strip">
				<DefenseStrip sheet={build.sheet} graph={build.graph} system={build.draft.system} />
			</div>
		{/if}
	{:else}
		<p class="loading">Loading content...</p>
	{/if}
</div>

<style>
	.page {
		padding: var(--space-4);
	}
	.hint {
		color: var(--color-text-dim);
		max-width: 70ch;
	}
	.warn {
		color: var(--color-accent);
	}
	.loading {
		color: var(--color-text-dim);
	}
	.wide-strip {
		container-type: inline-size;
		margin-top: var(--space-4);
		padding: var(--space-2-5) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
</style>
