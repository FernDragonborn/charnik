<script lang="ts">
	// The Table screen: no seat yet (open a table, or join one), a GM's seat, or a player's. A thin
	// shell over `table` — what a seat keeps and does is `table-view-model.svelte.ts`.
	import { provenance } from '#lib/actions/provenance.ts';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import TableRouteDialog from './TableRouteDialog.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import { _ } from '#lib/i18n/index.ts';
	import { app } from '#lib/stores/app.svelte.ts';
	import { toast } from '#lib/toast/toast.ts';
	import { loadContentStore } from '#lib/content/store.svelte.ts';
	import { CONNECTION, RELAY_MODE, type RememberedTable } from '#lib/table-link/types.ts';
	import { combat } from '../combat/combat-view-model.svelte';
	import { ASK_STATUS, TABLE_ROLE, table, type AskedRow } from './table-view-model.svelte';
	import { rollPassed } from './requested-roll';
	import AskComposer from './AskComposer.svelte';
	import TableRequestLine from './TableRequestLine.svelte';
	import TableSeatCard from './TableSeatCard.svelte';
	import TableLogPanel from './TableLogPanel.svelte';
	import TableRollResult from './TableRollResult.svelte';

	let tableName = $state('');
	let invite = $state('');
	let confirmClose = $state(false);
	/** The first Open on this device asks how players will reach the table (`TableRouteDialog`). */
	let askRoute = $state(false);
	/** A remembered table about to be forgotten, while the person is asked. */
	let confirmForget = $state<RememberedTable | null>(null);

	// joining sits the open character down, so the screen names who that is before the press
	onMount(() => {
		void loadContentStore();
		void table.checkAvailable();
		void table.loadRemembered();
		if (!combat.character) void combat.load();
	});

	const character = $derived(combat.character);
	/** The relay a table opened here is reached through, as its host — what a person recognises. */
	const relayHost = $derived.by(() => {
		if (app.tableRelay.mode !== RELAY_MODE.custom) return '';
		try {
			return new URL(app.tableRelay.url).host;
		} catch {
			// not a web address yet: shown as typed, and refused by name when the table is opened
			return app.tableRelay.url;
		}
	});

	async function copyInvite(): Promise<void> {
		if (!table.invite) return;
		try {
			await navigator.clipboard.writeText(table.invite);
			toast.success($_('table.gm.copied'));
		} catch {
			// the invitation is on screen and selectable, which is the way to copy it by hand
			toast.warning($_('table.gm.notCopied'));
		}
	}

	/** What came back for a roll held to a DC: passed, failed, or nothing to say yet. */
	const verdictKey = (row: AskedRow): string | null =>
		row.roll && row.dc !== undefined
			? rollPassed(row.roll, row.dc)
				? 'table.asked.passed'
				: 'table.asked.failed'
			: null;
	const STATUS_KEY = {
		[ASK_STATUS.pending]: 'table.asked.pending',
		[ASK_STATUS.declined]: 'table.asked.declined',
		[ASK_STATUS.accepted]: 'table.asked.done',
	} as const;
</script>

<svelte:head><title>{$_('nav.table')} — Charnik</title></svelte:head>

<section class="table-page">
	{#if table.role === TABLE_ROLE.gm}
		<header class="table-head">
			<div>
				<p class="eyebrow">{$_('table.gm.eyebrow')}</p>
				<h1>{table.tableName}</h1>
			</div>
			<button class="btn" onclick={() => (confirmClose = true)}>{$_('table.gm.close')}</button>
		</header>

		<div class="card table-invite">
			<div class="table-invite-door">
				<Switch
					on={table.invite !== null}
					title={$_('table.gm.door')}
					onclick={() => void table.setDoor(table.invite === null)}
				/>
				<span>{$_('table.gm.door')}</span>
			</div>
			{#if table.invite}
				<label class="eyebrow" for="table-invite">{$_('table.gm.invite')}</label>
				<div class="table-invite-row">
					<input
						id="table-invite"
						class="text-field table-field table-invite-text"
						readonly
						value={table.invite}
						aria-describedby="table-invite-hint"
						onfocus={(e) => e.currentTarget.select()}
					/>
					<button class="btn primary" onclick={() => void copyInvite()}
						>{$_('table.gm.copy')}</button
					>
				</div>
				<p class="muted" id="table-invite-hint">{$_('table.gm.inviteHint')}</p>
			{:else}
				<p class="muted">{$_('table.gm.doorShut')}</p>
			{/if}
		</div>

		<h2 class="table-section">{$_('table.gm.players')}</h2>
		{#if table.players.length}
			<div class="table-seats">
				{#each table.players as player (player.id)}
					<TableSeatCard {player} ondismiss={() => void table.dismiss(player.id)} />
				{/each}
			</div>
			<AskComposer players={table.players} />

			<h2 class="table-section">{$_('table.asked.title')}</h2>
			{#if table.asked.length}
				<ul class="table-rows">
					{#each table.asked as row (row.requestId)}
						{@const verdict = verdictKey(row)}
						<li class="table-row table-asked-row">
							<b class="table-asked-name">{row.name}</b>
							<TableRequestLine request={row.request} heldTo={row.dc} />
							<span class="table-row-spacer"></span>
							{#if row.roll}<TableRollResult roll={row.roll} />{/if}
							{#if verdict}
								<span
									class="durpill table-asked-verdict"
									class:is-passed={verdict === 'table.asked.passed'}>{$_(verdict)}</span
								>
							{:else}
								<span
									class="durpill table-asked-status"
									class:is-pending={row.status === ASK_STATUS.pending}
									class:is-declined={row.status === ASK_STATUS.declined}
									>{$_(STATUS_KEY[row.status])}</span
								>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">{$_('table.asked.empty')}</p>
			{/if}
		{:else}
			<p class="muted">{$_('table.gm.empty')}</p>
		{/if}
		<TableLogPanel />
	{:else if table.role === TABLE_ROLE.player}
		<header class="table-head">
			<div>
				<p class="eyebrow">{$_('table.player.eyebrow')}</p>
				<h1>{character?.build.name ?? $_('nav.table')}</h1>
			</div>
			<button class="btn" onclick={() => void table.leave()}>{$_('table.player.leave')}</button>
		</header>
		<div class="card table-status" aria-live="polite">
			<p class="table-status-line">{$_(`table.player.state.${table.connection}`)}</p>
			{#if table.connection === CONNECTION.reconnecting}
				<button class="btn" onclick={() => void table.redial()}>
					{$_('table.player.redial')}
				</button>
			{/if}
			{#if table.connection !== CONNECTION.connected}
				<p class="eyebrow">{$_('table.player.code')}</p>
				<p class="table-code">{table.code}</p>
			{/if}
			<p class="muted">{$_('table.player.sees')}</p>
		</div>
		<TableLogPanel />
	{:else}
		<header class="table-head">
			<div>
				<h1>{$_('table.title')}</h1>
				<p class="muted table-blurb">{$_('table.blurb')}</p>
			</div>
		</header>

		{#if table.problem}
			<p class="table-problem" role="alert">
				{#if table.problemGap}
					{$_(
						table.problemGap.newer
							? 'table.problem.versionGmNewer'
							: 'table.problem.versionGmOlder',
						{ values: { version: table.problemGap.version } },
					)}
				{:else}
					{$_(`table.problem.${table.problem}`)}
				{/if}
			</p>
		{/if}
		{#if table.busy}
			<p class="table-busy" role="status">{$_('table.busy')}</p>
		{/if}

		{#if table.available === false}
			<p class="card muted">{$_('table.webOnly')}</p>
		{:else}
			<div class="table-doors">
				<form
					class="card table-door"
					aria-labelledby="table-host-title"
					onsubmit={(e) => {
						e.preventDefault();
						if (!tableName.trim()) return;
						if (app.tableRelayConfirmed) void table.host(tableName);
						else askRoute = true;
					}}
				>
					<h2 id="table-host-title">{$_('table.host.title')}</h2>
					<p class="muted">{$_('table.host.blurb')}</p>
					<label class="eyebrow" for="table-name">{$_('table.host.name')}</label>
					<input
						id="table-name"
						class="text-field table-field"
						maxlength="40"
						autocomplete="off"
						placeholder={$_('table.host.namePlaceholder')}
						bind:value={tableName}
					/>
					<p class="muted">
						{$_('table.host.relay')}: {$_(`table.host.relayName.${app.tableRelay.mode}`)}{relayHost
							? ` — ${relayHost}`
							: ''}.
						<a href={resolve('settings?tab=table')}>{$_('table.host.changeRelay')}</a>
					</p>
					<button
						type="submit"
						class="btn primary"
						class:is-blocked={table.busy || !tableName.trim()}
						aria-disabled={table.busy || !tableName.trim()}>{$_('table.host.open')}</button
					>
				</form>

				<form
					class="card table-door"
					aria-labelledby="table-join-title"
					onsubmit={(e) => {
						e.preventDefault();
						if (invite.trim() && character) void table.join(invite);
					}}
				>
					<h2 id="table-join-title">{$_('table.join.title')}</h2>
					<p class="muted">{$_('table.join.blurb')}</p>
					<label class="eyebrow" for="table-join-invite">{$_('table.join.invite')}</label>
					<input
						id="table-join-invite"
						class="text-field table-field table-invite-text"
						autocomplete="off"
						spellcheck="false"
						placeholder={$_('table.join.invitePlaceholder')}
						bind:value={invite}
					/>
					<p class="muted" id="table-join-as">
						{character
							? $_('table.join.as', { values: { name: character.build.name } })
							: $_('table.join.noCharacter')}
					</p>
					<button
						type="submit"
						class="btn primary"
						class:is-blocked={table.busy || !invite.trim() || !character}
						aria-disabled={table.busy || !invite.trim() || !character}
						aria-describedby="table-join-as">{$_('table.join.join')}</button
					>
				</form>
			</div>
			{#if table.remembered.length}
				<section class="card table-remembered" aria-labelledby="table-remembered-title">
					<h2 id="table-remembered-title">{$_('table.remembered.title')}</h2>
					<p class="muted">{$_('table.remembered.blurb')}</p>
					<ul class="table-rows">
						{#each table.remembered as kept (kept.table)}
							<li class="table-row">
								<b>{kept.name}</b>
								<span class="muted">{$_(`table.remembered.as.${kept.role}`)}</span>
								<span class="table-row-spacer"></span>
								<button
									type="button"
									class="btn primary"
									class:is-blocked={table.busy}
									aria-disabled={table.busy}
									onclick={() => void table.returnTo(kept)}>{$_('table.remembered.return')}</button
								>
								<button
									type="button"
									class="icon-button"
									class:is-blocked={table.busy}
									aria-disabled={table.busy}
									use:provenance={$_('table.remembered.forget')}
									aria-label={$_('table.remembered.forget')}
									onclick={() => (confirmForget = kept)}><Icon name="x" size={12} /></button
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	{/if}
</section>

{#if confirmForget}
	{@const kept = confirmForget}
	<ConfirmDialog
		ask={$_('table.remembered.forgetAsk')}
		title={kept.name}
		message={$_(`table.remembered.forgetBody.${kept.role}`)}
		confirmLabel={$_('table.remembered.forget')}
		danger
		onConfirm={() => {
			confirmForget = null;
			void table.forget(kept);
		}}
		onCancel={() => (confirmForget = null)}
	/>
{/if}

{#if askRoute}
	<TableRouteDialog
		onOpen={() => {
			askRoute = false;
			app.tableRelayConfirmed = true;
			void table.host(tableName);
		}}
		onCancel={() => (askRoute = false)}
	/>
{/if}

{#if confirmClose}
	<ConfirmDialog
		ask={$_('table.gm.closeAsk')}
		title={table.tableName}
		message={$_('table.gm.closeBody')}
		confirmLabel={$_('table.gm.close')}
		danger
		onConfirm={() => {
			confirmClose = false;
			void table.leave();
		}}
		onCancel={() => (confirmClose = false)}
	/>
{/if}

<style>
	.table-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.table-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
	}
	.table-head h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-h2);
		overflow-wrap: anywhere;
	}
	.table-head .eyebrow {
		margin: 0 0 var(--space-1);
	}
	.table-blurb {
		margin: var(--space-2) 0 0;
		max-width: 70ch;
	}
	.table-problem,
	.table-busy {
		margin: 0;
		padding: var(--space-2-5) var(--space-3);
		border: 1px solid var(--color-warning);
		border-radius: var(--radius);
		color: var(--color-warning);
		font-size: var(--font-size-body);
	}
	.table-busy {
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.table-doors,
	.table-seats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: var(--space-4);
	}
	.table-door {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.table-door h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--font-size-h5);
	}
	.table-door p {
		margin: 0;
	}
	.table-field {
		width: 100%;
		padding: var(--space-2) var(--space-2-5);
		font-size: var(--font-size-body);
	}
	.table-invite-text {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	.table-invite {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.table-invite p {
		margin: 0;
	}
	.table-invite-door {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.table-invite-row {
		display: flex;
		gap: var(--space-2);
	}
	.table-invite-row .table-field {
		flex: 1;
		min-width: 0;
	}
	.table-asked-verdict {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.table-asked-verdict.is-passed {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	/* what came back says so by colour: nothing yet is quiet, a refusal is a warning */
	.table-asked-row .table-asked-status {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
	.table-asked-row .table-asked-status.is-pending {
		color: var(--color-text-muted);
		border-color: var(--color-border);
	}
	.table-asked-row .table-asked-status.is-declined {
		color: var(--color-warning);
		border-color: var(--color-warning);
	}
	.table-remembered {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.table-remembered h2,
	.table-remembered p {
		margin: 0;
	}
	.table-status {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.table-status p {
		margin: 0;
	}
	.table-status-line {
		font-size: var(--font-size-md);
	}
	.table-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xl);
		letter-spacing: var(--tracking-label);
	}
</style>
