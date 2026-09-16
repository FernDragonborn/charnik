<script lang="ts">
	// The dice-tray overlay (overlay.kind === 'dice') — the tray itself plus the readout under it.
	// Everything that used to be here (the pool chips, the dice grid, the advantage segments, the
	// modifier stepper, the read-only queued-damage line) is now the tray's two lines of pills, so
	// this file is the mount and the wiring: give the roller what the sheet knows it can be told by
	// name, and hand its completed rolls to the log.
	import Roller from '$lib/components/Roller.svelte';
	import { _ } from '$lib/i18n';
	import RollRow from '$lib/components/RollRow.svelte';
	import { rollToastModel } from '$lib/dice/roll-toast';
	import { rollerSources } from '$lib/dice/roller-sources';
	import { rollerCandidates } from '$lib/dice/roller-vocabulary';
	import { app } from '$lib/stores/app.svelte';
	import { content } from '$lib/content/store.svelte';
	import { combat } from '../combat-view-model.svelte';

	const diceTray = combat.journal.diceTray;
	const log = $derived(combat.journal.log);

	// the tray keeps the roll it was building between openings, but not a MENU that was open when it
	// closed — reopening onto a half-open type picker is a state nobody asked for
	diceTray.retyping = null;

	// what a line can be told BY NAME: the character's active effects first, then the effect catalog
	// and the damage types. Rebuilt from the graph, so a homebrew effect in a CSV is typeable with no
	// code change — and re-derived on a locale switch, because the menu shows names in the UI language.
	$effect(() => {
		diceTray.candidates = rollerCandidates(
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
	<Roller {diceTray} onroll={combat.recordTrayRolls} />
	<!-- the tray's own result readout: the same RollRow the toast and the log mount, so the roll you
	     just built reads identically to the roll you re-read later (UBUG-20) -->
	{#if log[0]}
		<div class="roll-history"><RollRow model={rollToastModel(log[0], $_)} /></div>
	{/if}
</div>

<style>
	/* what you are BUILDING and what you already ROLLED are two things, so they are two cards with a
	   gap — one continuous sheet made the Roll tab between them look like it was floating in the
	   middle of nothing. The gap is the room the tab hangs into (`.roller`'s own bottom margin). */
	.tray {
		display: flex;
		flex-direction: column;
		/* Room for the Roll tab, which hangs off the builder's bottom-right corner while the readout
		   sits beside it. Measured as the MAX over shipped locales, not guessed: English "Roll" reaches
		   82px in from the panel's right edge, Ukrainian «Кинути» reaches 103px — and the 90px this used
		   to be was chosen against the short one, so the readout sat on top of the button in Ukrainian.
		   Re-measure when a locale is added (`AGENTS.md` ▸ A locale is not free of layout consequences). */
		--roll-tab-reserve: 112px;
	}
	/* the readout sits BESIDE the Roll tab rather than under it: the tab hangs off the builder's bottom
	   edge on the right, so this only has to clear its column — and can then sit close under
	   the card instead of a whole tab-height away from it. The negative margin takes back most of the
	   room `.roller` reserves for the tab, which it still needs where nothing sits beside it. */
	.roll-history {
		/* positioned so it paints ABOVE the builder: `.roller-panel` is `position: relative` for its
		   Roll tab, and a positioned element paints over an unpositioned sibling whatever the order —
		   which dropped the builder's shadow across the readout that comes after it. */
		position: relative;
		margin-top: -30px;
		margin-inline-end: var(--roll-tab-reserve);
		padding: var(--space-1-5) var(--space-3) var(--space-2-5);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: 0 6px 18px var(--color-overlay);
	}
</style>
