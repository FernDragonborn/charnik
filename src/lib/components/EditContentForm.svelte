<script lang="ts">
	// Homebrew authoring — the compendium article, but its fields are editable. Same chrome as
	// WikiDetail (eyebrow · title · meta grid · body) so adding content feels like editing the
	// page you were just reading. Binds a flat draft, validates + writes via the homebrew pipeline
	// (schema-checked, UTF-8-BOM/CRLF, atomic), then hands the new id back to the caller.
	import Icon from './Icon.svelte';
	import UpcastBuilder from './UpcastBuilder.svelte';
	import { onMount } from 'svelte';
	import { getUserStorage } from '$lib/storage/provider';
	import { resetContentGraph } from '$lib/content/provider';
	import {
		fieldsFor,
		blankDraft,
		saveHomebrewRow,
		upsertHomebrewRow,
		rowToDraft,
		homebrewFile,
		newHomebrewFile,
		isShippedFile,
		listTypeTargets,
		HOMEBREW_SOURCE,
		type TargetFile,
	} from '$lib/content/homebrew';
	import { slugify } from '$lib/util/slug';
	import type { LoadedRow } from '$lib/content/loader';
	import { content } from '$lib/content/store.svelte';
	import { classCasts } from '$lib/character/spellcasting';
	import ClassPicker from './ClassPicker.svelte';
	import { SYSTEMS, splitList, type ContentType } from '$lib/content/schemas';
	import { systemShortLabel } from '$lib/rules/pipeline';
	import {
		writeDraft,
		readDraft,
		deleteDraft,
		listDrafts,
		type DraftTarget,
	} from '$lib/drafts/store';
	import { isReadOnlyContent } from '$lib/config/demo';
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
		oncancel,
		resumeGuid,
		resumeDraft,
		editRow,
		ondelete,
	}: {
		type: ContentType;
		/** The saved row's id AND the type it was saved as — the caller's own type state can have
		 *  moved on (a URL effect restoring the browsed entry), and looking the row up under the
		 *  wrong type silently finds nothing. */
		onsave: (id: string, type: ContentType) => void;
		oncancel: () => void;
		/** When resuming a pending add-draft: its GUID + saved fields (else a fresh add-session).
		 *  `| undefined` is deliberate — these are optional passthrough from the parent's optional
		 *  `resumeAdd`, so `exactOptionalPropertyTypes` needs the explicit-undefined form. */
		resumeGuid?: string | undefined;
		resumeDraft?: Record<string, string> | undefined;
		/** Editor mode: edit an EXISTING row in place. A shipped SRD row forks to homebrew on save
		 *  (same id, source=Homebrew → sorts above the original); a homebrew row edits its own file. */
		editRow?: LoadedRow | undefined;
		/** Editing a homebrew row → offer to delete it (the page handles confirm + removal). */
		ondelete?: (() => void) | undefined;
	} = $props();

	// The installed content packs (SRD + anything the user added). A file under one of them is
	// pack-managed, so an edit there must fork into homebrew instead. The graph is loaded before
	// this form can exist — the row being edited came out of it.
	const packRoots = $derived(content.graph?.packRoots ?? []);

	// Editor mode is captured once (the parent remounts via {#key editRow.effectiveId}). Its save
	// target = the row's own homebrew file, or a fork into the homebrew file when the row ships.
	// svelte-ignore state_referenced_locally
	const editing = !!editRow;
	// svelte-ignore state_referenced_locally
	const editShipped = editRow ? isShippedFile(`${editRow.root}/${editRow.file}`, packRoots) : false;
	function saveTargetFile(): string | undefined {
		if (!editRow) return undefined;
		return editShipped ? homebrewFile(type) : `${editRow.root}/${editRow.file}`;
	}
	const editTarget = saveTargetFile();

	// A new entry has no id yet, so its draft is keyed by a stable per-session GUID (per
	// charnik-guid-not-counter): resumed from the pending list / an existing add-draft, else fresh.
	// An editor draft is keyed by the row it edits (kind:'editor').
	// svelte-ignore state_referenced_locally
	let addGuid = $state(resumeGuid ?? crypto.randomUUID());
	const draftCacheTarget = $derived<DraftTarget>(
		editRow
			? { kind: 'editor', type, source: editRow.source, id: editRow.id }
			: { kind: 'add', type, addGuid },
	);
	const readOnly = isReadOnlyContent();

	// initial-only capture is intended: the parent remounts this form with {#key type}, so the
	// draft resets cleanly whenever the type changes. Editor mode seeds from the row; a resumed
	// add-draft overlays the blank shape; else blank.
	function seedDraft() {
		if (editRow) return rowToDraft(editRow);
		return resumeDraft ? { ...blankDraft(type), ...resumeDraft } : blankDraft(type);
	}
	const initialDraft = seedDraft();
	let draft = $state(initialDraft);
	let baseline = $state(JSON.stringify(initialDraft));
	let issues = $state<string[]>([]);
	let saving = $state(false);

	// auto-save the in-progress new entry (debounced) once it diverges from blank — so a closed form
	// restores. An untouched form never spawns a draft. Skipped when content is read-only (demo).
	let writeTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const current = JSON.stringify(draft);
		clearTimeout(writeTimer);
		if (readOnly || current === baseline) return;
		const snapshot = { ...draft };
		writeTimer = setTimeout(
			() => void writeDraft(getUserStorage(), draftCacheTarget, snapshot),
			600,
		);
	});

	// WHERE to save this row. Default = the safe homebrew file; the picker also lists existing files
	// (incl. shipped ones, which warn). `sel` holds the chosen file path or the NEW_FILE sentinel.
	const NEW_FILE = '__new__';
	let targets = $state<TargetFile[]>([]);
	// svelte-ignore state_referenced_locally
	let sel = $state(homebrewFile(type));
	let newFileName = $state('');
	const target = $derived(sel === NEW_FILE ? newHomebrewFile(type, newFileName) : sel);
	const targetShipped = $derived(isShippedFile(target, packRoots));
	onMount(async () => {
		targets = await listTypeTargets(getUserStorage(), type, packRoots);
		// resume the most-recent unsaved add-draft for this type (unless the parent already handed us a
		// specific one to resume, we're editing an existing row, or content is read-only).
		if (!resumeGuid && !editing && !readOnly) {
			const mine = (await listDrafts(getUserStorage()))
				.filter((d) => d.target.kind === 'add' && d.target.type === type)
				.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
			const top = mine[0];
			if (top && top.target.kind === 'add') {
				addGuid = top.target.addGuid;
				const restored = { ...blankDraft(type), ...(top.data as Record<string, string>) };
				draft = restored;
				baseline = JSON.stringify(restored);
			}
		}
		// editor mode: restore a cached edit of THIS row (deterministic key) over the row-seeded draft
		if (editing && !readOnly) {
			const env = await readDraft<Record<string, string>>(getUserStorage(), draftCacheTarget);
			if (env) {
				draft = { ...initialDraft, ...env.data };
				baseline = JSON.stringify(draft);
			}
		}
	});

	// Localized prose columns (name_uk / text_uk / material_de / …) are NOT edited here — translating is
	// the Translate view's job — so the authoring form only shows the base (English) prose + structure.
	const isLocaleVariant = (name: string) =>
		/^(name|text)_(?!en$)[a-z][a-z-]*$/.test(name) ||
		/^(material|higher_level)_[a-z][a-z-]*$/.test(name);
	// material + higher_level render at the BOTTOM (below the body), mirroring the compendium article.
	const BOTTOM_FIELDS = ['higher_level', 'material', 'upcast'];
	const CLASSES_FIELD = 'classes';

	const fields = $derived(fieldsFor(type).filter((f) => !isLocaleVariant(f.name)));
	const bodyFields = $derived(
		fields.filter((f) => f.kind === 'textarea' && !BOTTOM_FIELDS.includes(f.name)),
	);
	// the spell "at higher levels" (textarea) + material (short text), pulled under the body IN
	// BOTTOM_FIELDS order (higher_level then material) to mirror the compendium article
	const bottomFields = $derived(
		fields
			.filter((f) => BOTTOM_FIELDS.includes(f.name))
			.sort((a, b) => BOTTOM_FIELDS.indexOf(a.name) - BOTTOM_FIELDS.indexOf(b.name)),
	);
	// everything the meta grid renders: not the title, body, systems, id, classes or the bottom fields
	const metaFields = $derived(
		fields.filter(
			(f) =>
				!['name_en', 'systems', 'id', CLASSES_FIELD].includes(f.name) &&
				f.kind !== 'textarea' &&
				!BOTTOM_FIELDS.includes(f.name),
		),
	);
	const hasClasses = $derived(fields.some((f) => f.name === CLASSES_FIELD));

	// Which columns get an (i) badge (hover) — formats + examples for the non-obvious ones (the
	// parser-driven `damage`/`effects`, spell fields, …). The SENTENCE lives in the catalogs under
	// `homebrewForm.info.*`; a column missing there simply gets no badge.
	const INFO_FIELDS = [
		'text_en',
		'level',
		'school',
		'casting_time',
		'range',
		'components',
		'duration',
		'concentration',
		'ritual',
		'resolution',
		'save',
		'damage',
		'tags',
		'base_item_id',
		'material',
		'higher_level',
		'effects',
		'classes',
	];
	const fieldInfo = (name: string): string =>
		INFO_FIELDS.includes(name) ? $_(`homebrewForm.info.${name}`) : '';
	// live warning for the level cell: a value above 9 has no slot in the classic rules
	const levelWarning = $derived(
		Number(draft.level) > 9
			? $_('homebrewForm.levelWarning', { values: { level: String(draft.level) } })
			: '',
	);
	// existing SPELLCASTER classes to tick in the ClassPicker — only classes with a caster type have
	// spell slots (excludes Barbarian/Fighter/Monk/Rogue); deduped by id (a class exists once per
	// edition, same id) and sorted by name. Data-driven off the class row's `caster` column.
	const classList = $derived.by(() => {
		const byId = new Map<string, { id: string; name: string }>();
		for (const c of content.graph?.list('class') ?? [])
			if (classCasts(c) && !byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.data.name_en });
		return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
	});

	function toggleSystem(sys: string) {
		const set = new Set(splitList(draft.systems));
		if (set.has(sys)) set.delete(sys);
		else set.add(sys);
		draft.systems = [...set].join(',');
	}
	const hasSystem = (sys: string) => splitList(draft.systems).includes(sys);

	async function save() {
		if (!editing && targetShipped) return; // add mode never writes a shipped file (UI blocks it too)
		issues = [];
		saving = true;
		try {
			// editor mode UPSERTs into the row's homebrew file (fork if shipped); add mode appends a new row
			const res =
				editing && editTarget
					? await upsertHomebrewRow(getUserStorage(), type, draft, editTarget)
					: await saveHomebrewRow(getUserStorage(), type, draft, target);
			if (!res.ok) {
				issues = res.issues ?? [$_('homebrewForm.saveFailed')];
				return;
			}
			await deleteDraft(getUserStorage(), draftCacheTarget); // saved → drop the cached draft
			baseline = JSON.stringify(draft); // stop the auto-save effect from re-spawning it
			resetContentGraph();
			if (res.id) onsave(res.id, type);
		} finally {
			saving = false;
		}
	}
</script>

{#snippet infoBadge(name: string)}
	{#if fieldInfo(name)}
		<span class="info-badge" title={fieldInfo(name)} aria-label={fieldInfo(name)}>i</span>
	{/if}
{/snippet}

<article class="detail-body edit">
	<div class="deyebrow">
		{$_(
			editShipped
				? 'homebrewForm.eyebrowFork'
				: editing
					? 'homebrewForm.eyebrowEdit'
					: 'homebrewForm.eyebrowNew',
			{ values: { type: $_(`contentType.${type}`) } },
		)}
	</div>
	<input class="titlein" placeholder={$_('contentField.name')} bind:value={draft.name_en} />
	<div class="id-row">
		<span class="id-label">id</span>
		{#if editing}
			<!-- id is locked in editor mode: a fork keeps the SRD id so it sorts above the original -->
			<input class="id-input" value={draft.id} readonly aria-readonly="true" />
		{:else}
			<input
				class="id-input"
				placeholder={slugify(draft.name_en ?? '') || 'auto'}
				bind:value={draft.id}
			/>
		{/if}
	</div>
	<p class="id-hint">{editing ? $_('homebrewForm.editIdHint') : $_('homebrewForm.idHint')}</p>

	<div class="systems-row">
		<span class="systems-label eyebrow">{$_('contentField.systems')}</span>
		{#each SYSTEMS as sys (sys)}
			<button
				type="button"
				class="chip syschip"
				class:on={hasSystem(sys)}
				onclick={() => toggleSystem(sys)}>{systemShortLabel(sys)}</button
			>
		{/each}
	</div>

	{#if metaFields.length}
		<div class="detail-meta">
			{#each metaFields as f (f.name)}
				<label class="meta-cell">
					<span class="meta-key eyebrow">
						{fieldLabel(f.name, f.label)}{#if f.required}<span class="required-mark">*</span>{/if}
						{@render infoBadge(f.name)}
					</span>
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
					{#if f.name === 'level' && levelWarning}
						<span class="cell-warn"><Icon name="triangle-alert" size={12} /> {levelWarning}</span>
					{/if}
				</label>
			{/each}
		</div>
	{/if}

	{#if hasClasses}
		<div class="classes-block">
			<span class="block-label eyebrow"
				>{fieldLabel('classes', $_('compendium.availableTo'))} {@render infoBadge('classes')}</span
			>
			<ClassPicker
				value={draft.classes ?? ''}
				options={classList}
				onChange={(v) => (draft.classes = v)}
			/>
		</div>
	{/if}

	<!-- one full-width labelled textarea; the same block renders for every body field and for the
	     textarea-kind bottom fields (higher_level), so it lives in one snippet -->
	{#snippet textareaBlock(f: (typeof bodyFields)[number])}
		<label class="body-block">
			<span class="block-label eyebrow"
				>{fieldLabel(f.name, f.label)} {@render infoBadge(f.name)}</span
			>
			<textarea
				class="body-input"
				placeholder={fieldLabel(f.name, f.label)}
				bind:value={draft[f.name]}></textarea>
		</label>
	{/snippet}

	{#each bodyFields as f (f.name)}
		{@render textareaBlock(f)}
	{/each}

	{#each bottomFields as f (f.name)}
		{#if f.kind === 'textarea'}
			{@render textareaBlock(f)}
		{:else}
			<label class="bottom-field">
				<span class="block-label eyebrow"
					>{fieldLabel(f.name, f.label)} {@render infoBadge(f.name)}</span
				>
				<input type="text" bind:value={draft[f.name]} />
			</label>
			<!-- the upcast cell is a GRAMMAR, so it gets a builder under its raw field rather than a
			     placeholder telling an author to learn one (UPCAST-AUTHORING) -->
			{#if f.name === 'upcast'}<UpcastBuilder bind:value={draft[f.name]} />{/if}
		{/if}
	{/each}

	{#if editing}
		<!-- editor mode has a forced target (the row's own homebrew file, or a fork) — no picker -->
		<p class="edit-target-note">
			{editShipped ? $_('homebrewForm.editForkNote') : $_('homebrewForm.editInPlaceNote')}
		</p>
	{:else}
		<div class="target-row">
			<span class="systems-label eyebrow">{$_('homebrewForm.targetLabel')}</span>
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
				<b><Icon name="triangle-alert" size={13} /> {$_('homebrewForm.srdWarnTitle')}</b>
				<p>{$_('homebrewForm.srdWarnBody')}</p>
				<button type="button" class="btn primary" onclick={() => (sel = homebrewFile(type))}
					>{$_('homebrewForm.srdWarnAction')}</button
				>
			</div>
		{/if}
	{/if}

	{#if issues.length}
		<div class="issues">
			<b>{$_('homebrewForm.fixFirst')}</b>
			<ul>
				<!-- keyed by POSITION: two empty required fields say the same sentence, and keying a
				     repeating list by its own text takes the page down instead of listing it -->
				{#each issues as msg, i (i)}<li>{msg}</li>{/each}
			</ul>
		</div>
	{/if}

	<div class="actions">
		<button
			type="button"
			class="save"
			onclick={save}
			disabled={saving || (!editing && targetShipped)}
		>
			{$_(
				saving ? 'homebrewForm.saving' : editing ? 'homebrewForm.saveEdit' : 'homebrewForm.saveNew',
			)}
		</button>
		<button type="button" class="cancel" onclick={oncancel}>{$_('homebrewForm.cancel')}</button>
		{#if editRow?.source === HOMEBREW_SOURCE && ondelete}
			<button type="button" class="delete-entry" onclick={ondelete}
				>{$_('compendium.deleteEntry')}</button
			>
		{/if}
	</div>
	<div class="source-line">{$_('homebrewForm.ownership')}</div>
</article>

<style>
	.titlein {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		margin: var(--space-1-5) 0 var(--space-2);
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
		gap: var(--space-2);
		margin-bottom: 14px;
	}
	.id-label,
	.systems-label {
		font-size: var(--font-size-micro);
	}
	.id-input {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		color: var(--color-text-muted);
	}
	.id-hint {
		margin: calc(-1 * var(--space-2)) 0 14px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.id-input[readonly] {
		opacity: 0.7;
		cursor: default;
	}
	.edit-target-note {
		margin: 18px 0 var(--space-2-5);
		font-size: var(--font-size-xs);
		line-height: 1.45;
		color: var(--color-text-muted);
		border-inline-start: 2px solid var(--color-border-strong);
		padding-inline-start: var(--space-2-5);
	}
	.target-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin: 18px 0 var(--space-2);
	}
	.target-select {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		color: var(--color-text);
	}
	.shipped-warn {
		border: 1px solid var(--color-danger);
		background: var(--color-danger-soft);
		border-radius: var(--radius-md);
		padding: var(--space-3) 14px;
		margin-bottom: var(--space-3);
	}
	.shipped-warn b {
		color: var(--color-danger);
		font-size: var(--font-size-body);
	}
	.shipped-warn p {
		margin: var(--space-1-5) 0 var(--space-2-5);
		font-size: var(--font-size-sm);
		line-height: 1.4;
		color: var(--color-text-muted);
	}
	.systems-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	/* the global `.chip`, wider — the base, its hover and its selected state all come from there
	   rather than being re-typed here (AGENTS.md ▸ a shared class lives in exactly one place) */
	.syschip {
		padding: var(--space-1) var(--space-3);
	}
	.meta-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-1-5) var(--space-2-5);
	}
	.meta-cell .meta-key {
		font-size: var(--font-size-micro);
	}
	.required-mark {
		color: var(--color-accent-bright);
	}
	.meta-cell input,
	.meta-cell select {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
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
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface-2);
		position: relative;
		cursor: pointer;
		padding: 0;
	}
	.bool .knob {
		position: absolute;
		top: 1px;
		inset-inline-start: 1px;
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
		inset-inline-start: 19px;
		background: var(--color-accent-text);
	}
	.classes-block,
	.bottom-field,
	.body-block {
		display: block;
		margin-bottom: 14px;
	}
	.info-badge {
		display: inline-grid;
		place-items: center;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid var(--color-border-strong);
		color: var(--color-text-muted);
		font-size: var(--font-size-micro);
		font-style: italic;
		font-weight: 700;
		cursor: help;
		vertical-align: middle;
		user-select: none;
	}
	.info-badge:hover {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.cell-warn {
		display: block;
		margin-top: var(--space-1);
		font-size: var(--font-size-xs);
		line-height: 1.3;
		color: var(--color-warning);
	}
	.block-label {
		display: block;
		font-size: var(--font-size-micro);
		margin-bottom: var(--space-2);
	}
	.bottom-field input {
		width: 100%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
		padding: var(--space-2) var(--space-2-5);
		font-size: var(--font-size-body);
	}
	.bottom-field input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.body-input {
		width: 100%;
		min-height: 120px;
		font-family: inherit;
		font-size: var(--font-size-body);
		line-height: 1.5;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text);
		padding: var(--space-2-5) var(--space-3);
		margin-bottom: var(--space-3);
		resize: vertical;
	}
	.body-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.issues {
		border: 1px solid var(--color-danger);
		background: var(--color-danger-soft);
		border-radius: var(--radius-md);
		padding: var(--space-2-5) 14px;
		margin-bottom: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	.issues ul {
		margin: var(--space-1-5) 0 0;
		padding-inline-start: 18px;
	}
	.actions {
		display: flex;
		gap: var(--space-2-5);
		margin-bottom: 14px;
	}
	.save {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-body);
		background: var(--color-accent);
		color: var(--color-accent-text);
		border: 0;
		border-radius: var(--radius);
		padding: var(--space-2) 18px;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.cancel {
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		background: transparent;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-4);
		cursor: pointer;
	}
	.cancel:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
	.delete-entry {
		margin-inline-start: auto;
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		background: transparent;
		color: var(--color-accent-bright);
		border: 1px solid transparent;
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-4);
		cursor: pointer;
	}
	.delete-entry:hover {
		border-color: var(--color-accent);
	}
</style>
