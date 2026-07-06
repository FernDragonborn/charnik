<script lang="ts">
	// Full-screen, dark-backdrop modal that reviews content files with missing metadata (DATA-VER-1).
	// Required human fields (source / license) + offered optional fields (systems / url / author…) get
	// inline widgets; machine-fillable keys (id / hash / updated-at / schema) are a reassuring "we'll
	// add these" FYI. Presentation only — detection + write-back live in the loader (thin-component).
	import { untrack } from 'svelte';
	import { _ } from '$lib/i18n';
	import LangSwitcher from './LangSwitcher.svelte';
	import { EDITABLE_KEYS, OPTIONAL_KEYS } from '$lib/content/meta';
	import type { MetaIssue, MetaKey } from '$lib/content/meta';

	/** file → (directive key → value the user typed/picked). systems is stored comma-joined. */
	type FilledMeta = Record<string, Record<string, string>>;
	let {
		issues,
		onFillAndSave,
		onSkip,
		onNeverAsk
	}: {
		issues: MetaIssue[];
		onFillAndSave: (fills: FilledMeta) => void;
		onSkip: () => void;
		onNeverAsk: () => void;
	} = $props();

	const LICENSES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'MIT'];
	const EDITIONS = ['5e', '5.5e'];

	const isCustomLicense = (v: string | undefined) => !!v && !LICENSES.includes(v);
	// text/select field values already declared by the file (everything editable except systems)
	const initText = (i: MetaIssue): Record<string, string> =>
		Object.fromEntries(Object.entries(i.values).filter(([k]) => k !== 'systems'));
	const initSystems = (i: MetaIssue): string[] =>
		(i.values.systems ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

	// per-file draft state — snapshotted at open and PRE-FILLED from whatever the file already declares
	// (the issue set is fixed then; untrack silences the "captures initial value" reactivity warning).
	const fills = $state<FilledMeta>(
		untrack(() => Object.fromEntries(issues.map((i) => [i.file, initText(i)])))
	);
	const sysSel = $state<Record<string, string[]>>(
		untrack(() => Object.fromEntries(issues.map((i) => [i.file, initSystems(i)])))
	);
	// which files have the license set to a free-typed custom value (vs one of the preset cards)
	const licCustom = $state<Record<string, boolean>>(
		untrack(() =>
			Object.fromEntries(issues.map((i) => [i.file, isCustomLicense(i.values.license)]))
		)
	);

	const keyLabel = (k: MetaKey) => $_(`contentMeta.keys.${k}`);
	const isUrl = (k: MetaKey) => k === 'url' || k === 'author-url';

	function setLicense(file: string, value: string) {
		fills[file]!.license = value;
		licCustom[file] = false;
	}
	function pickCustomLicense(file: string) {
		licCustom[file] = true;
		fills[file]!.license = '';
	}

	function save() {
		// fold the systems checkbox selection into the payload before handing it up
		const payload: FilledMeta = {};
		for (const issue of issues) {
			const f = issue.file;
			payload[f] = { ...fills[f] };
			if (sysSel[f]!.length) payload[f]!.systems = sysSel[f]!.join(',');
		}
		onFillAndSave(payload);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onSkip();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onSkip}></div>
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="cm-title" tabindex="-1">
	<header class="head">
		<div class="lang-corner"><LangSwitcher /></div>
		<span class="badge">⚑</span>
		<h2 id="cm-title" class="title">{$_('contentMeta.title')}</h2>
		<p class="subtitle">{$_('contentMeta.subtitle')}</p>
	</header>

	<div class="files">
		{#each issues as issue (issue.file)}
			<section class="file">
				<h3 class="fname">{issue.file}</h3>

				<span class="section-label">{$_('contentMeta.needFromYou')}</span>
				<div class="fields">
					{#each EDITABLE_KEYS as key (key)}
						{@const optional = OPTIONAL_KEYS.includes(key)}
						<div class="field" class:wide={key === 'license'}>
							<span class="flabel" class:opt={optional}>
								{keyLabel(key)}{#if optional}<span class="opttag">
										{$_('contentMeta.optional')}</span
									>{/if}
							</span>

							{#if key === 'license'}
								<div class="lic-list" role="radiogroup" aria-label={keyLabel(key)}>
									{#each LICENSES as lic (lic)}
										<button
											type="button"
											class="lic"
											role="radio"
											aria-checked={!licCustom[issue.file] && fills[issue.file]!.license === lic}
											class:sel={!licCustom[issue.file] && fills[issue.file]!.license === lic}
											onclick={() => setLicense(issue.file, lic)}
										>
											<span class="lic-id">{lic}</span>
											<span class="lic-desc">{$_(`contentMeta.licenses.${lic}`)}</span>
										</button>
									{/each}
									<button
										type="button"
										class="lic"
										role="radio"
										aria-checked={licCustom[issue.file]}
										class:sel={licCustom[issue.file]}
										onclick={() => pickCustomLicense(issue.file)}
									>
										<span class="lic-id">{$_('contentMeta.customLicense')}</span>
									</button>
									{#if licCustom[issue.file]}
										<input
											class="finput"
											type="text"
											bind:value={fills[issue.file]!.license}
											placeholder={$_('contentMeta.customLicensePlaceholder')}
										/>
									{/if}
								</div>
							{:else if key === 'systems'}
								<div class="checks">
									{#each EDITIONS as ed (ed)}
										<label class="check">
											<input type="checkbox" value={ed} bind:group={sysSel[issue.file]} />
											{ed}
										</label>
									{/each}
								</div>
							{:else}
								<input
									class="finput"
									type={isUrl(key) ? 'url' : 'text'}
									bind:value={fills[issue.file]![key]}
									placeholder={key === 'source'
										? $_('contentMeta.sourcePlaceholder')
										: isUrl(key)
											? $_('contentMeta.urlPlaceholder')
											: $_('contentMeta.authorPlaceholder')}
								/>
							{/if}
						</div>
					{/each}
				</div>

				{#if issue.missingAuto.length}
					<div class="auto">
						<span class="auto-label">{$_('contentMeta.willAutofill')}</span>
						<span class="chips">
							{#each issue.missingAuto as key (key)}
								<span class="chip">{keyLabel(key)}</span>
							{/each}
						</span>
					</div>
				{/if}
			</section>
		{/each}
	</div>

	<footer class="foot">
		<button class="btn ghost" onclick={onNeverAsk}>{$_('contentMeta.neverAsk')}</button>
		<span class="spacer"></span>
		<button class="btn ghost" onclick={onSkip}>{$_('contentMeta.skip')}</button>
		<button class="btn primary" onclick={save}>{$_('contentMeta.fillAndSave')}</button>
	</footer>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-overlay);
		z-index: 60;
	}
	.modal {
		position: fixed;
		inset: 0;
		z-index: 61;
		width: min(760px, calc(100vw - 2 * var(--space-4)));
		max-height: calc(100vh - 2 * var(--space-6));
		margin: auto;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
		overflow: hidden;
	}
	.head {
		position: relative;
		padding: var(--space-5) var(--space-6) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		border-left: 4px solid var(--color-accent);
	}
	.lang-corner {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
	}
	.badge {
		display: inline-block;
		color: var(--color-accent-bright);
		font-size: var(--font-size-lg);
	}
	.title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		color: var(--color-text);
		margin: var(--space-1) 0 var(--space-2);
	}
	.subtitle {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-height);
	}
	.files {
		overflow: auto;
		padding: var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.file {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
	}
	.fname {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		margin: 0 0 var(--space-3);
	}
	.section-label,
	.auto-label {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.section-label {
		display: block;
		margin-bottom: var(--space-2);
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex: 1 1 220px;
	}
	.field.wide {
		flex-basis: 100%;
	}
	.flabel {
		font-size: var(--font-size-sm);
		color: var(--color-accent-bright);
		font-weight: 600;
	}
	.flabel.opt {
		color: var(--color-text);
	}
	.opttag {
		color: var(--color-text-muted);
		font-weight: 400;
	}
	.finput {
		background: var(--color-bg);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		color: var(--color-text);
		font-size: var(--font-size-md);
		outline: none;
	}
	.finput:focus {
		border-color: var(--color-accent);
	}
	.lic-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.lic {
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
	}
	.lic:hover {
		border-color: var(--color-border-strong);
		background: var(--color-surface);
	}
	.lic.sel {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	.lic-id {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.lic.sel .lic-id {
		color: var(--color-accent-bright);
	}
	.lic-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.checks {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		padding: var(--space-1) 0;
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text);
		font-size: var(--font-size-md);
		cursor: pointer;
	}
	.auto {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) var(--space-3);
		margin-top: var(--space-4);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-good);
		background: var(--color-good-soft);
		border-radius: var(--radius-full);
		padding: 2px 10px;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-6);
		border-top: 1px solid var(--color-border);
	}
	.spacer {
		flex: 1;
	}
	/* .btn / .btn.ghost / .btn.primary are shared globals in styles/components.css */
</style>
