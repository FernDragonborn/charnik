<script lang="ts">
	// Settings ▸ Themes — author custom colour themes without a rebuild. Each theme is a token-override
	// object; editing writes it LIVE (the layout injector mirrors `app.customThemes` into a
	// `[data-theme=id]` style element), and PERSISTS as one JSON file per theme under `themes/` in the
	// data dir (via the Storage seam), so a theme is a portable file you can share / hand-edit — like
	// the CSV content packs. Built-in dark/light are read-only bases you clone from; the bundled
	// Dracula/Catppuccin presets are worked examples you can add.
	import { toast } from 'svelte-sonner';
	import { app } from '$lib/stores/app.svelte';
	import {
		THEMEABLE_TOKENS,
		snapshotBaseTokens,
		type CustomTheme,
		type ThemeableToken
	} from '$lib/styles/customThemes';
	import {
		writeThemeFile,
		removeThemeFile,
		serializeTheme,
		themeFromJson,
		uniqueThemeId
	} from '$lib/styles/themeFiles';
	import { getUserStorage } from '$lib/storage/provider';

	type Mode = { view: 'list' } | { view: 'edit'; id: string };
	let mode = $state<Mode>({ view: 'list' });
	let fileInput = $state<HTMLInputElement | null>(null);

	const editing = $derived.by(() => {
		if (mode.view !== 'edit') return undefined;
		const id = mode.id;
		return app.customThemes.find((t) => t.id === id);
	});

	// the colour tokens get a native picker; overlay/shadow are free-form (rgb / multi-value) → text only
	const isColorToken = (t: ThemeableToken) => t.startsWith('color-');
	const isHex6 = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v.trim());
	const takenIds = () => app.customThemes.map((t) => t.id);

	// --- persistence (one JSON file per theme, via the Storage seam) ----------------------------
	const persist = (theme: CustomTheme) =>
		void writeThemeFile(getUserStorage(), theme).catch(() => {});
	// edits (typing a hex) debounce their file write; the live preview is instant regardless
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleSave(id: string) {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			const t = app.customThemes.find((x) => x.id === id);
			if (t) persist(t);
		}, 400);
	}

	function addTheme(theme: CustomTheme, { activate: act = false, edit = false } = {}) {
		app.customThemes = [...app.customThemes, theme];
		persist(theme);
		if (act) app.theme = theme.id;
		if (edit) mode = { view: 'edit', id: theme.id };
	}

	/** Clone any base theme (built-in dark/light OR a bundled palette) into a new editable copy. Reads
	 *  the base's live token values via the injected `[data-theme]` rule, so the copy is self-contained. */
	function cloneTheme(base: string, baseName: string) {
		const name = `${baseName} copy`;
		const theme: CustomTheme = {
			id: uniqueThemeId(name, takenIds()),
			name,
			tokens: snapshotBaseTokens(base)
		};
		addTheme(theme, { activate: true, edit: true }); // activate so the editor previews live
	}

	function duplicate(src: CustomTheme) {
		const name = `${src.name} copy`;
		addTheme(
			{ id: uniqueThemeId(name, takenIds()), name, tokens: { ...src.tokens } },
			{ edit: true }
		);
	}

	function remove(id: string) {
		app.customThemes = app.customThemes.filter((t) => t.id !== id);
		void removeThemeFile(getUserStorage(), id);
		if (app.theme === id) app.theme = 'dark'; // don't leave <html> pointing at a deleted theme
		if (mode.view === 'edit' && mode.id === id) mode = { view: 'list' };
	}

	/** Patch one field of a custom theme (name or a token value) immutably, so the store change is
	 *  reactive (live preview), then debounce-save the file. */
	function patch(id: string, fn: (t: CustomTheme) => CustomTheme) {
		app.customThemes = app.customThemes.map((t) => (t.id === id ? fn(t) : t));
		scheduleSave(id);
	}
	const setName = (id: string, name: string) => patch(id, (t) => ({ ...t, name }));
	const setToken = (id: string, token: ThemeableToken, value: string) =>
		patch(id, (t) => ({ ...t, tokens: { ...t.tokens, [token]: value } }));

	// --- export / import as a standalone .json file (sharing) -----------------------------------
	function exportTheme(theme: CustomTheme) {
		const blob = new Blob([serializeTheme(theme)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${theme.id}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}
	async function onImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-picking the same file
		if (!file) return;
		let raw: unknown;
		try {
			raw = JSON.parse(await file.text());
		} catch {
			toast('That file isn’t valid JSON');
			return;
		}
		const theme = themeFromJson(raw, file.name.replace(/\.json$/, ''), takenIds());
		if (!theme) {
			toast('No themeable tokens in that file');
			return;
		}
		addTheme(theme, { activate: true });
		toast(`Imported “${theme.name}”`);
	}

	const activate = (id: string) => (app.theme = id);
	const label = (token: ThemeableToken) => token.replace(/^color-/, '').replace(/-/g, ' ');

	// dark/light are the only truly built-in themes (from tokens.css) — always present, not deletable.
	// The bundled palettes (Dracula/Catppuccin) are seeded as ordinary custom themes, so they live in
	// the list below with everything else (editable + deletable; the only difference is they ship).
	const BUILT_INS = [
		{ id: 'dark', name: '☾ Dark', clean: 'Dark' },
		{ id: 'light', name: '☀ Light', clean: 'Light' }
	];
	const SWATCHES = ['color-bg', 'color-surface', 'color-accent', 'color-resource', 'color-good'];
</script>

<section class="sec-head">
	<h2>Themes</h2>
	<p class="sec-note">
		Build your own colour theme by overriding the design tokens. Clone Dark or Light, tweak the
		swatches, and it applies live. Each theme is a JSON file (in your data folder) you can share or
		hand-edit.
	</p>
</section>

{#if mode.view === 'list'}
	<div class="themes-toolbar">
		<button class="btn ghost" onclick={() => fileInput?.click()}>⬆ Import theme…</button>
		<input
			bind:this={fileInput}
			type="file"
			accept="application/json,.json"
			class="hidden-file"
			onchange={onImportFile}
		/>
	</div>
	<div class="theme-grid">
		<!-- dark / light: the only non-deletable themes (they live in tokens.css) -->
		{#each BUILT_INS as b (b.id)}
			<div class="theme-card" class:active={app.theme === b.id}>
				<button class="theme-pick" onclick={() => activate(b.id)}>
					<span class="theme-name">{b.name}</span>
					<span class="theme-tag eyebrow">built-in</span>
				</button>
				<div class="theme-actions">
					<button class="btn ghost" onclick={() => cloneTheme(b.id, b.clean)}>Clone</button>
				</div>
			</div>
		{/each}

		<!-- every other theme: the seeded bundled palettes + the user's own — all editable + deletable -->
		{#each app.customThemes as t (t.id)}
			<div class="theme-card" class:active={app.theme === t.id}>
				<button class="theme-pick" onclick={() => activate(t.id)}>
					<span class="theme-name">{t.name}</span>
					<span class="theme-swatches">
						{#each SWATCHES as s (s)}
							<span class="swatch" style="background: {t.tokens[s] ?? 'transparent'}"></span>
						{/each}
					</span>
				</button>
				<div class="theme-actions">
					<button class="btn ghost" onclick={() => (mode = { view: 'edit', id: t.id })}>Edit</button
					>
					<button class="btn ghost" onclick={() => duplicate(t)}>Duplicate</button>
					<button class="btn ghost" onclick={() => exportTheme(t)}>Export</button>
					<button class="btn ghost danger" onclick={() => remove(t.id)}>Delete</button>
				</div>
			</div>
		{/each}
	</div>
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
				<span class="token-label eyebrow">{label(token)}</span>
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
	.themes-toolbar {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 12px;
	}
	.hidden-file {
		display: none;
	}
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
		font-size: var(--font-size-micro);
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
		font-size: var(--font-size-micro);
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
