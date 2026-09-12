<script lang="ts">
	// Searchable language dropdown — one shared control for the translate view's FROM and TO pickers
	// (shared-ui-controls-one-component). Shows the current value by its native name, opens a panel with
	// a type-to-filter search over the loaded content locales plus (when `allowAdd`) every other known
	// language, so a new target language is one click away. Picking an "add" language just sets the
	// value to that code — translating + saving then creates its columns (no separate schema step).
	import Icon from './Icon.svelte';
	import { _ } from '$lib/i18n';
	import { languageName, languageSearchText, addableLanguages } from '$lib/i18n/languages';

	let {
		value = $bindable(),
		locales,
		allowAdd = false,
		accent = false,
	}: {
		value: string;
		/** currently-loaded content locales (the "Current" section). */
		locales: string[];
		/** also offer every other known language to translate INTO (the "Add a language" section). */
		allowAdd?: boolean;
		/** style the trigger with the accent colour (used for the TO picker). */
		accent?: boolean;
	} = $props();

	let open = $state(false);
	let query = $state('');

	// match by native / English / Ukrainian name or code (languageSearchText), so a language is findable
	// however the user spells it — incl. minority ones Intl.DisplayNames can't name (crh, rue, …).
	const match = (code: string) => {
		const q = query.trim().toLowerCase();
		return !q || languageSearchText(code).includes(q);
	};
	const current = $derived(
		locales.map((code) => ({ code, name: languageName(code) })).filter((o) => match(o.code)),
	);
	const addable = $derived(allowAdd ? addableLanguages(locales).filter((o) => match(o.code)) : []);

	function choose(code: string) {
		value = code;
		open = false;
		query = '';
	}

	// close on an outside click/tap (capture phase, before inner handlers)
	function root(node: HTMLElement) {
		const onDown = (e: Event) => {
			if (open && !node.contains(e.target as Node)) open = false;
		};
		document.addEventListener('pointerdown', onDown, true);
		return { destroy: () => document.removeEventListener('pointerdown', onDown, true) };
	}
</script>

<div class="lang-picker" use:root>
	<button class="trigger" class:accent aria-expanded={open} onclick={() => (open = !open)}>
		<span class="name">{languageName(value)}</span>
		<span class="code">{value.toUpperCase()}</span>
		<span class="caret"><Icon name="chevron-down" size={12} /></span>
	</button>

	{#if open}
		<!-- a panel of buttons with a search box in it, and no role that claims otherwise: it held
		     `listbox` while containing an input, section headings and not one `option` -->
		<div class="menu">
			<input
				class="search"
				placeholder={$_('languagePicker.search')}
				bind:value={query}
				onkeydown={(e) => e.key === 'Escape' && (open = false)}
			/>
			{#if current.length}
				<div class="section eyebrow">{$_('languagePicker.loaded')}</div>
				{#each current as o (o.code)}
					<button class="opt" class:sel={o.code === value} onclick={() => choose(o.code)}>
						<span class="opt-name">{o.name}</span><span class="opt-code">{o.code}</span>
					</button>
				{/each}
			{/if}
			{#if addable.length}
				<div class="section eyebrow">{$_('languagePicker.addLanguage')}</div>
				{#each addable as o (o.code)}
					<button class="opt add" onclick={() => choose(o.code)}>
						<span class="opt-name">{o.name}</span><span class="opt-code"
							><Icon name="plus" size={11} /> {o.code}</span
						>
					</button>
				{/each}
			{/if}
			{#if current.length === 0 && addable.length === 0}
				<p class="empty">{$_('languagePicker.empty', { values: { query } })}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.lang-picker {
		position: relative;
		display: inline-block;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-md);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-3);
		color: var(--color-text);
		cursor: pointer;
	}
	.trigger.accent {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.trigger .code {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.trigger .caret {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		inset-inline-start: 0;
		z-index: 30;
		width: 260px;
		max-height: 340px;
		overflow: auto;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-2);
		padding: var(--space-2);
	}
	.search {
		width: 100%;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-2-5);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-1-5);
	}
	.section {
		font-size: var(--font-size-micro);
		padding: var(--space-2) var(--space-2) var(--space-1);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		text-align: start;
		background: transparent;
		border: 0;
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-2);
		color: var(--color-text);
		cursor: pointer;
	}
	.opt:hover {
		background: var(--color-surface-2);
	}
	.opt.sel {
		background: var(--color-accent-soft);
		color: var(--color-accent-bright);
	}
	.opt-name {
		font-size: var(--font-size-body);
		flex: 1;
	}
	.opt-code {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.opt.add .opt-code {
		color: var(--color-good);
	}
	.empty {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		padding: var(--space-2);
		margin: 0;
	}
</style>
