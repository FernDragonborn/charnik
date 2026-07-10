<script lang="ts">
	// Searchable language dropdown — one shared control for the translate view's FROM and TO pickers
	// (shared-ui-controls-one-component). Shows the current value by its native name, opens a panel with
	// a type-to-filter search over the loaded content locales plus (when `allowAdd`) every other known
	// language, so a new target language is one click away. Picking an "add" language just sets the
	// value to that code — translating + saving then creates its columns (no separate schema step).
	import { languageName, languageSearchText, addableLanguages } from '$lib/i18n/languages';

	let {
		value = $bindable(),
		locales,
		allowAdd = false,
		accent = false
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
		locales.map((code) => ({ code, name: languageName(code) })).filter((o) => match(o.code))
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
	<button
		class="trigger"
		class:accent
		aria-haspopup="listbox"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="name">{languageName(value)}</span>
		<span class="code">{value.toUpperCase()}</span>
		<span class="caret">▾</span>
	</button>

	{#if open}
		<div class="menu" role="listbox">
			<input
				class="search"
				placeholder="Search language…"
				bind:value={query}
				onkeydown={(e) => e.key === 'Escape' && (open = false)}
			/>
			{#if current.length}
				<div class="section">Loaded</div>
				{#each current as o (o.code)}
					<button class="opt" class:sel={o.code === value} onclick={() => choose(o.code)}>
						<span class="opt-name">{o.name}</span><span class="opt-code">{o.code}</span>
					</button>
				{/each}
			{/if}
			{#if addable.length}
				<div class="section">Add a language</div>
				{#each addable as o (o.code)}
					<button class="opt add" onclick={() => choose(o.code)}>
						<span class="opt-name">{o.name}</span><span class="opt-code">＋ {o.code}</span>
					</button>
				{/each}
			{/if}
			{#if current.length === 0 && addable.length === 0}
				<p class="empty">No language matches “{query}”.</p>
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
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		padding: 6px 12px;
		color: var(--color-text);
		cursor: pointer;
	}
	.trigger.accent {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.trigger .code {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.trigger .caret {
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 30;
		width: 260px;
		max-height: 340px;
		overflow: auto;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 10px;
		box-shadow: var(--shadow-2);
		padding: 8px;
	}
	.search {
		width: 100%;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 7px 10px;
		color: var(--color-text);
		font-size: 13px;
		margin-bottom: 6px;
	}
	.section {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 8px 8px 4px;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: 7px;
		padding: 7px 9px;
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
		font-size: 14px;
		flex: 1;
	}
	.opt-code {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.opt.add .opt-code {
		color: var(--color-good);
	}
	.empty {
		color: var(--color-text-muted);
		font-size: 13px;
		padding: 8px;
		margin: 0;
	}
</style>
