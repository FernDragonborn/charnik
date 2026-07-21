<script lang="ts">
	// Thin shell: state + logic live in ./state.svelte.ts (the `combat` view-model);
	// pure helpers in $lib/combat/helpers. Markup keeps bare names via reactive read-aliases;
	// writes/binds go through `combat.*`.
	import { onMount } from 'svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { combat } from './state.svelte';
	import { content } from '$lib/content/store.svelte';
	import { saveCharacterToStore } from '$lib/character/store.svelte';
	import { deriveHealth } from '$lib/character/health.svelte';
	import { onBeforeReload } from '$lib/content/reload';
	import CombatMenus from './CombatMenus.svelte';
	import Hero from './blocks/Hero.svelte';
	import Controls from './blocks/Controls.svelte';
	import Turnbar from './blocks/Turnbar.svelte';
	import ResourceBar from './blocks/ResourceBar.svelte';
	import Playbar from './blocks/Playbar.svelte';
	import CombatStrip from './blocks/CombatStrip.svelte';
	import Abilities from './blocks/Abilities.svelte';
	import PanelCard from './blocks/PanelCard.svelte';
	import Loading from '$lib/components/Loading.svelte';

	// The page is a thin shell: it renders the area blocks and owns only the draggable panel grid
	// (which needs the dnd wiring). Everything else lives in the `combat` view-model + blocks/.
	const character = $derived(combat.character);
	const sheet = $derived(combat.sheet);
	// The sheet can't compute until content is loaded, so while the graph is still null the wait is
	// really about content, not the sheet — say so instead of the misleading "computing your sheet".
	const loadingMessage = $derived(
		content.graph ? 'Computing your character sheet…' : 'Loading content…'
	);
	const columns = $derived(combat.layout.columns);
	const flipDurationMs = combat.layout.flipDurationMs;
	const dragDisabled = $derived(combat.layout.dragDisabled);
	const { dndConsider, dndFinalize, releaseDrag } = combat.layout;

	onMount(combat.load);
	// D8: expose the rich combat tray through the DiceTrayRequest seam while this route is mounted,
	// so a generic RollButton in a panel opens the real tray (not the instant-roll fallback).
	onMount(combat.registerTray);

	// A14: when the effective max HP drops (an Aid / hp_max effect expired, or a manual max lowered),
	// pull current down to it. Idempotent, so it settles in one pass without looping the autosave.
	$effect(() => {
		combat.clampCurrentHp();
	});

	// autosave play-state edits back to storage (debounced), so combat persists per character
	let saveTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const c = combat.character;
		if (!c) return;
		JSON.stringify(c.play); // deep-track play changes
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void saveCharacterToStore(c), 800);
	});

	// flush the pending autosave before a manual refresh, so an unsaved edit survives the reload
	onMount(() =>
		onBeforeReload(async () => {
			clearTimeout(saveTimer);
			if (combat.character) await saveCharacterToStore(combat.character);
		})
	);

	// publish this character's derive-time issues to content-health (SPEC10); cleared on leave
	$effect(() => {
		const c = combat.character;
		const s = combat.sheet;
		if (c && s) deriveHealth.set(c.build.name, s.deriveIssues);
		return () => deriveHealth.clear();
	});
</script>

<svelte:head><title>Combat — Charnik</title></svelte:head>
<svelte:window onpointerup={releaseDrag} />

{#if !sheet || !character}
	<Loading message={loadingMessage} error={content.error} />
{:else}
	{@const s = sheet}
	{@const c = character}
	<Hero {c} {s} />

	<Controls {c} />

	{#if c.play.inCombat}
		<Turnbar {c} />
	{/if}

	{#if s.resources.length}
		<ResourceBar {s} />
	{/if}

	<Playbar />

	<CombatStrip {s} />

	<Abilities {s} />

	<section class="panels">
		{#each columns as col, ci (ci)}
			<div
				class="panel-column"
				use:dndzone={{
					items: col,
					type: 'panel',
					dragDisabled,
					flipDurationMs,
					dropTargetStyle: {}
				}}
				onconsider={(e) => dndConsider(ci, e)}
				onfinalize={(e) => dndFinalize(ci, e)}
			>
				{#each col as item (item.id)}
					<div class="card"><PanelCard pid={item.id} {c} {s} /></div>
				{/each}
			</div>
		{/each}
	</section>
	<CombatMenus />
{/if}

<style>
	/* Two flex columns (not multicol): drag-safe with svelte-dnd-action, packs tight
	   top-to-bottom so a block's height never bumps another into the next column. */
	.panels {
		display: flex;
		gap: 18px;
		align-items: stretch;
	}
	/* stretch + min-height so the whole column (incl. empty tail below the last card)
	   is inside the dndzone → a panel can be dropped anywhere in the other column. */
	.panel-column {
		flex: 1;
		min-width: 0;
		min-height: 160px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	@media (max-width: 760px) {
		.panels {
			flex-direction: column;
		}
	}
</style>
