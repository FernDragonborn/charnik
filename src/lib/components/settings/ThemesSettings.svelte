<script lang="ts">
	// Settings ▸ Themes — author custom colour themes without a rebuild. Themes are token overrides
	// stored on the `app` store (persisted); editing writes them LIVE, and the layout's injector
	// (customThemes.ts) mirrors them into a `[data-theme=id]` style element, so activating a theme +
	// editing its tokens preview instantly. Built-in dark/light are read-only bases you clone from.
	import { app } from '$lib/stores/app.svelte';
	import {
		THEMEABLE_TOKENS,
		snapshotBaseTokens,
		isSafeThemeId,
		type CustomTheme,
		type ThemeableToken
	} from '$lib/styles/customThemes';

	type Mode = { view: 'list' } | { view: 'edit'; id: string };
	let mode = $state<Mode>({ view: 'list' });

	const editing = $derived.by(() => {
		if (mode.view !== 'edit') return undefined;
		const id = mode.id;
		return app.customThemes.find((t) => t.id === id);
	});

	// the colour tokens get a native picker; overlay/shadow are free-form (rgb / multi-value) → text only
	const isColorToken = (t: ThemeableToken) => t.startsWith('color-');
	const isHex6 = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v.trim());

	/** A collision-free, selector-safe slug for a new theme id, derived from its name. */
	function makeId(name: string): string {
		const stem =
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 32) || 'theme';
		let id = stem;
		let n = 2;
		const taken = new Set(app.customThemes.map((t) => t.id));
		while (!isSafeThemeId(id) || taken.has(id)) id = `${stem}-${n++}`;
		return id;
	}

	function createTheme(base: 'dark' | 'light') {
		const name = base === 'dark' ? 'My dark theme' : 'My light theme';
		const theme: CustomTheme = { id: makeId(name), name, tokens: snapshotBaseTokens(base) };
		app.customThemes = [...app.customThemes, theme];
		app.theme = theme.id; // activate so the editor previews live
		mode = { view: 'edit', id: theme.id };
	}

	function duplicate(src: CustomTheme) {
		const name = `${src.name} copy`;
		const theme: CustomTheme = { id: makeId(name), name, tokens: { ...src.tokens } };
		app.customThemes = [...app.customThemes, theme];
		mode = { view: 'edit', id: theme.id };
	}

	function remove(id: string) {
		app.customThemes = app.customThemes.filter((t) => t.id !== id);
		if (app.theme === id) app.theme = 'dark'; // don't leave <html> pointing at a deleted theme
		if (mode.view === 'edit' && mode.id === id) mode = { view: 'list' };
	}

	/** Patch one field of a custom theme (name or a token value) immutably, so the store change is
	 *  reactive and the injector re-runs (live preview). */
	function patch(id: string, fn: (t: CustomTheme) => CustomTheme) {
		app.customThemes = app.customThemes.map((t) => (t.id === id ? fn(t) : t));
	}
	const setName = (id: string, name: string) => patch(id, (t) => ({ ...t, name }));
	const setToken = (id: string, token: ThemeableToken, value: string) =>
		patch(id, (t) => ({ ...t, tokens: { ...t.tokens, [token]: value } }));

	const activate = (id: string) => (app.theme = id);
	const label = (token: ThemeableToken) => token.replace(/^color-/, '').replace(/-/g, ' ');
</script>

<section class="sec-head">
	<h2>Themes</h2>
	<p class="sec-note">
		Build your own colour theme by overriding the design tokens. Clone Dark or Light, tweak the
		swatches, and it applies live. Themes are saved on this device and activate like the built-ins.
	</p>
</section>

{#if mode.view === 'list'}
	<div class="theme-grid">
		<!-- built-in bases (read-only) -->
		{#each [{ id: 'dark', name: '☾ Dark' }, { id: 'light', name: '☀ Light' }] as b (b.id)}
			<div class="theme-card" class:active={app.theme === b.id}>
				<button class="theme-pick" onclick={() => activate(b.id)}>
					<span class="theme-name">{b.name}</span>
					<span class="theme-tag">built-in</span>
				</button>
				<div class="theme-actions">
					<button class="btn ghost" onclick={() => createTheme(b.id as 'dark' | 'light')}
						>Clone</button
					>
				</div>
			</div>
		{/each}

		<!-- user themes -->
		{#each app.customThemes as t (t.id)}
			<div class="theme-card" class:active={app.theme === t.id}>
				<button class="theme-pick" onclick={() => activate(t.id)}>
					<span class="theme-name">{t.name}</span>
					<span class="theme-swatches">
						{#each ['color-bg', 'color-surface', 'color-accent', 'color-resource', 'color-good'] as s (s)}
							<span class="swatch" style="background: {t.tokens[s] ?? 'transparent'}"></span>
						{/each}
					</span>
				</button>
				<div class="theme-actions">
					<button class="btn ghost" onclick={() => (mode = { view: 'edit', id: t.id })}>Edit</button
					>
					<button class="btn ghost" onclick={() => duplicate(t)}>Duplicate</button>
					<button class="btn ghost danger" onclick={() => remove(t.id)}>Delete</button>
				</div>
			</div>
		{/each}
	</div>

	{#if app.customThemes.length === 0}
		<p class="empty-note">No custom themes yet — Clone a built-in to start.</p>
	{/if}
{:else if editing}
	<!-- editor -->
	<div class="editor-head">
		<button class="btn ghost" onclick={() => (mode = { view: 'list' })}>← Back</button>
		<input
			class="text-field name-input"
			value={editing.name}
			oninput={(e) => setName(editing.id, e.currentTarget.value)}
			placeholder="Theme name"
		/>
		<button
			class="btn primary"
			class:active={app.theme === editing.id}
			onclick={() => activate(editing.id)}
		>
			{app.theme === editing.id ? '● Active' : 'Activate & preview'}
		</button>
	</div>

	<div class="token-grid">
		{#each THEMEABLE_TOKENS as token (token)}
			{@const value = editing.tokens[token] ?? ''}
			<div class="token-row">
				<span class="token-label">{label(token)}</span>
				{#if isColorToken(token) && isHex6(value)}
					<input
						class="color-input"
						type="color"
						value={value.trim()}
						oninput={(e) => setToken(editing.id, token, e.currentTarget.value)}
						aria-label="{label(token)} colour"
					/>
				{:else}
					<span class="swatch swatch-lg" style="background: {value || 'transparent'}"></span>
				{/if}
				<input
					class="text-field token-value"
					{value}
					oninput={(e) => setToken(editing.id, token, e.currentTarget.value)}
					aria-label={label(token)}
				/>
			</div>
		{/each}
	</div>
{/if}

<style>
	.theme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 12px;
	}
	.theme-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 12px;
	}
	.theme-card.active {
		border-color: var(--color-accent);
	}
	.theme-pick {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		background: transparent;
		border: 0;
		cursor: pointer;
		text-align: left;
		padding: 0;
		color: var(--color-text);
	}
	.theme-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
	}
	.theme-tag {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-text-muted);
	}
	.theme-swatches {
		display: flex;
		gap: 4px;
	}
	.swatch {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		border: 1px solid var(--color-border-strong);
	}
	.swatch-lg {
		width: 30px;
		height: 26px;
		flex: none;
	}
	.theme-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.btn.danger:hover {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}
	.empty-note {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		margin-top: 12px;
	}
	.editor-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 18px;
	}
	.name-input {
		flex: 1;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
		padding: 7px 10px;
	}
	.btn.primary.active {
		background: var(--color-good);
		border-color: var(--color-good);
	}
	.token-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 8px 16px;
	}
	.token-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.token-label {
		flex: 0 0 96px;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.color-input {
		flex: none;
		width: 30px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: 4px;
		background: transparent;
		cursor: pointer;
	}
	.token-value {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		padding: 4px 7px;
	}
</style>
