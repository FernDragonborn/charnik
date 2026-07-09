<script lang="ts">
	// Homebrew authoring — the compendium article, but its fields are editable. Same chrome as
	// WikiDetail (eyebrow · title · meta grid · body) so adding content feels like editing the
	// page you were just reading. Binds a flat draft, validates + writes via the homebrew pipeline
	// (schema-checked, UTF-8-BOM/CRLF, atomic), then hands the new id back to the caller.
	import { onMount } from 'svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { resetContentGraph, CONTENT_ROOTS } from '$lib/content/provider';
	import {
		fieldsFor,
		blankDraft,
		slugify,
		saveHomebrewRow,
		homebrewFile,
		newHomebrewFile,
		isShippedFile,
		listTypeTargets,
		type TargetFile
	} from '$lib/content/homebrew';
	import { SYSTEMS, splitList, type ContentType } from '$lib/content/schemas';
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';

	// Localised field label. A localizable column (name_<loc> / text_<loc>) shows the base label plus
	// the locale tag when it isn't the current UI language (e.g. "Name (uk)" in an EN interface);
	// structural columns use their catalog key, falling back to fieldsFor's English label.
	function fieldLabel(name: string, fallback: string): string {
		const m = /^(name|text)_([a-z-]+)$/.exec(name);
		if (m) {
			const base = $_(`contentField.${m[1]}`);
			return m[2] === app.activeLocale ? base : `${base} (${m[2]})`;
		}
		return $_(`contentField.${name}`, { default: fallback });
	}

	let {
		type,
		onsave,
		oncancel
	}: { type: ContentType; onsave: (id: string) => void; oncancel: () => void } = $props();

	// initial-only capture is intended: the parent remounts this form with {#key type}, so the
	// draft resets cleanly whenever the type changes.
	// svelte-ignore state_referenced_locally
	let draft = $state(blankDraft(type));
	let issues = $state<string[]>([]);
	let saving = $state(false);

	// WHERE to save this row. Default = the safe homebrew file; the picker also lists existing files
	// (incl. shipped ones, which warn). `sel` holds the chosen file path or the NEW_FILE sentinel.
	const NEW_FILE = '__new__';
	let targets = $state<TargetFile[]>([]);
	// svelte-ignore state_referenced_locally
	let sel = $state(homebrewFile(type));
	let newFileName = $state('');
	const target = $derived(sel === NEW_FILE ? newHomebrewFile(type, newFileName) : sel);
	const targetShipped = $derived(isShippedFile(target, CONTENT_ROOTS));
	onMount(async () => {
		targets = await listTypeTargets(getUserStorage(), type, CONTENT_ROOTS);
	});

	const fields = $derived(fieldsFor(type));
	const bodyFields = $derived(fields.filter((f) => f.kind === 'textarea'));
	// everything the meta grid renders: not the title, body, systems or id (those get their own row)
	const metaFields = $derived(
		fields.filter((f) => !['name_en', 'systems', 'id'].includes(f.name) && f.kind !== 'textarea')
	);

	function toggleSystem(sys: string) {
		const set = new Set(splitList(draft.systems));
		if (set.has(sys)) set.delete(sys);
		else set.add(sys);
		draft.systems = [...set].join(',');
	}
	const hasSystem = (sys: string) => splitList(draft.systems).includes(sys);

	async function save() {
		if (targetShipped) return; // never write a shipped file (the UI also blocks this)
		issues = [];
		saving = true;
		try {
			const res = await saveHomebrewRow(getUserStorage(), type, draft, target);
			if (!res.ok) {
				issues = res.issues ?? ['Could not save'];
				return;
			}
			resetContentGraph();
			if (res.id) onsave(res.id);
		} finally {
			saving = false;
		}
	}
</script>

<article class="detail-body edit">
	<div class="deyebrow">{type.replace(/_/g, ' ')} · new homebrew</div>
	<input class="titlein" placeholder="Name" bind:value={draft.name_en} />
	<div class="id-row">
		<span class="id-label">id</span>
		<input
			class="id-input"
			placeholder={slugify(draft.name_en ?? '') || 'auto'}
			bind:value={draft.id}
		/>
	</div>
	<p class="id-hint">{$_('homebrewForm.idHint')}</p>

	<div class="systems-row">
		<span class="systems-label">Editions</span>
		{#each SYSTEMS as sys (sys)}
			<button
				type="button"
				class="syschip"
				class:on={hasSystem(sys)}
				onclick={() => toggleSystem(sys)}>{sys}</button
			>
		{/each}
	</div>

	{#if metaFields.length}
		<div class="detail-meta">
			{#each metaFields as f (f.name)}
				<label class="meta-cell">
					<span class="meta-key"
						>{fieldLabel(f.name, f.label)}{#if f.required}<span class="required-mark">*</span
							>{/if}</span
					>
					{#if f.kind === 'enum'}
						<select bind:value={draft[f.name]}>
							<option value="">—</option>
							{#each f.options ?? [] as opt (opt)}<option value={opt}>{opt}</option>{/each}
						</select>
					{:else if f.kind === 'bool'}
						<button
							type="button"
							class="bool"
							class:on={draft[f.name] === 'true'}
							onclick={() => (draft[f.name] = draft[f.name] === 'true' ? 'false' : 'true')}
							aria-pressed={draft[f.name] === 'true'}
							aria-label={fieldLabel(f.name, f.label)}
						>
							<span class="knob"></span>
						</button>
					{:else if f.kind === 'number'}
						<input type="number" bind:value={draft[f.name]} />
					{:else}
						<input type="text" bind:value={draft[f.name]} />
					{/if}
				</label>
			{/each}
		</div>
	{/if}

	{#each bodyFields as f (f.name)}
		<textarea
			class="body-input"
			placeholder={fieldLabel(f.name, f.label)}
			bind:value={draft[f.name]}></textarea>
	{/each}

	<div class="target-row">
		<span class="systems-label">{$_('homebrewForm.targetLabel')}</span>
		<select class="target-select" bind:value={sel}>
			<option value={homebrewFile(type)}>{$_('homebrewForm.targetHomebrew')}</option>
			{#each targets.filter((t) => t.file !== homebrewFile(type)) as t (t.file)}
				<option value={t.file}
					>{t.file}{t.shipped ? ` · ${$_('homebrewForm.targetShippedTag')}` : ''}</option
				>
			{/each}
			<option value={NEW_FILE}>{$_('homebrewForm.targetNewFile')}</option>
		</select>
		{#if sel === NEW_FILE}
			<input
				class="id-input"
				placeholder={$_('homebrewForm.newFilePlaceholder')}
				bind:value={newFileName}
			/>
		{/if}
	</div>

	{#if targetShipped}
		<div class="shipped-warn">
			<b>⚠ {$_('homebrewForm.srdWarnTitle')}</b>
			<p>{$_('homebrewForm.srdWarnBody')}</p>
			<button type="button" class="btn primary" onclick={() => (sel = homebrewFile(type))}
				>{$_('homebrewForm.srdWarnAction')}</button
			>
		</div>
	{/if}

	{#if issues.length}
		<div class="issues">
			<b>Fix before saving:</b>
			<ul>
				{#each issues as msg (msg)}<li>{msg}</li>{/each}
			</ul>
		</div>
	{/if}

	<div class="actions">
		<button type="button" class="save" onclick={save} disabled={saving || targetShipped}>
			{saving ? 'Saving…' : 'Save homebrew'}
		</button>
		<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
	</div>
	<div class="source-line">Homebrew · you own this row (stored as CSV you can edit)</div>
</article>

<style>
	.titlein {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 28px;
		margin: 6px 0 8px;
		width: 100%;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		padding: 2px 0;
	}
	.titlein:focus {
		outline: none;
		border-bottom-color: var(--color-accent);
	}
	.id-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
	}
	.id-label,
	.systems-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.id-input {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 3px 8px;
		color: var(--color-text-muted);
	}
	.id-hint {
		margin: -8px 0 14px;
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.target-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin: 18px 0 8px;
	}
	.target-select {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 4px 8px;
		color: var(--color-text);
	}
	.shipped-warn {
		border: 1px solid var(--color-danger, #b3452f);
		background: var(--color-danger-soft, rgba(179, 69, 47, 0.1));
		border-radius: 10px;
		padding: 12px 14px;
		margin-bottom: 12px;
	}
	.shipped-warn b {
		color: var(--color-danger, #d06a52);
		font-size: 14px;
	}
	.shipped-warn p {
		margin: 6px 0 10px;
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text-muted);
	}
	.systems-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
	}
	.syschip {
		font-family: var(--font-mono);
		font-size: 12px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 4px 12px;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.syschip:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.syschip.on {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
		background: var(--color-accent-soft);
	}
	.meta-cell {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 7px 11px;
	}
	.meta-cell .meta-key {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.required-mark {
		color: var(--color-accent-bright);
	}
	.meta-cell input,
	.meta-cell select {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		padding: 2px 0;
		width: 100%;
	}
	.meta-cell input:focus,
	.meta-cell select:focus {
		outline: none;
		border-bottom-color: var(--color-accent);
	}
	.bool {
		align-self: flex-start;
		width: 38px;
		height: 20px;
		border-radius: 999px;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface-2);
		position: relative;
		cursor: pointer;
		padding: 0;
	}
	.bool .knob {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-text-muted);
		transition:
			left 0.12s,
			background 0.12s;
	}
	.bool.on {
		background: var(--color-good);
		border-color: var(--color-good);
	}
	.bool.on .knob {
		left: 19px;
		background: #fff;
	}
	.body-input {
		width: 100%;
		min-height: 120px;
		font-family: inherit;
		font-size: 14px;
		line-height: 1.5;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		color: var(--color-text);
		padding: 10px 12px;
		margin-bottom: 12px;
		resize: vertical;
	}
	.body-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.issues {
		border: 1px solid var(--color-danger, #b3452f);
		background: var(--color-danger-soft, rgba(179, 69, 47, 0.1));
		border-radius: 10px;
		padding: 10px 14px;
		margin-bottom: 12px;
		font-size: 13px;
		color: var(--color-text);
	}
	.issues ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
	.actions {
		display: flex;
		gap: 10px;
		margin-bottom: 14px;
	}
	.save {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		background: var(--color-accent);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 9px 18px;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.cancel {
		font-family: var(--font-display);
		font-size: 14px;
		background: transparent;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 9px 16px;
		cursor: pointer;
	}
	.cancel:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
</style>
