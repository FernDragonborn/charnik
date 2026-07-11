<script lang="ts">
	// The roll hint line + the "last roll" button that opens the roll log. Reads the `combat`
	// view-model singleton (the log lives on the dice tray).
	import { combat } from '../state.svelte';

	const { openMenu } = combat;
	const log = $derived(combat.tray.log);
</script>

<div class="playbar">
	<span class="panel-hint"
		>Tap any check · save · attack · spell to roll it · <b>Alt + click</b> (or Ctrl) for advantage /
		custom dice.</span
	>
	<button class="rollout" onclick={(e) => openMenu('log', e)}>
		🎲 {#if log[0]}Last · <b>{log[0].label}</b> <i>{log[0].expr}</i> =
			<span class="roll-result">{log[0].total}</span>{:else}<i>no rolls yet</i>{/if}<span
			class="log-cue">▸ log</span
		>
	</button>
</div>

<style>
	.playbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 22px;
	}
	.panel-hint {
		font-size: 12px;
		color: var(--color-text-muted);
		flex: 1;
		min-width: 220px;
	}
	.rollout {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 6px 11px;
		cursor: pointer;
		margin-left: auto;
		white-space: nowrap;
	}
	.rollout:hover {
		border-color: var(--color-border-strong);
	}
	.rollout i {
		font-style: normal;
		color: var(--color-text-muted);
	}
	.rollout .roll-result {
		color: var(--color-good);
		font-size: 14px;
		font-weight: 700;
	}
	.rollout .log-cue {
		color: var(--color-text-muted);
		margin-left: 8px;
	}
</style>
