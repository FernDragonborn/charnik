<script lang="ts">
	// The GM's one composer for asking the table something: who, what, and the few numbers and ids
	// that "what" needs. A request is built from closed choices — an ability, a skill, a damage
	// type, a state this app's content has — because that is all a request may carry.
	import Switch from '$lib/components/Switch.svelte';
	import { DAMAGE_TYPES } from '$lib/components/damage-glyphs';
	import { provenance } from '$lib/actions/provenance';
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { content } from '$lib/content/store.svelte';
	import { localizedName } from '$lib/content/detail';
	import { addableStateRows } from '$lib/content/states';
	import { SKILL_IDS, type SkillId } from '$lib/character/skills';
	import { ABIL, titleCase } from '$lib/combat/helpers';
	import type { Ability } from '$lib/rules/core';
	import {
		REQUESTED_ROLL,
		TABLE_REQUEST,
		type RequestedRoll,
		type TableRequest,
	} from '$lib/table-link/types';
	import { table, type SeatedPlayer } from './table-view-model.svelte';

	let { players }: { players: SeatedPlayer[] } = $props();

	type AskKind = TableRequest['kind'];
	const KINDS: AskKind[] = [
		TABLE_REQUEST.roll,
		TABLE_REQUEST.damage,
		TABLE_REQUEST.heal,
		TABLE_REQUEST.effect,
	];
	const ROLL_KINDS: RequestedRoll[] = [
		REQUESTED_ROLL.savingThrow,
		REQUESTED_ROLL.abilityCheck,
		REQUESTED_ROLL.skill,
	];
	const AMOUNT_MAX = 100_000;
	const DC_MAX = 99;
	const UNTYPED = '';

	// --- who ---------------------------------------------------------------------------------------
	const present = $derived(players.filter((player) => player.present));
	let everyone = $state(true);
	let picked = $state<string[]>([]);
	const targets = $derived(
		everyone ? present : present.filter((player) => picked.includes(player.id)),
	);
	function pick(id: string): void {
		everyone = false;
		picked = picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id];
	}

	// --- what --------------------------------------------------------------------------------------
	let kind = $state<AskKind>(TABLE_REQUEST.roll);
	let rollKind = $state<RequestedRoll>(REQUESTED_ROLL.savingThrow);
	let ability = $state<Ability>('dex');
	let skill = $state<SkillId>('perception');
	/** Empty is no DC: the roll is asked for and judged by eye. */
	let dc = $state<number | null>(null);
	let announce = $state(false);
	let amount = $state(1);
	let damageType = $state(UNTYPED);
	let stateId = $state('');

	/** The states the players asked can take: every one their editions' content offers, once. */
	const stateOptions = $derived.by(() => {
		const graph = content.graph;
		if (!graph) return [];
		const seated = targets.flatMap((player) => (player.view ? [player.view.system] : []));
		const systems = new Set(seated.length ? seated : app.activeEditions);
		const names = new Map<string, string>();
		for (const system of systems)
			for (const row of addableStateRows(graph, system))
				if (!names.has(row.id)) names.set(row.id, localizedName(row, app.activeLocale));
		return [...names]
			.map(([id, label]) => ({ id, label }))
			.sort((a, b) => a.label.localeCompare(b.label, app.activeLocale));
	});
	const chosenState = $derived(
		stateOptions.some((option) => option.id === stateId) ? stateId : (stateOptions[0]?.id ?? ''),
	);

	const whole = (value: number, max: number): number =>
		Math.max(0, Math.min(max, Math.round(Number.isFinite(value) ? value : 0)));
	const heldTo = $derived(dc === null ? undefined : whole(dc, DC_MAX));

	const request = $derived.by<TableRequest | null>(() => {
		switch (kind) {
			case TABLE_REQUEST.roll:
				return {
					kind,
					roll: rollKind,
					id: rollKind === REQUESTED_ROLL.skill ? skill : ability,
					...(announce && heldTo !== undefined ? { dc: heldTo } : {}),
				};
			case TABLE_REQUEST.damage:
				return {
					kind,
					amount: whole(amount, AMOUNT_MAX),
					type: damageType === UNTYPED ? null : damageType,
				};
			case TABLE_REQUEST.heal:
				return { kind, amount: whole(amount, AMOUNT_MAX) };
			case TABLE_REQUEST.effect:
				return chosenState ? { kind, id: chosenState } : null;
		}
	});
	const askable = $derived(!!request && targets.length > 0);

	function send(): void {
		if (!request || !targets.length) return;
		void table.ask(
			targets.map((player) => player.id),
			request,
			kind === TABLE_REQUEST.roll ? heldTo : undefined,
		);
	}
</script>

<form
	class="card ask-composer"
	aria-labelledby="ask-composer-title"
	onsubmit={(e) => {
		e.preventDefault();
		send();
	}}
>
	<h2 id="ask-composer-title" class="ask-composer-title">{$_('table.ask.title')}</h2>

	<div class="ask-row" role="group" aria-labelledby="ask-who">
		<span class="eyebrow ask-label" id="ask-who">{$_('table.ask.who')}</span>
		<button
			type="button"
			class="pill-btn"
			class:accent={everyone}
			aria-pressed={everyone}
			onclick={() => (everyone = true)}>{$_('table.ask.everyone')}</button
		>
		{#each present as player (player.id)}
			{@const on = !everyone && picked.includes(player.id)}
			<button
				type="button"
				class="pill-btn"
				class:accent={on}
				aria-pressed={on}
				onclick={() => pick(player.id)}>{player.view?.name ?? player.name}</button
			>
		{/each}
	</div>

	<div class="ask-row" role="group" aria-labelledby="ask-what">
		<span class="eyebrow ask-label" id="ask-what">{$_('table.ask.what')}</span>
		{#each KINDS as choice (choice)}
			<button
				type="button"
				class="pill-btn"
				class:accent={kind === choice}
				aria-pressed={kind === choice}
				onclick={() => (kind = choice)}>{$_(`table.ask.kind.${choice}`)}</button
			>
		{/each}
	</div>

	<div class="ask-row">
		{#if kind === TABLE_REQUEST.roll}
			<label class="eyebrow ask-label" for="ask-roll-kind">{$_('table.ask.which')}</label>
			<select id="ask-roll-kind" class="text-field ask-field" bind:value={rollKind}>
				{#each ROLL_KINDS as choice (choice)}
					<option value={choice}>{$_(`table.ask.rollKind.${choice}`)}</option>
				{/each}
			</select>
			{#if rollKind === REQUESTED_ROLL.skill}
				<select
					class="text-field ask-field"
					aria-label={$_('table.ask.rollKind.skill')}
					bind:value={skill}
				>
					{#each SKILL_IDS as id (id)}
						<option value={id}>{$_(`skillName.${id}`)}</option>
					{/each}
				</select>
			{:else}
				<select
					class="text-field ask-field"
					aria-label={$_(`table.ask.rollKind.${rollKind}`)}
					bind:value={ability}
				>
					{#each ABIL as id (id)}
						<option value={id}>{$_(`abilityName.${id}`)}</option>
					{/each}
				</select>
			{/if}
			<label class="eyebrow" for="ask-dc">{$_('table.ask.dc')}</label>
			<input
				id="ask-dc"
				class="text-field ask-field ask-number"
				type="number"
				inputmode="numeric"
				min="0"
				max={DC_MAX}
				placeholder={$_('table.ask.dcNone')}
				bind:value={dc}
			/>
			<span class="ask-announce" use:provenance={$_('table.ask.announceHint')}>
				<Switch
					on={announce && dc !== null}
					lock={dc === null}
					title={$_('table.ask.announce')}
					onclick={() => (announce = !announce)}
				/>
				<span>{$_('table.ask.announce')}</span>
			</span>
		{:else if kind === TABLE_REQUEST.effect}
			<label class="eyebrow ask-label" for="ask-state">{$_('table.ask.state')}</label>
			<select
				id="ask-state"
				class="text-field ask-field"
				value={chosenState}
				onchange={(e) => (stateId = e.currentTarget.value)}
			>
				{#each stateOptions as option (option.id)}
					<option value={option.id}>{option.label}</option>
				{/each}
			</select>
		{:else}
			<label class="eyebrow ask-label" for="ask-amount">{$_('table.ask.amount')}</label>
			<input
				id="ask-amount"
				class="text-field ask-field ask-number"
				type="number"
				inputmode="numeric"
				min="0"
				max={AMOUNT_MAX}
				bind:value={amount}
			/>
			{#if kind === TABLE_REQUEST.damage}
				<label class="eyebrow" for="ask-damage-type">{$_('table.ask.damageType')}</label>
				<select id="ask-damage-type" class="text-field ask-field" bind:value={damageType}>
					<option value={UNTYPED}>{$_('combat.hp.untyped')}</option>
					{#each DAMAGE_TYPES as type (type)}
						<option value={type}>{$_(`damageType.${type}`, { default: titleCase(type) })}</option>
					{/each}
				</select>
			{/if}
		{/if}
	</div>

	<div class="ask-row ask-send">
		{#if !present.length}
			<span class="muted" id="ask-nobody">{$_('table.ask.nobody')}</span>
		{/if}
		<span class="ask-spacer"></span>
		<!-- blocked, not disabled: its reason has to stay reachable -->
		<button
			type="submit"
			class="btn primary"
			class:is-blocked={!askable}
			aria-disabled={!askable}
			aria-describedby={present.length ? undefined : 'ask-nobody'}>{$_('table.ask.send')}</button
		>
	</div>
</form>

<style>
	.ask-composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2-5);
	}
	.ask-composer-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-h6);
	}
	.ask-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.ask-label {
		flex: none;
		min-width: 4.5em;
	}
	.ask-field {
		padding: var(--space-1-5) var(--space-2);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
	}
	.ask-number {
		width: 6em;
	}
	.ask-announce {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.ask-spacer {
		flex: 1;
	}
</style>
