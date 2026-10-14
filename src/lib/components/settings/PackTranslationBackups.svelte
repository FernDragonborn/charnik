<script lang="ts">
	// The way back out of `content-backups/`, under the pack whose files a run copied aside before it
	// replaced them (`content/translation-backups.ts`). One row per run; putting one back is the same
	// swap an update is, so it sits beside "undo this update" and is reversed by it.
	import { _ } from '$lib/i18n';
	import { toast } from '$lib/toast/toast';
	import { restoreTranslations } from '$lib/content/remote/updates.svelte';
	import type { TranslationBackup } from '$lib/content/translation-backups';
	import ConfirmDialog from '../ConfirmDialog.svelte';

	let {
		pack,
		backups,
		onRestored,
	}: {
		pack: string;
		/** the runs holding copies of THIS pack's files, newest first */
		backups: TranslationBackup[];
		onRestored: () => Promise<void>;
	} = $props();

	const when = (backup: TranslationBackup): string => new Date(backup.when).toLocaleString();
	const files = (backup: TranslationBackup): string => (backup.packs[pack] ?? []).join(', ');

	let asked = $state<TranslationBackup | null>(null);
	async function restore() {
		const backup = asked;
		asked = null;
		if (!backup) return;
		if (await restoreTranslations(backup.path, pack))
			toast.success($_('settings.packs.backupRestored', { values: { pack, when: when(backup) } }));
		await onRestored();
	}
</script>

<details class="pack-backups">
	<summary>{$_('settings.packs.backups', { values: { count: backups.length } })}</summary>
	<ul>
		{#each backups as backup (backup.path)}
			<li>
				<span>{when(backup)} · {files(backup)}</span>
				<button class="pill-btn" onclick={() => (asked = backup)}>
					{$_('settings.snapshots.restore')}
				</button>
			</li>
		{/each}
	</ul>
</details>

{#if asked}
	<ConfirmDialog
		title={$_('settings.packs.backupConfirmTitle', { values: { pack } })}
		message={$_('settings.packs.backupConfirmBody', {
			values: { files: files(asked), when: when(asked) },
		})}
		confirmLabel={$_('settings.packs.backupConfirmAction')}
		onConfirm={restore}
		onCancel={() => (asked = null)}
	/>
{/if}

<style>
	.pack-backups {
		margin-top: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	summary {
		cursor: pointer;
	}
	ul {
		list-style: none;
		margin: var(--space-1) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
	}
	li {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
	}
	span {
		overflow-wrap: anywhere;
	}
</style>
