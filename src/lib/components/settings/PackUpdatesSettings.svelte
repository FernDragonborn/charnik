<script lang="ts">
	// Settings ▸ Updates — content packs (docs/PLAN.md · REL-4). The dropdown governs the NETWORK
	// only; APPLYING is always the button, never automatic (docs/SECURITY.md §7). The manual check
	// deliberately bypasses the once-a-day throttle, because "I want to test this one" is the real
	// use. Desktop-only: the web build serves the content of its own deploy.
	import { _ } from '$lib/i18n';
	import { packConfig, setPinned, setUpdateMode, UPDATE_MODE } from '$lib/content/packs.svelte';
	import { updates, checkNow, applyUpdate } from '$lib/content/remote/updates.svelte';
	import { FILE_CHANGE } from '$lib/content/remote/diff';

	const packs = $derived(Object.entries(packConfig.packs).sort(([a], [b]) => a.localeCompare(b)));
	const modes = [UPDATE_MODE.off, UPDATE_MODE.notify, UPDATE_MODE.download];

	/** Files this update would write / preserve / delete, as a count per kind. */
	function counts(changes: { kind: string }[]) {
		return {
			write: changes.filter((c) => c.kind === FILE_CHANGE.added || c.kind === FILE_CHANGE.changed)
				.length,
			preserved: changes.filter((c) => c.kind === FILE_CHANGE.preserved).length,
			removed: changes.filter((c) => c.kind === FILE_CHANGE.removed).length
		};
	}

	const lastChecked = (repo: string): string | undefined => packConfig.repos[repo]?.lastCheckedAt;
</script>

<section class="sec-head">
	<h2>{$_('settings.packs.title')}</h2>
	<p class="sec-note">{$_('settings.packs.desc')}</p>
</section>

{#if !updates.supported}
	<p class="empty">{$_('settings.packs.desktopOnly')}</p>
{:else}
	<div class="setting-row">
		<span class="setting-label">{$_('settings.packs.mode')}</span>
		<div class="setting-options">
			{#each modes as mode (mode)}
				<button
					class="pill-btn"
					class:accent={packConfig.updates === mode}
					onclick={() => setUpdateMode(mode)}
				>
					{$_(`settings.packs.modes.${mode}`)}
				</button>
			{/each}
			<button
				class="pill-btn"
				disabled={updates.checking}
				onclick={() => checkNow({ manual: true })}
			>
				{updates.checking ? $_('settings.packs.checking') : $_('settings.packs.checkNow')}
			</button>
		</div>
	</div>

	{#if updates.error}
		<p class="pack-problem">
			{updates.error.kind === 'i18n'
				? $_(updates.error.key, { values: { repo: updates.error.repo } })
				: updates.error.message}
		</p>
	{/if}

	{#if packs.length === 0}
		<p class="empty">{$_('settings.packs.none')}</p>
	{:else}
		<div class="pack-list">
			{#each packs as [pack, entry] (pack)}
				{@const pending = updates.pending[pack]}
				<div class="pack-row" class:dim={entry.pinned}>
					<div class="pack-meta">
						<div class="pack-name">
							{pack}
							{#if entry.pinned}<span class="pack-tag">{$_('settings.packs.pinned')}</span>{/if}
						</div>
						<div class="pack-sub mono">{entry.repo}</div>
						{#if lastChecked(entry.repo)}
							<div class="pack-sub">
								{$_('settings.packs.lastChecked', {
									values: { when: new Date(lastChecked(entry.repo) ?? '').toLocaleString() }
								})}
							</div>
						{/if}

						{#if pending}
							{@const n = counts(pending.diff.changes)}
							<div class="pack-update">
								<div>{$_('settings.packs.filesToWrite', { values: { count: n.write } })}</div>
								{#if n.preserved > 0}
									<div>
										{$_('settings.packs.filesPreserved', { values: { count: n.preserved } })}
									</div>
								{/if}
								<!-- removals FIRST-CLASS: additions can't hurt anyone, a removal can orphan a
								     reference inside a character that is mid-campaign -->
								{#if pending.removedRows.length > 0}
									<div class="pack-warn">
										{$_('settings.packs.rowsRemoved', {
											values: { count: pending.removedRows.length }
										})}
									</div>
									{#if pending.affected.length > 0}
										<div class="pack-warn">
											{$_('settings.packs.charactersAffected', {
												values: { who: pending.affected.map((a) => a.slug).join(', ') }
											})}
										</div>
									{/if}
								{/if}
								{#if pending.plugins.length > 0}
									<div class="pack-warn">
										{$_('settings.packs.carriesPlugins', {
											values: { list: pending.plugins.join(', ') }
										})}
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<div class="pack-actions">
						<button class="pill-btn" onclick={() => setPinned(pack, entry.pinned !== true)}>
							{entry.pinned ? $_('settings.packs.unpin') : $_('settings.packs.pin')}
						</button>
						<button class="pill-btn" onclick={() => checkNow({ manual: true, repo: entry.repo })}>
							{$_('settings.packs.checkThis')}
						</button>
						{#if pending}
							<button class="pill-btn accent" onclick={() => applyUpdate(pack)}>
								{$_('settings.packs.apply')}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.pack-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.pack-row {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
	}
	.pack-row.dim {
		opacity: 0.6;
	}
	.pack-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.pack-name {
		font-weight: 600;
	}
	.pack-tag {
		margin-left: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.pack-sub {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.pack-update {
		margin-top: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.pack-warn {
		color: var(--color-warning);
	}
	.pack-problem {
		margin-top: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-warning);
	}
	.pack-actions {
		display: flex;
		flex-shrink: 0;
		gap: var(--space-2);
	}
</style>
