<script lang="ts">
	// Settings ▸ Updates — content packs (docs/PLAN.md · REL-4). The dropdown governs the NETWORK
	// only; APPLYING is always the button, never automatic (docs/SECURITY.md §7). The manual check
	// deliberately bypasses the once-a-day throttle, because "I want to test this one" is the real
	// use. Desktop-only: the web build serves the content of its own deploy.
	import { _ } from '$lib/i18n';
	import {
		missingBundled,
		packConfig,
		setPinned,
		setUpdateMode,
		SHIPPED_PACK_REPO,
		UPDATE_MODE
	} from '$lib/content/packs.svelte';
	import { restoreBundledPacks } from '$lib/content/provider';
	import {
		updates,
		checkNow,
		applyUpdate,
		discoverPacks,
		installPack,
		uninstallPack
	} from '$lib/content/remote/updates.svelte';
	import { content, reloadContent } from '$lib/content/store.svelte';
	import { FILE_CHANGE } from '$lib/content/remote/diff';

	const packs = $derived(Object.entries(packConfig.packs).sort(([a], [b]) => a.localeCompare(b)));
	const modes = [UPDATE_MODE.off, UPDATE_MODE.notify, UPDATE_MODE.download];

	let repoUrl = $state('');
	let uninstalling = $state<string | null>(null);
	let restoring = $state(false);

	/** Anything that changes what is on disk must be followed by a re-read, or the compendium keeps
	 *  showing the old rows until the watcher happens to fire. */
	async function afterDiskChange() {
		await reloadContent();
	}

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

	/** How much of the loaded content this pack IS. Deleting the shipped SRD is allowed — it is a pack
	 *  like any other — but "you are about to remove 1,842 of your 2,010 entries" is the honest way to
	 *  say "nothing will work without this", and it needs no special case to say it. */
	const entriesFrom = (pack: string): number =>
		content.graph?.rows.filter((row) => row.root === `content/${pack}`).length ?? 0;
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

	<!-- ADD a pack: paste a repo URL, see what it holds, then install one. Deliberately two steps —
	     a repo can hold several packs, and a pack may carry plugins the user must see first. -->
	<div class="setting-row">
		<span class="setting-label">{$_('settings.packs.addLabel')}</span>
		<div class="setting-options add-row">
			<input
				class="add-url"
				type="url"
				bind:value={repoUrl}
				placeholder={$_('settings.packs.addPlaceholder')}
				onkeydown={(e) => e.key === 'Enter' && repoUrl && discoverPacks(repoUrl)}
			/>
			<button
				class="pill-btn"
				disabled={updates.checking || repoUrl.trim() === ''}
				onclick={() => discoverPacks(repoUrl.trim())}
			>
				{$_('settings.packs.lookUp')}
			</button>
		</div>
	</div>

	<!-- Deleting a pack forgets its entry, and the URL with it — so the content Charnik itself
	     publishes has to be reachable from here, or the one pack everyone starts with is gone behind
	     a link nobody memorised. -->
	<p class="sec-note repo-hint">
		<span>{$_('settings.packs.ownRepoHint')} <span class="mono">{SHIPPED_PACK_REPO}</span></span>
		<button
			class="pill-btn"
			disabled={updates.checking}
			onclick={() => {
				repoUrl = SHIPPED_PACK_REPO;
				discoverPacks(SHIPPED_PACK_REPO);
			}}
		>
			{$_('settings.packs.ownRepoLoad')}
		</button>
	</p>

	{#if updates.error}
		<p class="pack-problem">
			{updates.error.kind === 'i18n'
				? $_(updates.error.key, { values: updates.error.values })
				: updates.error.message}
		</p>
	{/if}

	{#if updates.discovered.length > 0}
		<p class="list-label">
			{$_('settings.packs.foundIn', { values: { repo: updates.discovered[0]?.repo ?? '' } })}
		</p>
		<div class="pack-list">
			{#each updates.discovered as found (found.pack)}
				<div class="pack-row">
					<div class="pack-meta">
						<div class="pack-name">{found.pack}</div>
						<div class="pack-sub">
							{$_('settings.packs.filesInPack', { values: { count: found.files } })}
						</div>
						{#if found.plugins.length > 0}
							<div class="pack-warn">
								{$_('settings.packs.carriesPlugins', {
									values: { list: found.plugins.join(', ') }
								})}
							</div>
						{/if}
					</div>
					<div class="pack-actions">
						{#if found.installed}
							<span class="pack-sub">{$_('settings.packs.alreadyInstalled')}</span>
						{:else}
							<button
								class="pill-btn accent"
								onclick={async () => {
									await installPack(found.pack);
									await afterDiskChange();
								}}
							>
								{$_('settings.packs.install')}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- A bundled pack that isn't on disk. Listed whether or not the launch prompt was silenced:
	     "I meant to delete it" answers a QUESTION, it does not take the undo away. -->
	{#if missingBundled.packs.length > 0}
		<p class="list-label">{$_('settings.packs.missingLabel')}</p>
		<div class="pack-list">
			{#each missingBundled.packs as pack (pack)}
				<div class="pack-row">
					<div class="pack-meta">
						<div class="pack-name">{pack}</div>
						<div class="pack-sub">{$_('settings.packs.missingNote')}</div>
					</div>
					<div class="pack-actions">
						<button
							class="pill-btn accent"
							disabled={restoring}
							onclick={async () => {
								restoring = true;
								try {
									await restoreBundledPacks([pack]);
									missingBundled.packs = missingBundled.packs.filter((p) => p !== pack);
									await afterDiskChange();
								} finally {
									restoring = false;
								}
							}}
						>
							{$_('settings.packs.restore')}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if packs.length === 0}
		<p class="empty">{$_('settings.packs.none')}</p>
	{:else}
		<p class="list-label">{$_('settings.packs.installedLabel')}</p>
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
								{#if pending.staged}
									<div>{$_('settings.packs.readyOffline')}</div>
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

						<!-- said at the moment of deciding, and quantified: a pack IS the rules it carries -->
						{#if uninstalling === pack}
							<div class="pack-warn">
								{entriesFrom(pack) === 0
									? $_('settings.packs.uninstallWarnEmpty', { values: { repo: entry.repo } })
									: $_('settings.packs.uninstallWarn', {
											values: { count: entriesFrom(pack), repo: entry.repo }
										})}
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
							<button
								class="pill-btn accent"
								onclick={async () => {
									await applyUpdate(pack);
									await afterDiskChange();
								}}
							>
								{$_('settings.packs.apply')}
							</button>
							<!-- accepting a removal is its OWN action: it deletes content a character may be
							     using, so it never rides along with the ordinary update button -->
							{#if pending.diff.changes.some((c) => c.kind === FILE_CHANGE.removed)}
								<button
									class="pill-btn"
									onclick={async () => {
										await applyUpdate(pack, { removeDeleted: true });
										await afterDiskChange();
									}}
								>
									{$_('settings.packs.applyWithRemovals')}
								</button>
							{/if}
						{/if}
						{#if uninstalling === pack}
							<button
								class="pill-btn accent"
								onclick={async () => {
									await uninstallPack(pack);
									uninstalling = null;
									await afterDiskChange();
								}}
							>
								{$_('settings.packs.uninstallConfirm')}
							</button>
							<button class="pill-btn" onclick={() => (uninstalling = null)}>
								{$_('settings.packs.cancel')}
							</button>
						{:else}
							<button class="pill-btn" onclick={() => (uninstalling = pack)}>
								{$_('settings.packs.uninstall')}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.list-label {
		margin: var(--space-4) 0 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}
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
	.repo-hint {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		margin-top: var(--space-2);
	}
	.add-row {
		flex: 1;
	}
	.add-url {
		flex: 1;
		min-width: 280px;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		padding: 6px 10px;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	.pack-actions {
		display: flex;
		flex-shrink: 0;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
