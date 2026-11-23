<script lang="ts">
	// The DATA-DRIFT question (DATA-VER-1): a file's body no longer matches its recorded
	// #content-hash, i.e. it was edited outside the app. The files are laid side by side as the folder
	// clash lays them — as Charnik last wrote each, as it is on disk now, the arrow at the version a
	// "record" keeps — grouped by whose they are; pressing a file's arrow leaves it out. Presentation
	// only — the detection and the atomic write-back live in the loader/provider (thin-component rule).
	import { untrack } from 'svelte';
	import { _ } from '$lib/i18n';
	import DialogShell from './DialogShell.svelte';
	import FileCompare, { type FileCompareGroup } from './FileCompare.svelte';
	import { HOMEBREW_ROOT } from '$lib/content/homebrew';
	import type { DriftItem } from '$lib/content/meta';

	let {
		items,
		onUpdate,
		onSkip,
		onNeverAsk,
	}: {
		items: DriftItem[];
		/** the files the user chose to bump (updated-at → today, hash → recomputed) */
		onUpdate: (files: string[]) => void;
		onSkip: () => void;
		onNeverAsk: () => void;
	} = $props();

	// which files are checked for updating — all on by default (snapshot at open)
	const checked = $state<Record<string, boolean>>(
		untrack(() => Object.fromEntries(items.map((i) => [i.file, true]))),
	);
	const anyChecked = $derived(items.some((i) => checked[i.file]));

	/** One group per folder, the pack's files apart from the player's own. */
	const groups = $derived.by((): FileCompareGroup[] => {
		const byFolder = new Map<string, FileCompareGroup>();
		for (const item of items) {
			const cut = item.file.lastIndexOf('/');
			const folder = item.file.slice(0, cut);
			const whose = folder.startsWith(HOMEBREW_ROOT)
				? $_('contentDrift.yourFile')
				: $_('contentDrift.packFile');
			const label = `${folder.slice(folder.lastIndexOf('/') + 1)} · ${whose}`;
			const group = byFolder.get(label) ?? { label, rows: [] };
			const dated = (key: string, date: string | undefined) =>
				date ? `${$_(key)} ${date}` : $_('contentDrift.unknownDate');
			group.rows.push({
				name: item.file.slice(cut + 1),
				left: { when: dated('contentDrift.declaredLabel', item.declaredDate) },
				right: { when: dated('contentDrift.changedLabel', item.changedAt) },
				keeps: checked[item.file] ? 'right' : null,
				toggle: () => (checked[item.file] = !checked[item.file]),
			});
			byFolder.set(label, group);
		}
		return [...byFolder.values()];
	});

	function apply() {
		onUpdate(items.filter((i) => checked[i.file]).map((i) => i.file));
	}
</script>

<DialogShell
	titleId="drift-title"
	title={$_('contentDrift.title')}
	sub={$_('contentDrift.count', { values: { count: items.length } })}
	subtitle={$_('contentDrift.subtitle')}
	width="min(860px, calc(100vw - 2 * var(--space-4)))"
	onDismiss={onSkip}
>
	<div class="dialog-body">
		<FileCompare
			left={{ title: $_('contentDrift.lastWritten'), detail: $_('contentDrift.lastWrittenDetail') }}
			right={{ title: $_('contentDrift.onDisk'), detail: '' }}
			{groups}
			keepsLabel={$_('contentDrift.kept')}
			toggleLabel={$_('contentDrift.toggle')}
		/>
		<p class="explain">{$_('contentDrift.explain')}</p>
	</div>

	<footer class="dialog-foot">
		<button class="btn" onclick={onSkip}>{$_('contentDrift.skip')}</button>
		<button class="btn ghost link" onclick={onNeverAsk}>{$_('contentDrift.neverAsk')}</button>
		<span class="dialog-spacer"></span>
		<button class="btn primary" onclick={apply} disabled={!anyChecked}
			>{$_('contentDrift.update')}</button
		>
	</footer>
</DialogShell>

<style>
	.explain {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	/* "don't ask again" is a way out said as a link, not a third button beside the answer */
	.link {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
