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
		upsertHomebrewRow,
		rowToDraft,
		homebrewFile,
		newHomebrewFile,
		isShippedFile,
		listTypeTargets,
		HOMEBREW_SOURCE,
		type TargetFile
	} from '$lib/content/homebrew';
	import type { LoadedRow } from '$lib/content/loader';
	import { content } from '$lib/content/store.svelte';
	import ClassPicker from './ClassPicker.svelte';
	import { SYSTEMS, splitList, type ContentType } from '$lib/content/schemas';
	import {
		writeDraft,
		readDraft,
		deleteDraft,
		listDrafts,
		type DraftTarget
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
		ondelete
	}: {
		type: ContentType;
		onsave: (id: string) => void;
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

	// Editor mode is captured once (the parent remounts via {#key editRow.effectiveId}). Its save
	// target = the row's own homebrew file, or a fork into the homebrew file when the row ships.
	// svelte-ignore state_referenced_locally
	const editing = !!editRow;
	// svelte-ignore state_referenced_locally
	const editShipped = editRow
		? isShippedFile(`${editRow.root}/${editRow.file}`, CONTENT_ROOTS)
		: false;
	// svelte-ignore state_referenced_locally
	const editTarget = editRow
		? editShipped
			? homebrewFile(type)
			: `${editRow.root}/${editRow.file}`
		: undefined;

	// A new entry has no id yet, so its draft is keyed by a stable per-session GUID (per
	// charnik-guid-not-counter): resumed from the pending list / an existing add-draft, else fresh.
	// An editor draft is keyed by the row it edits (kind:'editor').
	// svelte-ignore state_referenced_locally
	let addGuid = $state(resumeGuid ?? crypto.randomUUID());
	const draftCacheTarget = $derived<DraftTarget>(
		editRow
			? { kind: 'editor', type, source: editRow.source, id: editRow.id }
			: { kind: 'add', type, addGuid }
	);
	const readOnly = isReadOnlyContent();

	// initial-only capture is intended: the parent remounts this form with {#key type}, so the
	// draft resets cleanly whenever the type changes. Editor mode seeds from the row; a resumed
	// add-draft overlays the blank shape; else blank.
	// svelte-ignore state_referenced_locally
	const initialDraft = editRow
		? rowToDraft(editRow)
		: resumeDraft
			? { ...blankDraft(type), ...resumeDraft }
			: blankDraft(type);
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
			600
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
	const targetShipped = $derived(isShippedFile(target, CONTENT_ROOTS));
	onMount(async () => {
		targets = await listTypeTargets(getUserStorage(), type, CONTENT_ROOTS);
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
	const BOTTOM_FIELDS = ['higher_level', 'material'];
	const CLASSES_FIELD = 'classes';

	const fields = $derived(fieldsFor(type).filter((f) => !isLocaleVariant(f.name)));
	const bodyFields = $derived(
		fields.filter((f) => f.kind === 'textarea' && !BOTTOM_FIELDS.includes(f.name))
	);
	// the spell "at higher levels" (textarea) + material (short text), pulled under the body IN
	// BOTTOM_FIELDS order (higher_level then material) to mirror the compendium article
	const bottomFields = $derived(
		fields
			.filter((f) => BOTTOM_FIELDS.includes(f.name))
			.sort((a, b) => BOTTOM_FIELDS.indexOf(a.name) - BOTTOM_FIELDS.indexOf(b.name))
	);
	// everything the meta grid renders: not the title, body, systems, id, classes or the bottom fields
	const metaFields = $derived(
		fields.filter(
			(f) =>
				!['name_en', 'systems', 'id', CLASSES_FIELD].includes(f.name) &&
				f.kind !== 'textarea' &&
				!BOTTOM_FIELDS.includes(f.name)
		)
	);
	const hasClasses = $derived(fields.some((f) => f.name === CLASSES_FIELD));

	// Per-field help shown on an (i) badge (hover) — formats + examples for the non-obvious columns
	// (the parser-driven `damage`/`effects`, spell fields, …). Missing → no badge.
	const FIELD_INFO: Record<string, string> = {
		text_en: 'The main description. Markdown is supported.',
		level: 'Spell level 0–9 (0 = cantrip). Levels above 9 have no spell slot in the classic rules.',
		school: 'e.g. Evocation, Abjuration, Necromancy.',
		casting_time: 'e.g. 1 action, 1 bonus action, 1 reaction, 1 minute.',
		range: 'e.g. 60 feet, Self, Touch, Sight.',
		components: 'Verbal / Somatic / Material, e.g. V S M.',
		duration: 'e.g. Instantaneous, 1 minute, Concentration up to 1 hour.',
		concentration: 'On = the spell needs concentration to keep going.',
		ritual: 'On = can also be cast as a ritual (no slot, +10 min).',
		resolution: 'How it resolves: save / attack / auto / util — drives the roll widget.',
		save: 'Ability for the saving throw, e.g. dex, wis, con.',
		damage: 'Dice + type for the parser, e.g. “8d6 fire” or “2d4 necrotic”. Leave blank if none.',
		material: 'Material component text, e.g. “a pinch of sulfur and bat guano”.',
		higher_level: 'What changes when cast with a higher-level slot.',
		effects:
			'Auto-calc effects, “;”-separated. Format kind:target±amount. ' +
			'e.g. flat-bonus:ac+1; resist-immune:fire; grant-proficiency:skill.stealth. Leave blank if none.',
		classes: 'Tick the spellcaster classes this spell is available to (below).'
	};
	// live warning for the level cell: a value above 9 has no slot in the classic rules
	const levelWarning = $derived(
		Number(draft.level) > 9 ? `No level ${draft.level} spell slot in the classic rules (0–9).` : ''
	);
	// existing SPELLCASTER classes to tick in the ClassPicker — only classes with a caster type have
	// spell slots (excludes Barbarian/Fighter/Monk/Rogue); deduped by id (a class exists once per
	// edition, same id) and sorted by name. Data-driven off the class row's `caster` column.
	const classList = $derived.by(() => {
		const byId = new Map<string, { id: string; name: string }>();
		for (const c of content.graph?.list('class') ?? [])
			if (c.data.caster !== 'none' && !byId.has(c.id))
				byId.set(c.id, { id: c.id, name: String(c.data.name_en) });
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
				issues = res.issues ?? ['Could not save'];
				return;
			}
			await deleteDraft(getUserStorage(), draftCacheTarget); // saved → drop the cached draft
			baseline = JSON.stringify(draft); // stop the auto-save effect from re-spawning it
			resetContentGraph();
			if (res.id) onsave(res.id);
		} finally {
			saving = false;
		}
	}
</script>

{#snippet infoBadge(name: string)}
	{#if FIELD_INFO[name]}
		<span class="info-badge" title={FIELD_INFO[name]} aria-label={FIELD_INFO[name]}>i</span>
	{/if}
{/snippet}

<article class="detail-body edit">
	<div class="deyebrow">
		{type.replace(/_/g, ' ')} · {editing ? 'edit' : 'new homebrew'}{#if editShipped}
			· fork to homebrew{/if}
	</div>
	<input class="titlein" placeholder="Name" bind:value={draft.name_en} />
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
					<span class="meta-key">
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
						<span class="cell-warn">⚠ {levelWarning}</span>
					{/if}
				</label>
			{/each}
		</div>
	{/if}

	{#if hasClasses}
		<div class="classes-block">
			<span class="block-label"
				>{fieldLabel('classes', 'Available to')} {@render infoBadge('classes')}</span
			>
			<ClassPicker
				value={draft.classes ?? ''}
				options={classList}
				onChange={(v) => (draft.classes = v)}
			/>
		</div>
	{/if}

	{#each bodyFields as f (f.name)}
		<label class="body-block">
			<span class="block-label">{fieldLabel(f.name, f.label)} {@render infoBadge(f.name)}</span>
			<textarea
				class="body-input"
				placeholder={fieldLabel(f.name, f.label)}
				bind:value={draft[f.name]}></textarea>
		</label>
	{/each}

	{#each bottomFields as f (f.name)}
		{#if f.kind === 'textarea'}
			<label class="body-block">
				<span class="block-label">{fieldLabel(f.name, f.label)} {@render infoBadge(f.name)}</span>
				<textarea
					class="body-input"
					placeholder={fieldLabel(f.name, f.label)}
					bind:value={draft[f.name]}></textarea>
			</label>
		{:else}
			<label class="bottom-field">
				<span class="block-label">{fieldLabel(f.name, f.label)} {@render infoBadge(f.name)}</span>
				<input type="text" bind:value={draft[f.name]} />
			</label>
		{/if}
	{/each}

	{#if editing}
		<!-- editor mode has a forced target (the row's own homebrew file, or a fork) — no picker -->
		<p class="edit-target-note">
			{editShipped ? $_('homebrewForm.editForkNote') : $_('homebrewForm.editInPlaceNote')}
		</p>
	{:else}
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
		<button
			type="button"
			class="save"
			onclick={save}
			disabled={saving || (!editing && targetShipped)}
		>
			{saving ? 'Saving…' : editing ? 'Save changes' : 'Save homebrew'}
		</button>
		<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
		{#if editRow?.source === HOMEBREW_SOURCE && ondelete}
			<button type="button" class="delete-entry" onclick={ondelete}>Delete entry</button>
		{/if}
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
	.id-input[readonly] {
		opacity: 0.7;
		cursor: default;
	}
	.edit-target-note {
		margin: 18px 0 10px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-text-muted);
		border-left: 2px solid var(--color-border-strong);
		padding-left: 10px;
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
		font-size: 9px;
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
		margin-top: 4px;
		font-size: 11px;
		line-height: 1.3;
		color: var(--color-warning);
	}
	.block-label {
		display: block;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 8px;
	}
	.bottom-field input {
		width: 100%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text);
		padding: 8px 10px;
		font-size: 14px;
	}
	.bottom-field input:focus {
		outline: none;
		border-color: var(--color-accent);
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
	.delete-entry {
		margin-left: auto;
		font-family: var(--font-display);
		font-size: 14px;
		background: transparent;
		color: var(--color-accent-bright);
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 9px 16px;
		cursor: pointer;
	}
	.delete-entry:hover {
		border-color: var(--color-accent);
	}
</style>
