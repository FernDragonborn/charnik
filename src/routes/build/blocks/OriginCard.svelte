<script lang="ts">
	// Origin card: species (+ sub-option / lineage) + background pickers. Creation-only (the mock
	// edits an existing sheet, so it has no picker). All styling is shared build.css (.field/select).
	import { build, rowName } from '../state.svelte';
	const b = build;
</script>

<div class="card">
	<h2>Origin</h2>
	<label class="field">
		<span>Species</span>
		<select
			value={b.draft.speciesId ?? ''}
			onchange={(e) => b.pickSpecies(e.currentTarget.value || null)}
		>
			<option value="">— choose —</option>
			{#each b.speciesList as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
		</select>
	</label>
	{#if b.speciesOptions.length}
		<label class="field">
			<span>{b.speciesOptionLabel}</span>
			<select bind:value={b.draft.speciesOptionId}>
				<option value={null}>— choose —</option>
				{#each b.speciesOptions as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
			</select>
		</label>
	{/if}
	<label class="field">
		<span>Background</span>
		<select bind:value={b.draft.backgroundId}>
			<option value={null}>— choose —</option>
			{#each b.backgroundList as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
		</select>
	</label>
</div>
