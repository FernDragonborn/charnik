<script lang="ts">
	// One player at the GM's table: the sheet their app shows, as a GM reads one across a table.
	// Every number is the player's own app's, trace included, so it explains itself on hover or
	// focus the way the player's sheet does — this app derives nothing of it.
	import Icon from '$lib/components/Icon.svelte';
	import { provenance } from '$lib/actions/provenance';
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { content } from '$lib/content/store.svelte';
	import { localizedName } from '$lib/content/detail';
	import { stateLabel } from '$lib/content/states';
	import { SKILL_IDS } from '$lib/character/skills';
	import { ABIL, metres, signed, titleCase, why } from '$lib/combat/helpers';
	import { DEATH_SAVE_TRACK } from '$lib/play/hit-points';
	import { systemShortLabel } from '$lib/rules/pipeline';
	import { abilityShortLabel } from '$lib/util/format';
	import type { SeatedPlayer } from './table-view-model.svelte';

	let { player, ondismiss }: { player: SeatedPlayer; ondismiss: () => void } = $props();

	const view = $derived(player.view);
	const PASSIVES = ['perception', 'investigation', 'insight'] as const;
	const SENSITIVITIES = ['resist', 'immune', 'vulnerable'] as const;

	const hpShare = $derived(
		view ? Math.max(0, Math.min(100, (view.hp.current / (view.hp.max || 1)) * 100)) : 0,
	);
	/** What 0 hit points means for this character right now, as a catalog key — or null above 0. */
	const downKey = $derived.by(() => {
		if (!view) return null;
		if (view.dead) return 'table.seat.dead';
		if (view.hp.current > 0) return null;
		return view.deathSaves.successes >= DEATH_SAVE_TRACK ? 'table.seat.stable' : 'table.seat.dying';
	});
	/** The spell concentrated on, by this app's own name for it; a ref it lacks reads as its id. */
	const concentration = $derived.by(() => {
		const ref = view?.concentration;
		if (!ref) return null;
		const row = content.graph?.get(ref);
		return row ? localizedName(row, app.activeLocale) : titleCase(ref.split(':').at(-1) ?? ref);
	});
	const conditionName = (id: string): string =>
		view && content.graph
			? stateLabel(content.graph, view.system, id, app.activeLocale)
			: titleCase(id);
</script>

<article class="card table-seat" class:is-away={!player.present} aria-label={player.name}>
	<header class="table-seat-head">
		<h3 class="table-seat-name">{view?.name ?? player.name}</h3>
		{#if view}
			<span class="muted">
				{$_('table.seat.level', { values: { level: view.level } })}
				<span class="table-seat-system">{systemShortLabel(view.system)}</span>
			</span>
		{/if}
		<span class="table-seat-spacer"></span>
		<button
			class="icon-button"
			title={$_('table.seat.dismiss', { values: { name: player.name } })}
			aria-label={$_('table.seat.dismiss', { values: { name: player.name } })}
			onclick={ondismiss}><Icon name="x" size={14} /></button
		>
	</header>

	{#if !player.present}
		<p class="table-seat-note">{$_('table.seat.away')}</p>
	{/if}

	{#if !view}
		<p class="muted">{$_('table.seat.noSheet')}</p>
	{:else}
		<div class="table-seat-hp">
			<span class="eyebrow">{$_('table.seat.hitPoints')}</span>
			<b class="table-seat-hp-value">{view.hp.current} / {view.hp.max}</b>
			{#if view.hp.temp > 0}
				<span class="table-seat-temp"
					>{$_('table.seat.temp', { values: { temp: view.hp.temp } })}</span
				>
			{/if}
			{#if downKey}
				<span class="table-seat-down">{$_(downKey, { values: view.deathSaves })}</span>
			{/if}
		</div>
		<div
			class="meter good"
			role="meter"
			aria-label={$_('table.seat.hitPoints')}
			aria-valuemin="0"
			aria-valuemax={view.hp.max}
			aria-valuenow={view.hp.current}
		>
			<span style="width: {hpShare}%"></span>
		</div>

		<dl class="table-seat-stats">
			<div use:provenance={why(view.ac, $_)}>
				<dt class="eyebrow">{$_('table.seat.ac')}</dt>
				<dd>{view.ac.value}</dd>
			</div>
			<div use:provenance={why(view.initiative, $_)}>
				<dt class="eyebrow">{$_('table.seat.initiative')}</dt>
				<dd>{signed(view.initiative.value)}</dd>
			</div>
			<div use:provenance={why(view.speed, $_)}>
				<dt class="eyebrow">{$_('table.seat.speed')}</dt>
				<dd>{view.speed.value} ft <small>({metres(view.speed.value)})</small></dd>
			</div>
			<div>
				<dt class="eyebrow">{$_('table.seat.proficiency')}</dt>
				<dd>{signed(view.proficiencyBonus)}</dd>
			</div>
		</dl>

		<div class="table-seat-row">
			<span class="eyebrow">{$_('table.seat.saves')}</span>
			{#each ABIL as ability (ability)}
				{@const save = view.abilities[ability]}
				<span
					class="table-seat-value"
					class:is-proficient={save.saveProficient}
					use:provenance={why(save.save, $_)}
					>{abilityShortLabel(ability, $_)} <b>{signed(save.save.value)}</b></span
				>
			{/each}
		</div>

		<div class="table-seat-row">
			<span class="eyebrow">{$_('table.seat.passives')}</span>
			{#each PASSIVES as skill (skill)}
				{@const passive = view.passives[skill]}
				{#if passive}
					<span class="table-seat-value" use:provenance={why(passive, $_)}
						>{$_(`skillName.${skill}`)} <b>{passive.value}</b></span
					>
				{/if}
			{/each}
		</div>

		<div class="table-seat-row">
			<span class="eyebrow">{$_('table.seat.states')}</span>
			{#each view.conditions as id (id)}
				<span class="durpill table-seat-state is-condition">{conditionName(id)}</span>
			{/each}
			{#each view.effects as label, index (index)}
				<span class="durpill table-seat-state">{label}</span>
			{/each}
			{#if view.exhaustion > 0}
				<span class="durpill table-seat-state is-condition"
					>{$_('table.seat.exhaustion', { values: { level: view.exhaustion } })}</span
				>
			{/if}
			{#if concentration}
				<span class="durpill table-seat-state"
					>{$_('table.seat.concentration')} · {concentration}</span
				>
			{/if}
			{#if !view.conditions.length && !view.effects.length && !view.exhaustion && !concentration}
				<span class="muted">{$_('table.seat.noStates')}</span>
			{/if}
		</div>

		{#each SENSITIVITIES as bucket (bucket)}
			{#if view.damageSensitivities[bucket].length}
				<div class="table-seat-row">
					<span class="eyebrow">{$_(`combat.sensitivity.${bucket}`)}</span>
					{#each view.damageSensitivities[bucket] as type (type)}
						<span class="durpill">{$_(`damageType.${type}`, { default: titleCase(type) })}</span>
					{/each}
				</div>
			{/if}
		{/each}

		<details class="table-seat-skills">
			<summary class="eyebrow">{$_('table.seat.skills')}</summary>
			<ul>
				{#each SKILL_IDS as skill (skill)}
					{@const check = view.skills[skill]}
					{#if check}
						<li use:provenance={why(check, $_)}>
							<span>{$_(`skillName.${skill}`)}</span>
							<b>{signed(check.value)}</b>
						</li>
					{/if}
				{/each}
			</ul>
		</details>
	{/if}
</article>

<style>
	.table-seat {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.table-seat.is-away {
		opacity: 0.6;
	}
	.table-seat-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.table-seat-name {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-h6);
		overflow-wrap: anywhere;
	}
	.table-seat-system {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1-5);
		margin-inline-start: var(--space-1);
	}
	.table-seat-spacer {
		flex: 1;
	}
	.table-seat-note {
		margin: 0;
		color: var(--color-warning);
		font-size: var(--font-size-sm);
	}
	.table-seat-hp {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.table-seat-hp-value {
		font-family: var(--font-display);
		font-size: var(--font-size-lg);
	}
	.table-seat-temp {
		color: var(--color-good);
		font-size: var(--font-size-sm);
	}
	.table-seat-down {
		color: var(--color-accent-bright);
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.table-seat-stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-2);
		margin: 0;
	}
	.table-seat-stats dd {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-md);
	}
	.table-seat-stats small {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.table-seat-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2-5);
		font-size: var(--font-size-sm);
	}
	.table-seat-row > .eyebrow {
		flex: none;
		min-width: 5.5em;
	}
	.table-seat-value {
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.table-seat-value b {
		color: var(--color-text);
	}
	.table-seat-value.is-proficient {
		color: var(--color-good);
	}
	.table-seat-state.is-condition {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.table-seat-skills summary {
		cursor: pointer;
	}
	.table-seat-skills ul {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		columns: 2;
		column-gap: var(--space-4);
		font-size: var(--font-size-sm);
	}
	.table-seat-skills li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		color: var(--color-text-muted);
	}
	.table-seat-skills li b {
		color: var(--color-text);
	}
</style>
