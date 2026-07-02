<script lang="ts">
	// Toggle switch (d-spellmgr `.tg`). `lock` = always-on/disabled (e.g. always-prepared).
	let {
		on = false,
		lock = false,
		title,
		onclick
	}: { on?: boolean; lock?: boolean; title?: string; onclick?: () => void } = $props();
</script>

<button
	class="tg"
	class:on
	class:lock
	type="button"
	{title}
	disabled={lock}
	aria-pressed={on}
	{onclick}
></button>

<style>
	.tg {
		width: 34px;
		height: 20px;
		border-radius: 999px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		position: relative;
		flex: none;
		cursor: pointer;
		padding: 0;
	}
	.tg::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-text-muted);
		transition: left 0.12s;
	}
	.tg.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
	}
	.tg.on::after {
		left: 16px;
		background: var(--color-good);
	}
	.tg.lock {
		opacity: 0.45;
		cursor: default;
	}
</style>
