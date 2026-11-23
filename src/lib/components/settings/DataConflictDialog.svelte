<script lang="ts">
	// Shown when the folder chosen for a data move ISN'T empty (an automatic move needs an empty one).
	// Three ways out: pick another folder, only repoint (the data was already copied there), or merge
	// the two. The files are laid side by side as a two-panel file manager shows them — the same name
	// facing itself, the arrow at the copy a merge keeps — with the clashes shown first.
	import { _ } from '$lib/i18n';
	import DialogShell from '../DialogShell.svelte';
	import FileCompare, { type FileCompareGroup } from '../FileCompare.svelte';
	import type { ConflictRow } from '$lib/storage/migrate';

	let {
		rows,
		currentPath,
		targetPath,
		onPickAnother,
		onRepoint,
		onMerge,
		onclose,
	}: {
		rows: ConflictRow[];
		currentPath: string;
		targetPath: string;
		onPickAnother: () => void;
		onRepoint: () => void;
		onMerge: () => void;
		onclose: () => void;
	} = $props();

	const VIEW = { clashes: 'clashes', current: 'current', chosen: 'chosen', all: 'all' } as const;
	type View = (typeof VIEW)[keyof typeof VIEW];
	const inView: Record<View, (r: ConflictRow) => boolean> = {
		clashes: (r) => !!r.source && !!r.target,
		current: (r) => !!r.source && !r.target,
		chosen: (r) => !r.source && !!r.target,
		all: () => true,
	};
	const VIEW_KEY: Record<View, string> = {
		clashes: 'settings.conflict.showClashes',
		current: 'settings.conflict.showCurrent',
		chosen: 'settings.conflict.showChosen',
		all: 'settings.conflict.showAll',
	};
	const views = Object.values(VIEW);
	const countOf = (view: View): number => rows.filter(inView[view]).length;
	// clashes are what the question is about; with none, the whole list. Chosen once, as it opens.
	// svelte-ignore state_referenced_locally
	let view = $state<View>(rows.some(inView.clashes) ? VIEW.clashes : VIEW.all);

	const when = (ms?: number) => (ms == null ? '—' : new Date(ms).toLocaleString());
	const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

	/** One group per folder, in path order, so `characters/karroth` reads as a heading. */
	const groups = $derived.by((): FileCompareGroup[] => {
		const byFolder = new Map<string, FileCompareGroup>();
		for (const r of rows.filter(inView[view])) {
			const cut = r.path.lastIndexOf('/');
			const folder = cut < 0 ? '' : r.path.slice(0, cut).replaceAll('/', ' / ');
			const group = byFolder.get(folder) ?? { label: folder, rows: [] };
			group.rows.push({
				name: r.path.slice(cut + 1),
				left: r.source && { when: when(r.source.mtime), extra: kb(r.source.size) },
				right: r.target && { when: when(r.target.mtime), extra: kb(r.target.size) },
				keeps: r.newer === 'source' ? 'left' : r.newer === 'target' ? 'right' : null,
			});
			byFolder.set(folder, group);
		}
		return [...byFolder.values()].sort((a, b) => a.label.localeCompare(b.label));
	});

	// the keyboard starts on the safe choice, not the merging one
	let safeBtn = $state<HTMLButtonElement | null>(null);
	const repointWord = $derived($_('settings.conflict.repoint'));
	const mergeWord = $derived($_('settings.conflict.mergeShort'));
</script>

<DialogShell
	titleId="cf-title"
	title={$_('settings.conflict.title')}
	sub={targetPath}
	subIsPath
	subtitle={$_('settings.conflict.blurb', { values: { repoint: repointWord, merge: mergeWord } })}
	width="min(860px, calc(100vw - 2 * var(--space-4)))"
	initialFocus={safeBtn}
	onDismiss={onclose}
>
	<div class="dialog-body">
		<div class="views" role="radiogroup" aria-label={$_('settings.conflict.title')}>
			{#each views as v (v)}
				<button
					type="button"
					class="pill-btn"
					class:accent={view === v}
					role="radio"
					aria-checked={view === v}
					onclick={() => (view = v)}>{$_(VIEW_KEY[v], { values: { count: countOf(v) } })}</button
				>
			{/each}
		</div>
		{#if groups.length}
			<FileCompare
				left={{ title: $_('settings.conflict.colCurrent'), detail: currentPath }}
				right={{ title: $_('settings.conflict.colChosen'), detail: targetPath }}
				{groups}
				keepsLabel={$_('settings.conflict.kept')}
			/>
		{:else}
			<p class="explain">{$_('settings.conflict.nothingHere')}</p>
		{/if}
		<p class="explain">{$_('settings.conflict.explain', { values: { merge: mergeWord } })}</p>
	</div>

	<footer class="dialog-foot">
		<button class="btn" bind:this={safeBtn} onclick={onPickAnother}
			>{$_('settings.conflict.pickAnother')}</button
		>
		<span class="dialog-spacer"></span>
		<button class="btn" onclick={onRepoint}>{$_('settings.conflict.repoint')}</button>
		<button class="btn primary" onclick={onMerge}>{$_('settings.conflict.merge')}</button>
	</footer>
</DialogShell>

<style>
	.views {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
	}
	.explain {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
