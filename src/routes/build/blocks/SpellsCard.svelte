<script lang="ts">
	// Spells card: per-caster-class spell picker (single-class collapses to one section). Strict =
	// only legally-takeable spells within the cantrip/prepared caps; Free lifts every gate.
	import { build, rowName } from '../state.svelte';
	const b = build;
</script>

<div class="card">
	<h2>Spells <span class="count teal">{b.draft.selectedSpells.length}</span></h2>
	{#if b.spellPicker.length}
		<p class="subtext">
			{b.draft.strict ? 'Only spells you can legally take' : 'Free mode — every spell'} · refine
			prepared/known in the <b>Spellbook</b> after creating.
		</p>
		{#each b.spellPicker as pc (pc.profile.classEffectiveId)}
			{#if b.spellPicker.length > 1}
				<p class="subtext subgroup">
					{pc.profile.className} — cantrips <b class="teal">{pc.cantripsChosen}/{pc.profile.cantripCap}</b>
					· prepared <b class="gold">{pc.leveledChosen}/{pc.profile.preparedCap}</b>
				</p>
			{:else}
				<p class="subtext">
					Cantrips <b class="teal">{pc.cantripsChosen}/{pc.profile.cantripCap}</b> · prepared
					<b class="gold">{pc.leveledChosen}/{pc.profile.preparedCap}</b>
				</p>
			{/if}
			{#each pc.groups as g (g.level)}
				<p class="subtext subgroup">{g.label}</p>
				<div class="chips spaced">
					{#each g.spells as s (s.effectiveId)}
						<button
							class="pick-chip"
							class:on={b.draft.selectedSpells.includes(s.effectiveId)}
							onclick={() => b.toggleSpell(s.effectiveId)}
						>
							{rowName(s)}
						</button>
					{/each}
				</div>
			{/each}
		{/each}
	{:else if b.classRow}
		<p class="subtext">{rowName(b.classRow)} has no innate spellcasting.</p>
	{:else}
		<p class="subtext">Pick a class to see spellcasting.</p>
	{/if}
</div>
