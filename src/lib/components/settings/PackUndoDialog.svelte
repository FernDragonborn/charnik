<script lang="ts">
	// "Undo this update" asks what becomes of what the player changed in the pack since the update
	// (audit-oct-27 D8): a plain rollback drops every translation, edit and note made after it.
	import { _ } from '$lib/i18n';
	import DialogShell from '../DialogShell.svelte';
	import { ROLLBACK_MODE, type RollbackMode } from '$lib/content/remote/rollback';

	let {
		pack,
		onChoose,
		onCancel,
	}: {
		pack: string;
		onChoose: (mode: RollbackMode) => void;
		onCancel: () => void;
	} = $props();

	const choices: { mode: RollbackMode; key: string }[] = [
		{ mode: ROLLBACK_MODE.keepAsBackup, key: 'keepAsBackup' },
		{ mode: ROLLBACK_MODE.carryChanges, key: 'carryChanges' },
		{ mode: ROLLBACK_MODE.discardChanges, key: 'discardChanges' },
	];
</script>

<DialogShell
	titleId="pack-undo-title"
	title={$_('settings.packs.undoTitle', { values: { pack } })}
	subtitle={$_('settings.packs.undoSubtitle')}
	width="min(560px, calc(100vw - 2 * var(--space-4)))"
	badge="rotate-ccw"
	onDismiss={onCancel}
>
	<div class="dialog-body">
		{#each choices as choice (choice.mode)}
			<button class="dialog-card choice" onclick={() => onChoose(choice.mode)}>
				<span class="choice-label">{$_(`settings.packs.undoMode.${choice.key}`)}</span>
				<span class="choice-what">{$_(`settings.packs.undoMode.${choice.key}What`)}</span>
			</button>
		{/each}
	</div>
	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onCancel}>{$_('app.cancel')}</button>
	</footer>
</DialogShell>

<style>
	.choice {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		text-align: start;
		cursor: pointer;
		color: var(--color-text);
		font: inherit;
	}
	.choice:hover,
	.choice:focus-visible {
		border-color: var(--color-accent);
	}
	.choice-label {
		font-weight: 600;
	}
	.choice-what {
		color: var(--color-text-muted);
	}
</style>
