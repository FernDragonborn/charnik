<script lang="ts">
	// Thin shell: state + logic live in ./state.svelte.ts (the `combat` view-model);
	// pure helpers in $lib/combat/helpers. Markup keeps bare names via reactive read-aliases;
	// writes/binds go through `combat.*`.
	import { onMount } from 'svelte';
	import { _ } from '$lib/i18n';
	import { dragHandleZone } from 'svelte-dnd-action';
	import { combat } from './combat-view-model.svelte';
	import { content } from '$lib/content/store.svelte';
	import { saveCharacterGuarded, saveCharacterToStore } from '$lib/character/store.svelte';
	import { deriveHealth } from '$lib/character/health.svelte';
	import { onBeforeReload } from '$lib/content/reload';
	import CombatMenus from './CombatMenus.svelte';
	import Hero from './blocks/Hero.svelte';
	import Controls from './blocks/Controls.svelte';
	import Turnbar from './blocks/Turnbar.svelte';
	import TimeSkip from './blocks/TimeSkip.svelte';
	import Playbar from './blocks/Playbar.svelte';
	import CombatStrip from './blocks/CombatStrip.svelte';
	import Abilities from './blocks/Abilities.svelte';
	import PanelCard from './blocks/PanelCard.svelte';
	import DeathScreen from './blocks/DeathScreen.svelte';
	import Loading from '$lib/components/Loading.svelte';
	import NoCharacter from '$lib/components/NoCharacter.svelte';

	// The page is a thin shell: it renders the area blocks and owns only the draggable panel grid
	// (which needs the dnd wiring). Everything else lives in the `combat` view-model + blocks/.
	const character = $derived(combat.character);
	const sheet = $derived(combat.sheet);
	// The sheet can't compute until content is loaded, so while the graph is still null the wait is
	// really about content, not the sheet — say so instead of the misleading "computing your sheet".
	const loadingMessage = $derived($_(content.graph ? 'loading.sheet' : 'loading.content'));
	const columns = $derived(combat.layout.columns);
	const flipDurationMs = combat.layout.flipDurationMs;
	const { dndConsider, dndFinalize } = combat.layout;

	onMount(combat.load);
	// D8: expose the rich combat tray through the DiceTrayRequest seam while this route is mounted,
	// so a generic RollButton in a panel opens the real tray (not the instant-roll fallback).
	onMount(combat.registerTray);

	// A14: when the effective max HP drops (an Aid / hp_max effect expired, or a manual max lowered),
	// pull current down to it. Idempotent, so it settles in one pass without looping the autosave.
	$effect(() => {
		combat.clampCurrentHp();
	});

	// …and the state that only means anything at 0 HP goes when HP does: the death-save track and
	// the "was it a critical?" answer, whichever way the hit points came back.
	$effect(() => {
		combat.syncDyingState();
	});

	// …and an owed concentration save goes with the concentration it was owed for, however that ended
	// (replaced by the next spell, a long rest, an expiring carrier).
	$effect(() => {
		combat.syncPendingConcentration();
	});

	// A conditional ability's window opening is a thing that HAPPENS, and the sheet is where it is
	// noticed — the panel already greys a closed one, but nothing said when it stopped being closed.
	$effect(() => {
		combat.resources.noticeOpenedWindows();
	});

	// CONCENTRATION-PLAN §7: reactively end concentration the instant HP hits 0 or an incapacitating
	// condition lands (RAW). Reads hp + economy.incapacitated → re-runs when either changes.
	$effect(() => {
		combat.endConcentrationIfBroken();
	});

	// autosave play-state edits back to storage (debounced), so combat persists per character
	let saveTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const c = combat.character;
		if (!c) return;
		// BUG-2: deep-track play AND ui AND build — combat mutates all three (togglePin/panelColumns →
		// c.ui, togglePrepared → c.build.spells), and saveCharacterToStore writes the whole character.
		// Tracking only c.play meant pin/prepared/layout edits never scheduled a save → lost on restart.
		JSON.stringify(c.play);
		JSON.stringify(c.ui);
		JSON.stringify(c.build);
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void saveCharacterGuarded(c), 800);
	});

	// flush the pending autosave before a manual refresh, so an unsaved edit survives the reload
	onMount(() =>
		onBeforeReload(async () => {
			clearTimeout(saveTimer);
			if (combat.character) await saveCharacterToStore(combat.character);
		}),
	);

	// Publish this character's derive-time issues to content-health (SPEC10). It must NOT clear on
	// unmount: the health panel lives in Settings — a different route — so wiping on leave meant these
	// issues could never actually be read. The next derive overwrites them, and the panel labels whose
	// character they belong to; only "no character at all" clears.
	$effect(() => {
		const c = combat.character;
		const s = combat.sheet;
		if (c && s) deriveHealth.set(c.build.name, s.deriveIssues);
		else deriveHealth.clear();
	});
</script>

<svelte:head><title>{$_('nav.combat')} — Charnik</title></svelte:head>

{#if combat.noCharacter}
	<NoCharacter />
{:else if !sheet || !character}
	<Loading message={loadingMessage} error={content.error} />
{:else}
	{@const s = sheet}
	{@const c = character}
	<Hero {c} {s} />

	<Controls {c} />

	<!-- the turn/time bar and the last-roll strip share ONE row: both are one-line status strips, and
	     stacked they left a wide empty band down the middle of an already-crowded screen -->
	<div class="statusrow">
		{#if c.play.inCombat}
			<Turnbar {c} />
		{:else}
			<TimeSkip />
		{/if}
		<Playbar />
	</div>

	<CombatStrip {s} />

	<Abilities {s} />

	<section class="panels">
		{#each columns as col, ci (ci)}
			<div
				class="panel-column"
				use:dragHandleZone={{
					items: col,
					type: 'panel',
					flipDurationMs,
					dropTargetStyle: {},
					// The floating card keeps the size it is given. Left on, the library resizes it into
					// whatever slot it is currently over — and these panels are wildly different heights, so
					// the background kept collapsing and re-growing under text that stayed put.
					morphDisabled: true,
					// …and what it is given is CAPPED: a full-height clone of Skills is taller than the
					// viewport, which made it impossible to aim, and a clone cut down to its title bar left
					// the question of what you were carrying unanswered. The class caps and fades it
					// (`styles/components.css`) — enough panel to recognise, never more than a hand carries.
					transformDraggedElement: (el) => el?.classList.add('dragging-panel'),
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
	{#if c.play.death}
		<DeathScreen cause={c.play.death.cause} />
	{/if}
{/if}

<style>
	/* one line: whichever bar is showing takes the space it needs, the last roll takes the rest */
	.statusrow {
		display: flex;
		align-items: stretch;
		flex-wrap: wrap;
		gap: var(--space-2-5);
		margin-bottom: 18px;
	}
	.statusrow > :global(:first-child:not(:last-child)) {
		flex: 1 1 320px;
	}
	/* .combat-bar carries its own 12px bottom margin for the stacked case; inside this row it would
	   end the bar's box 12px above the strip beside it and read as two different heights */
	.statusrow > :global(.combat-bar) {
		margin-bottom: 0;
	}
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
