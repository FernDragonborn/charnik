<script lang="ts" module>
	/** One side of a compared file: when it was written, and anything else worth a glance. */
	export interface FileSide {
		when: string;
		extra?: string;
	}
	/** One file as it stands on each side. `keeps` names the side an answer will keep, if any. */
	export interface FileCompareRow {
		name: string;
		left?: FileSide | undefined;
		right?: FileSide | undefined;
		keeps: 'left' | 'right' | null;
		/** Said beside "kept": what differs, where it is known. */
		note?: string;
		/** Where the answer applies per file, pressing the arrow takes this file out of it and back. */
		toggle?: () => void;
	}
	export interface FileCompareGroup {
		label: string;
		rows: FileCompareRow[];
	}
</script>

<script lang="ts">
	// Two versions of the same files side by side, the way a two-panel file manager shows them: one
	// row per name, the same name facing itself, an arrow at the copy that stays. A folder about to
	// be merged and a file changed outside the app ask the same question, so they share the answer's
	// shape (`docs/internals/ui.md` ▸ Shared controls and dialogs).
	let {
		left,
		right,
		groups,
		keepsLabel,
		toggleLabel = '',
	}: {
		left: { title: string; detail: string };
		right: { title: string; detail: string };
		groups: FileCompareGroup[];
		/** The word under the copy that stays ("kept"). */
		keepsLabel: string;
		/** What pressing a row's arrow does, for a reader that cannot see the arrow. */
		toggleLabel?: string;
	} = $props();
</script>

<div class="fc" role="table" aria-label={`${left.title} · ${right.title}`}>
	<div class="fc-head" role="row">
		<div role="columnheader">
			<b>{left.title}</b>{#if left.detail}<span>{left.detail}</span>{/if}
		</div>
		<div aria-hidden="true"></div>
		<div role="columnheader">
			<b>{right.title}</b>{#if right.detail}<span>{right.detail}</span>{/if}
		</div>
	</div>
	{#each groups as group (group.label)}
		{#if group.label}<div class="fc-dir" role="row">
				<span role="cell">{group.label}</span>
			</div>{/if}
		{#each group.rows as row (row.name)}
			<div class="fc-row" role="row">
				{#each [{ side: row.left, at: 'left' }, { side: row.right, at: 'right' }] as cell, i (cell.at)}
					{#if i === 1}
						{#if row.toggle}
							<div class="fc-arrow" role="cell">
								<button
									type="button"
									class="fc-toggle"
									aria-pressed={row.keeps !== null}
									aria-label={`${toggleLabel}: ${row.name}`}
									onclick={row.toggle}
									>{row.keeps === 'left' ? '←' : row.keeps === 'right' ? '→' : '·'}</button
								>
							</div>
						{:else}
							<div class="fc-arrow" role="cell" aria-hidden="true">
								{row.keeps === 'left' ? '←' : row.keeps === 'right' ? '→' : ''}
							</div>
						{/if}
					{/if}
					<div
						role="cell"
						class:kept={row.keeps === cell.at}
						class:lost={row.keeps !== null && row.keeps !== cell.at}
					>
						{#if cell.side}
							<span class="fc-name">{row.name}</span>
							<span class="fc-when"
								>{cell.side.when}{cell.side.extra ? ` · ${cell.side.extra}` : ''}</span
							>
							{#if row.keeps === cell.at}
								<span class="fc-kept">{keepsLabel}{row.note ? ` · ${row.note}` : ''}</span>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	{/each}
</div>

<style>
	.fc {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.fc-head,
	.fc-row {
		display: grid;
		grid-template-columns: 1fr var(--space-8) 1fr;
	}
	.fc-head > div {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
	}
	.fc-head b {
		font-size: var(--font-size-sm);
	}
	.fc-head span {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.fc-dir {
		padding: var(--space-1-5) var(--space-3) 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.fc-row {
		border-bottom: 1px solid var(--color-border);
	}
	.fc-row:last-child {
		border-bottom: 0;
	}
	.fc-row > div {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
	}
	.fc-name {
		font-size: var(--font-size-sm);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.fc-when {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	/* the copy that goes is struck through and faded; the one that stays says so */
	.lost .fc-name {
		color: var(--color-text-muted);
		text-decoration: line-through;
		text-decoration-color: var(--color-border-strong);
	}
	.fc-kept {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-good);
	}
	.fc-toggle {
		width: var(--space-6);
		height: var(--space-6);
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.fc-toggle[aria-pressed='false'] {
		color: var(--color-text-muted);
	}
	.fc-arrow {
		align-items: center;
		justify-content: center;
		font-size: var(--font-size-lg);
		color: var(--color-good);
	}
</style>
