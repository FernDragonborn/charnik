<script lang="ts">
	// Attacks panel body: each weapon/attack row rolls to-hit (with adv/dis via modifier keys) and
	// shows damage + meta. Uses the shared global `.combat-row` layout — no scoped CSS.
	import { _ } from '$lib/i18n';
	import { combat } from '../../combat-view-model.svelte';
	import { signed } from '$lib/combat/helpers';
	import { attackMeta, attackName, attackNotes, formatDamageParts } from '$lib/combat/attacks';
	import { why } from '$lib/combat/helpers';
	import { provenance } from '$lib/actions/provenance';
	const attacks = $derived(combat.attacks);
	// one Attack action, N attacks — a property of the character, so it is stated once above the
	// rows rather than repeated on each. Silent at one, which is everybody without the feature.
	const perAction = $derived(combat.sheet?.attacksPerAction);
</script>

{#if perAction && perAction.value > 1}
	<div class="eyebrow" use:provenance={why(perAction, $_)}>
		{$_('combat.attacksPerAction', { values: { count: perAction.value } })}
	</div>
{/if}

{#each attacks as at, i (`${at.id}-${i}`)}
	<!-- D9: the notes explain a magic weapon's own +X (already folded into toHit/damage) on hover -->
	<button
		class="combat-row"
		title={attackNotes(at, $_) || undefined}
		onclick={(e) => combat.attackRoll(at, e)}
	>
		<span class="row-name">{attackName(at, $_)}</span><span class="combat-row-hint"
			>{signed(at.toHit)}</span
		>
		<span class="combat-row-desc">{formatDamageParts(at.damageParts, $_)}</span><span
			class="combat-row-marker">{attackMeta(at, $_)}</span
		>
	</button>
{/each}
