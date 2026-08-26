<script lang="ts">
	// Settings ▸ Updates — content packs (docs/PLAN.md · REL-4). The dropdown governs the NETWORK
	// only; APPLYING is always the button, never automatic (docs/internals/SECURITY.md §7). The manual check
	// deliberately bypasses the once-a-day throttle, because "I want to test this one" is the real
	// use. Desktop-only: the web build serves the content of its own deploy.
	import { _ } from '$lib/i18n';
	import { toast } from 'svelte-sonner';
	import {
		bundledPacks,
		missingBundled,
		packConfig,
		packConfigError,
		setPinned,
		setUpdateMode,
		SHIPPED_PACK_REPO,
		UPDATE_MODE,
	} from '$lib/content/packs.svelte';
	import { restoreBundledPacks } from '$lib/content/provider';
	import { refreshPlugins } from '$lib/effects/plugin-store.svelte';
	import {
		updates,
		checkNow,
		applyUpdate,
		rollbackablePacks,
		undoUpdate,
	} from '$lib/content/remote/updates.svelte';
	import {
		discoverPacks,
		installPack,
		renamePack,
		uninstallPack,
	} from '$lib/content/remote/pack-lifecycle';
	import { content, reloadContent } from '$lib/content/store.svelte';
	import { FILE_CHANGE } from '$lib/content/remote/diff';

	const packs = $derived(Object.entries(packConfig.packs).sort(([a], [b]) => a.localeCompare(b)));
	const modes = [UPDATE_MODE.off, UPDATE_MODE.notify, UPDATE_MODE.download];

	let repoUrl = $state('');
	let uninstalling = $state<string | null>(null);
	/** Folder name typed for a pack whose own name is already taken — keyed by its REMOTE name, which
	 *  is the one thing that doesn't change while the user edits the other one. */
	const folderName = $state<Record<string, string>>({});
	/** The installed pack being renamed, and the name typed for it. Renaming is here rather than in
	 *  the config file because the suggested `-2` is a guess, and correcting a guess should not mean
	 *  opening JSON. */
	let renaming = $state<{ pack: string; to: string } | null>(null);
	/** The pack whose apply stopped to show rows that would vanish; its second button accepts them. */
	let rowsToAccept = $state<string | null>(null);
	/** …and the pack whose install stopped because it publishes under a source another pack already
	 *  claims. Same two-click shape, and for the same reason: the first click is not consent to
	 *  something the user has not been told yet. */
	let claimToAccept = $state<string | null>(null);
	let restoring = $state(false);

	/** Anything that changes what is on disk must be followed by a re-read, or the compendium keeps
	 *  showing the old rows until the watcher happens to fire — and a pack carries CODE as well as
	 *  rows (`content/<pack>/plugins/<ns>/`, PLUGINS §2). Without the re-scan, the installer says
	 *  "this pack contains N plugins, they arrive switched off and need your review" and then the
	 *  review list stays empty until the next launch. Discovery only; consent is untouched, so
	 *  nothing new can run because of this. */
	async function afterDiskChange() {
		await reloadContent();
		await refreshPlugins();
		rollbackable = await rollbackablePacks();
	}

	/** Packs with a previous version still on disk (kept by the last apply). Read from the disk
	 *  rather than tracked in state — a `.prev` also survives a restart, and so must the offer. */
	let rollbackable = $state<string[]>([]);
	$effect(() => void rollbackablePacks().then((packs) => (rollbackable = packs)));

	/** Files this update would write / preserve / delete, as a count per kind. */
	function counts(changes: { kind: string }[]) {
		return {
			write: changes.filter((c) => c.kind === FILE_CHANGE.added || c.kind === FILE_CHANGE.changed)
				.length,
			preserved: changes.filter((c) => c.kind === FILE_CHANGE.preserved).length,
			removed: changes.filter((c) => c.kind === FILE_CHANGE.removed).length,
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
				void discoverPacks(SHIPPED_PACK_REPO);
			}}
		>
			{$_('settings.packs.ownRepoLoad')}
		</button>
	</p>

	<!-- Saving the registry failed. Louder than an update error and shown ABOVE it: an update that
	     didn't happen leaves the disk as it was, while a pin that didn't save is a promise this
	     session is still pretending to keep. -->
	{#if packConfigError.message}
		<p class="pack-problem strong">
			{$_('settings.packs.saveFailed', { values: { message: packConfigError.message } })}
		</p>
	{/if}

	<!-- every reason, not just the last: one check walks several repos and several packs, and each can
	     refuse for its own -->
	{#each updates.errors as problem, i (i)}
		<p class="pack-problem">
			{problem.kind === 'i18n' ? $_(problem.key, { values: problem.values }) : problem.message}
		</p>
	{/each}

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
									values: { list: found.plugins.join(', ') },
								})}
							</div>
						{/if}
						<!-- The name this repo uses is already somebody's folder. Two repos may both publish
						     `srd-2024` and folder names are not theirs to reserve, so it gets one beside it —
						     said out loud, with the name editable, rather than decided silently. -->
						{#if !found.installed && found.localName !== found.pack}
							<div class="pack-warn">
								{$_('settings.packs.nameTaken', { values: { name: found.pack } })}
							</div>
							<label class="pack-rename">
								<span class="pack-sub">{$_('settings.packs.folderLabel')}</span>
								<input
									class="add-url"
									type="text"
									value={folderName[found.pack] ?? found.localName}
									oninput={(e) => (folderName[found.pack] = e.currentTarget.value)}
								/>
							</label>
						{/if}
					</div>
					<div class="pack-actions">
						{#if found.installed}
							<span class="pack-sub">{$_('settings.packs.alreadyInstalled')}</span>
						{:else}
							<button
								class="pill-btn accent"
								onclick={async () => {
									const res = await installPack(found.pack, {
										localName: folderName[found.pack] ?? found.localName,
									});
									// it stopped to say this pack publishes under a source name another pack
									// already uses — the message is in `updates.error`, and the button below is
									// the click that accepts it
									claimToAccept = res?.sourceClaim !== undefined ? found.pack : null;
									await afterDiskChange();
								}}
							>
								{$_('settings.packs.install')}
							</button>
							{#if claimToAccept === found.pack}
								<button
									class="pill-btn"
									onclick={async () => {
										claimToAccept = null;
										await installPack(found.pack, {
											localName: folderName[found.pack] ?? found.localName,
											acceptSourceClaim: true,
										});
										await afterDiskChange();
									}}
								>
									{$_('settings.packs.installAnyway')}
								</button>
							{/if}
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
						<!-- Only worth saying when the two disagree: the repo calls it something else, and
						     that is the name the next check asks for. -->
						{#if entry.remotePack}
							<div class="pack-sub">
								{$_('settings.packs.publishedAs', { values: { name: entry.remotePack } })}
							</div>
						{/if}
						{#if renaming?.pack === pack}
							<label class="pack-rename">
								<span class="pack-sub">{$_('settings.packs.folderLabel')}</span>
								<!-- svelte-ignore a11y_autofocus -->
								<input
									class="add-url"
									type="text"
									autofocus
									bind:value={renaming.to}
									onkeydown={(e) => e.key === 'Escape' && (renaming = null)}
								/>
							</label>
						{/if}
						{#if lastChecked(entry.repo)}
							<div class="pack-sub">
								{$_('settings.packs.lastChecked', {
									values: { when: new Date(lastChecked(entry.repo) ?? '').toLocaleString() },
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
											values: { count: pending.removedRows.length },
										})}
									</div>
									{#if pending.affected.length > 0}
										<div class="pack-warn">
											{$_('settings.packs.charactersAffected', {
												values: { who: pending.affected.map((a) => a.slug).join(', ') },
											})}
										</div>
									{/if}
									<!-- A draft is unsaved work listed nowhere else, so a removal that orphans one is
									     the loss the user can least afford to discover afterwards. -->
									{#if pending.affectedDrafts.length > 0}
										<div class="pack-warn">
											{$_('settings.packs.draftsAffected', {
												values: { who: pending.affectedDrafts.join(', ') },
											})}
										</div>
									{/if}
								{/if}
								{#if pending.staged}
									<div>{$_('settings.packs.readyOffline')}</div>
								{/if}
								<!-- New code bytes void the consent hash, so an enabled plugin STOPS at apply and
								     stays stopped until re-approved — and the sheet's numbers move with it. That
								     is a different sentence from "this pack contains plugins", and the one that
								     has to be said here. -->
								{#if pending.pluginsChanged.length > 0}
									<div class="pack-warn">
										{$_('settings.packs.changesPlugins', {
											values: { list: pending.pluginsChanged.join(', ') },
										})}
									</div>
								{:else if pending.plugins.length > 0}
									<div class="pack-warn">
										{$_('settings.packs.carriesPlugins', {
											values: { list: pending.plugins.join(', ') },
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
											values: { count: entriesFrom(pack), repo: entry.repo },
										})}
							</div>
						{/if}
					</div>

					<div class="pack-actions">
						<!-- The applied-update undo. The swap keeps ONE previous copy beside the pack, so this
						     is "put back what I had before the last update" — the only way back once an update
						     is in, since a pin only prevents. -->
						{#if rollbackable.includes(pack)}
							<button
								class="pill-btn"
								onclick={async () => {
									if (await undoUpdate(pack))
										toast.success($_('settings.packs.undoDone', { values: { pack } }));
									await afterDiskChange();
								}}
							>
								{$_('settings.packs.undo')}
							</button>
						{/if}
						<!-- The folder name IS the pack's identity here, and it may have been chosen for it
						     (a `-2` suggested when another repo held the name). Correcting that should not
						     mean opening the config file. -->
						{#if renaming?.pack === pack}
							{@const target = renaming.to}
							<button
								class="pill-btn accent"
								onclick={async () => {
									renaming = null;
									if (await renamePack(pack, target)) await afterDiskChange();
								}}
							>
								{$_('settings.packs.renameConfirm')}
							</button>
							<button class="pill-btn" onclick={() => (renaming = null)}>
								{$_('settings.packs.cancel')}
							</button>
						{:else if !bundledPacks.packs.includes(pack)}
							<!-- not offered for a pack the app ships: its folder is how the seed finds it and
							     how "you deleted it, want it back?" knows what to put where -->
							<button class="pill-btn" onclick={() => (renaming = { pack, to: pack })}>
								{$_('settings.packs.rename')}
							</button>
						{/if}
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
									const res = await applyUpdate(pack);
									// it stopped to show rows that would vanish from inside changed files — the
									// second click is the one that accepts them
									rowsToAccept = res.rowRemovals !== undefined ? pack : null;
									await afterDiskChange();
								}}
							>
								{$_('settings.packs.apply')}
							</button>
							{#if rowsToAccept === pack}
								<button
									class="pill-btn"
									onclick={async () => {
										rowsToAccept = null;
										await applyUpdate(pack, { acceptRowRemovals: true });
										await afterDiskChange();
									}}
								>
									{$_('settings.packs.applyAnyway')}
								</button>
							{/if}
							<!-- accepting a removal is its OWN action: it deletes content a character may be
							     using, so it never rides along with the ordinary update button -->
							{#if pending.diff.changes.some((c) => c.kind === FILE_CHANGE.removed)}
								<button
									class="pill-btn"
									onclick={async () => {
										await applyUpdate(pack, { removeDeleted: true, acceptRowRemovals: true });
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
									// the plugin revoke is PART of uninstalling (it happens inside), not a step this
									// button remembers: consent outlives the files, so it can't hang off one caller
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
	/* a failed SAVE is not a failed update: the disk is fine, the promise is not */
	.pack-problem.strong {
		border: 1px solid var(--color-danger);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-3);
		color: var(--color-danger);
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
	/* The folder a pack lands in, editable inline — on a collision before installing, and afterwards
	   from the installed row. Narrower than the URL field it borrows its look from: it holds one
	   folder name, not a link. */
	.pack-rename {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		margin-top: var(--space-2);
	}
	.pack-rename .add-url {
		flex: 0 1 auto;
		min-width: 0;
		width: 18ch;
	}
	.pack-actions {
		display: flex;
		flex-shrink: 0;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
