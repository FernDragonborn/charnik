<script lang="ts">
	// Ctrl/Cmd+K command + global content search. Pages navigate via the router; content is
	// fuzzy-searched (name + article text) over the reactive content store and opens the entry
	// in the compendium (deep-link route). Search core lives in $lib/content/search.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { content, loadContentStore } from '$lib/content/store.svelte';
	import { makeNameIndex, makeTextIndex, searchContent } from '$lib/content/search';

	interface PageItem {
		kind: 'page';
		key: string;
		label: string;
		href: string;
	}
	interface ContentItem {
		kind: 'content';
		key: string;
		type: string;
		source: string;
		slug: string;
		label: string;
		snippet: string;
		systems: string[];
	}
	type Item = PageItem | ContentItem;

	const COMMANDS = [
		{ key: 'roster', labelKey: 'nav.roster', href: '/' },
		{ key: 'combat', labelKey: 'nav.combat', href: '/combat' },
		{ key: 'compendium', labelKey: 'nav.compendium', href: '/compendium' },
		{ key: 'settings', labelKey: 'nav.settings', href: '/settings' }
	];

	let open = $state(false);
	let query = $state('');
	let active = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let restoreEl: HTMLElement | null = null;

	// name index rebuilds on content change; text index on content OR locale change (edition is
	// a post-filter, never a rebuild). Both derived from the reactive store.
	const nameIndex = $derived(content.graph ? makeNameIndex(content.graph) : null);
	const textIndex = $derived(content.graph ? makeTextIndex(content.graph, app.activeLocale) : null);

	const pages = $derived<PageItem[]>(
		COMMANDS.filter((c) => $_(c.labelKey).toLowerCase().includes(query.trim().toLowerCase())).map(
			(c) => ({ kind: 'page', key: c.key, label: $_(c.labelKey), href: c.href })
		)
	);
	const contentItems = $derived<ContentItem[]>(
		nameIndex && textIndex
			? searchContent(nameIndex, textIndex, query, {
					editions: app.activeEditions,
					locale: app.activeLocale
				}).map((r) => ({
					kind: 'content',
					key: r.effectiveId,
					type: r.type,
					source: r.source,
					slug: r.id,
					label: r.name,
					snippet: r.snippet,
					systems: r.systems
				}))
			: []
	);
	const items = $derived<Item[]>([...pages, ...contentItems]);

	const typeName = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
	// header shown before the first item of each group (Pages, then each content type)
	const groupOf = (it: Item) => (it.kind === 'page' ? 'Pages' : typeName(it.type));

	function openPalette() {
		restoreEl = document.activeElement as HTMLElement;
		query = '';
		active = 0;
		open = true;
		loadContentStore();
	}
	function closePalette() {
		open = false;
		restoreEl?.focus();
	}
	function run(it: Item | undefined) {
		if (!it) return;
		closePalette();
		if (it.kind === 'page') goto(`${base}${it.href}`);
		else goto(`${base}/compendium/${it.type}/${encodeURIComponent(it.source)}/${it.slug}`);
	}

	function onWindowKeydown(e: KeyboardEvent) {
		// physical key (e.code) so Ctrl+K fires on any layout (Cyrillic etc.)
		if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
			e.preventDefault();
			if (open) closePalette();
			else openPalette();
		}
	}
	function onPaletteKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closePalette();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % Math.max(items.length, 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = (active - 1 + items.length) % Math.max(items.length, 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			run(items[active]);
		}
	}

	$effect(() => {
		if (active >= items.length) active = 0;
	});
	$effect(() => {
		if (open) inputEl?.focus();
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={closePalette}></div>
	<div
		class="palette"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-label={$_('nav.openCommandPalette')}
		onkeydown={onPaletteKeydown}
	>
		<input
			bind:this={inputEl}
			bind:value={query}
			class="input"
			type="text"
			role="combobox"
			aria-expanded="true"
			aria-controls="cmd-list"
			aria-activedescendant={items[active] ? `cmd-${items[active]?.key}` : undefined}
			placeholder={$_('command.placeholder')}
			autocomplete="off"
		/>
		<ul id="cmd-list" class="list" role="listbox">
			{#each items as it, i (it.key)}
				{#if i === 0 || groupOf(items[i - 1]!) !== groupOf(it)}
					<li class="group" role="presentation">{groupOf(it)}</li>
				{/if}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="cmd-{it.key}"
					role="option"
					aria-selected={i === active}
					class="item"
					class:active={i === active}
					onmousemove={() => (active = i)}
					onclick={() => run(it)}
				>
					{#if it.kind === 'content'}
						<span class="tbadge">{typeName(it.type)}</span>
						<span class="item-text">
							<span class="item-name">{it.label}</span>
							{#if it.snippet}<span class="item-snippet">{it.snippet}</span>{/if}
						</span>
						{#if app.activeEditions.length > 1}<span class="item-edition"
								>{it.systems.join(' · ')}</span
							>{/if}
					{:else}
						<span class="item-name">{it.label}</span>
					{/if}
				</li>
			{:else}
				<li class="empty">{$_('command.empty')}</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-overlay);
		z-index: 50;
	}
	.palette {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(600px, calc(100vw - 2 * var(--space-4)));
		z-index: 51;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
		overflow: hidden;
	}
	.input {
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		background: transparent;
		padding: var(--space-4);
		font-size: var(--font-size-lg);
		color: var(--color-text);
		outline: none;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: var(--space-1);
		max-height: 56vh;
		overflow: auto;
	}
	.group {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 8px 10px 4px;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.item.active {
		background: var(--color-surface-2);
	}
	.item-name {
		font-family: var(--font-display);
		font-weight: 600;
	}
	.item.active .item-name {
		color: var(--color-accent-bright);
	}
	.tbadge {
		flex: none;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 2px 6px;
	}
	.item-text {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.item-snippet {
		font-size: 12px;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.item-edition {
		flex: none;
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--color-text-muted);
	}
	.empty {
		padding: var(--space-3);
		color: var(--color-text-muted);
	}
</style>
