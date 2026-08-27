<script lang="ts">
	// Spells, per caster class, grouped by level, with the caps that decide whether you're finished.
	// Strict shows only what this character may legally take; Free lifts every gate. Search is here
	// because the SRD spell list is long enough that a wall of chips is unusable without it (N5·6).
	import { _ } from '$lib/i18n';
	import { build, rowName } from '../build-view-model.svelte';
	const b = build;

	let query = $state('');
	const match = (name: string) =>
		!query.trim() || name.toLowerCase().includes(query.trim().toLowerCase());
</script>

{#if b.spellPicker.length}
	<input class="text-field" placeholder={$_('build.spells.search')} bind:value={query} />

	{#each b.spellPicker as pc (pc.profile.classEffectiveId)}
		<div class="caster">
			<div class="card-head">
				<span class="eyebrow">{pc.profile.className}</span>
				<span class="spacer"></span>
				<span class="tag" class:accent={pc.cantripsChosen < pc.profile.cantripCap}>
					{$_('build.spells.cantrips', {
						values: { chosen: pc.cantripsChosen, cap: pc.profile.cantripCap }
					})}
				</span>
				<span class="tag" class:accent={pc.leveledChosen < pc.profile.preparedCap}>
					{$_(
						pc.profile.prepareStyle === 'known' ? 'build.spells.known' : 'build.spells.prepared',
						{ values: { chosen: pc.leveledChosen, cap: pc.profile.preparedCap } }
					)}
				</span>
			</div>

			{#each pc.groups as g (g.level)}
				{@const spells = g.spells.filter((s) => match(rowName(s)))}
				{#if spells.length}
					<div class="sectlab">
						<span
							>{g.level === 0
								? $_('build.spells.groupCantrips')
								: $_('build.spells.groupLevel', { values: { level: g.level } })}</span
						>
					</div>
					<div class="chips spaced">
						{#each spells as s (s.effectiveId)}
							<button
								class="pick-chip"
								class:on={b.draft.selectedSpells.includes(s.effectiveId)}
								onclick={() => b.toggleSpell(s.effectiveId)}>{rowName(s)}</button
							>
						{/each}
					</div>
				{/if}
			{/each}
		</div>
	{/each}
{:else if b.classRow}
	<p class="subtext">{$_('build.spells.noCasting', { values: { class: rowName(b.classRow) } })}</p>
{:else}
	<p class="subtext">{$_('build.spells.needClass')}</p>
{/if}

<style>
	.caster {
		display: flex;
		flex-direction: column;
		padding-top: 10px;
		border-top: 1px solid var(--color-border);
	}
	.caster:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
</style>
