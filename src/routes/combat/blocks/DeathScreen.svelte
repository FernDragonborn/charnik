<script lang="ts">
	// The dead screen (UBUG-15): a modal that owns the sheet while `play.death` is set. Deliberately
	// NOT dismissable — no backdrop click, no Escape, no ✕ — because "dead" isn't a notice you wave off;
	// the only ways out are the two buttons. Reuses the shared DialogShell (omitting `onDismiss` is what
	// makes it must-acknowledge), so it renders identically to every other attention dialog.
	import { base } from '$app/paths';
	import DialogShell from '$lib/components/DialogShell.svelte';
	import { DEATH_CAUSE_LABEL } from '$lib/combat/helpers';
	import type { DeathCause } from '$lib/character/schema';
	import { combat } from '../combat-view-model.svelte';

	let { cause }: { cause: DeathCause } = $props();
</script>

<DialogShell
	titleId="death-title"
	title="You have died"
	subtitle={DEATH_CAUSE_LABEL[cause]}
	badge="skull"
	width="min(460px, calc(100vw - 2 * var(--space-4)))"
>
	<div class="body">
		<p class="line">
			The sheet stays exactly as it is — hit points, effects and the roll log are all still here.
			Nothing but a revival effect brings a character back, so this stays up until one does.
		</p>
	</div>
	<footer class="dialog-foot">
		<!-- the ONLY other way out: the nav is behind the backdrop, so without this a permanently dead
		     character would lock the player out of switching characters. -->
		<a class="btn ghost" href="{base}/">Back to the roster</a>
		<span class="dialog-spacer"></span>
		<button class="btn primary" onclick={combat.revive}>I was revived</button>
	</footer>
</DialogShell>

<style>
	/* Death gets a heavier backdrop than an ordinary review dialog — the sheet behind must read as
	   out of reach, not merely tinted. Scoped in time rather than in CSS: this rule only exists while
	   the component is mounted, i.e. exactly while the character is dead. */
	:global(.dialog-backdrop) {
		background: color-mix(in srgb, var(--color-overlay) 100%, black 45%);
	}
	.body {
		padding: var(--space-5) var(--space-6);
	}
	.line {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
