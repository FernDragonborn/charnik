<script lang="ts">
	// "What changes on the sheet" — the diff between the sheet as it stands and the sheet the
	// highlighted option would produce. Silent when nothing moves, because an empty list here means
	// "this choice touches no number", which is itself the answer.
	import { _ } from '$lib/i18n';
	import type { DiffText, SheetChange } from '$lib/build/sheet-diff';

	let { changes, taken = false }: { changes: SheetChange[]; taken?: boolean } = $props();

	/** The diff is computed with no locale, so it hands back catalog keys and this reads them. */
	const say = (t: DiffText): string =>
		'text' in t
			? t.text
			: 'keys' in t
				? t.keys.map((k) => $_(k)).join(', ')
				: $_(t.key, { values: t.values });
</script>

{#if changes.length}
	<div class="changes">
		<span class="eyebrow"
			>{$_(taken ? 'build.inspector.whatChanged' : 'build.inspector.whatChanges')}</span
		>
		<div class="rows">
			{#each changes as c (c.id)}
				<span class="clabel">{say(c.label)}</span>
				<span class="from">{say(c.from)}</span>
				<span class="arrow">→</span>
				<b class="to" class:better={c.better} class:worse={!c.better}>{say(c.to)}</b>
			{/each}
		</div>
	</div>
{/if}

<style>
	.changes {
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface-2);
		border-radius: var(--radius-md);
		padding: 11px 13px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.rows {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		gap: 5px 9px;
		align-items: baseline;
		font-size: var(--font-size-xs);
	}
	.clabel {
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.from,
	.arrow {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}
	.to {
		font-family: var(--font-mono);
	}
	.to.better {
		color: var(--color-good);
	}
	.to.worse {
		color: var(--color-danger);
	}
</style>
