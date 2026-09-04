<script lang="ts">
	// Attacks panel body: each weapon/attack row rolls to-hit (with adv/dis via modifier keys) and
	// shows damage + meta. Uses the shared global `.combat-row` layout — no scoped CSS.
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { signed } from '$lib/combat/helpers';
	import { attackName, formatDamageParts } from '$lib/combat/attacks';
	const attacks = $derived(combat.attacks);
</script>

{#each attacks as at, i (`${at.id}-${i}`)}
	<!-- D9: at.note explains a magic weapon's own +X (already folded into toHit/dmg) on hover -->
	<button class="combat-row" title={at.note} onclick={(e) => combat.attackRoll(at, e)}>
		<span class="row-name">{attackName(at, $_)}</span><span class="combat-row-hint"
			>{signed(at.toHit)}</span
		>
		<span class="combat-row-desc">{formatDamageParts(at.damageParts, $_)}</span><span
			class="combat-row-marker">{at.meta}</span
		>
	</button>
{/each}
