<script lang="ts">
	// Attacks panel body: each weapon/attack row rolls to-hit (with adv/dis via modifier keys) and
	// shows damage + meta. Uses the shared global `.combat-row` layout — no scoped CSS.
	import { combat } from '../../state.svelte';
	import { signed } from '$lib/combat/helpers';
	const attacks = $derived(combat.attacks);
</script>

{#each attacks as at (at.name)}
	<!-- D9: at.note explains a magic weapon's own +X (already folded into toHit/dmg) on hover -->
	<button class="combat-row" title={at.note} onclick={(e) => combat.attackRoll(at, e)}>
		<span class="row-name">{at.name}</span><span class="combat-row-hint">{signed(at.toHit)}</span>
		<span class="combat-row-desc">{at.dmg}</span><span class="combat-row-marker">{at.meta}</span>
	</button>
{/each}
