<script lang="ts">
	// The dice tray (overlay.kind === 'dice') — the roller ORGAN plus the readout under it. Everything
	// that used to be here (the pool chips, the dice grid, the advantage segments, the modifier
	// stepper, the read-only queued-damage line) is now the organ's two lines of pills, so this file
	// is the mount and the wiring: give the roller what the sheet knows it can be told by name, and
	// hand its completed rolls to the log.
	import Roller from '$lib/components/Roller.svelte';
	import RollRow from '$lib/components/RollRow.svelte';
	import { rollToastModel } from '$lib/dice/roll-toast';
	import { rollerSources } from '$lib/dice/roller-sources';
	import { rollerCandidates } from '$lib/dice/roller-vocabulary';
	import { app } from '$lib/stores/app.svelte';
	import { content } from '$lib/content/store.svelte';
	import { combat } from '../combat-view-model.svelte';

	const organ = combat.tray.organ;
	const log = $derived(combat.tray.log);

	// the tray keeps the roll it was building between openings, but not a MENU that was open when it
	// closed — reopening onto a half-open type picker is a state nobody asked for
	organ.retyping = null;

	// what a line can be told BY NAME: the character's active effects first, then the effect catalog
	// and the damage types. Rebuilt from the graph, so a homebrew effect in a CSV is typeable with no
	// code change — and re-derived on a locale switch, because the menu shows names in the UI language.
	$effect(() => {
		organ.candidates = rollerCandidates(
			rollerSources(
				content.graph,
				combat.character?.system,
				(combat.character?.play.effects ?? []).map((e) => ({
					label: e.label,
					effects: e.effects,
				})),
			),
			app.activeLocale,
		);
	});
</script>

<div class="tray">
	<Roller {organ} onroll={combat.tray.recordRolls} />
	<!-- the tray's own result readout: the same RollRow the toast and the log mount, so the roll you
	     just built reads identically to the roll you re-read later (UBUG-20) -->
	{#if log[0]}
		<div class="roll-history"><RollRow model={rollToastModel(log[0])} /></div>
	{/if}
</div>

<style>
	.tray {
		padding: 12px;
	}
	/* the readout, ruled off from the builder above it */
	.roll-history {
		border-top: 1px solid var(--color-border);
		margin: 10px -12px -12px;
		padding-top: 3px;
	}
</style>
