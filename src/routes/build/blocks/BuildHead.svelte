<script lang="ts">
	// The sheet's masthead: who this is, which ruleset they live under, and how hard the app should
	// hold them to it. Sticky, because the name field and the Strict/Free switch stay relevant while
	// the sheet below scrolls. The `.segment-group` toggles are styled by build.css (.build-page).
	//
	// There is deliberately no "guided vs full sheet" switch: only the full sheet exists (see
	// docs/work/ui.md ▸ N3). A guided flow becomes a second entry point onto this view-model.
	import Icon from '$lib/components/Icon.svelte';
	import Portrait from '$lib/components/Portrait.svelte';
	import { toast } from 'svelte-sonner';
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { SYSTEMS, SYSTEM_SHORT_LABELS } from '$lib/rules/pipeline';
	import { signed } from '$lib/util/format';
	import EditionSwitchDialog from './EditionSwitchDialog.svelte';
	import { provenance } from '$lib/actions/provenance';
	import type { SystemId } from '$lib/stores/app.svelte';
	const b = build;

	let photoInput = $state<HTMLInputElement | null>(null);

	/** Take the picked file, or say why nothing happened. The input is cleared either way so picking
	 *  the SAME file again still fires a change event. */
	async function onPhotoPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!(await b.setPhoto(file)))
			toast($_('build.portrait.notReadable'), {
				description: $_('build.portrait.notReadableBody'),
			});
	}

	/** The edition the user asked for, while they confirm what it costs. */
	let pendingSystem = $state<SystemId | null>(null);
	const losing = $derived(pendingSystem ? b.picksLostBySwitching(pendingSystem) : []);

	/** Switching outright when nothing is lost: a confirmation with an empty list is a dialog that
	 *  only ever costs a click. */
	function askSwitch(sys: SystemId) {
		if (sys === b.draft.system) return;
		if (b.picksLostBySwitching(sys).length) pendingSystem = sys;
		else b.switchSystem(sys);
	}
</script>

<header class="head">
	<h1>{b.edit ? $_('build.titleLevelUp') : $_('build.titleNew')}</h1>
	<div class="portrait-slot">
		<button
			class="portrait-button"
			title={b.portraitSource ? $_('build.portrait.replace') : $_('build.portrait.add')}
			aria-label={b.portraitSource ? $_('build.portrait.replace') : $_('build.portrait.add')}
			onclick={() => photoInput?.click()}
		>
			<Portrait source={b.portraitSource} size={38} alt="" />
		</button>
		{#if b.portraitSource}
			<button
				class="portrait-clear"
				title={$_('build.portrait.remove')}
				aria-label={$_('build.portrait.remove')}
				onclick={b.clearPhoto}><Icon name="x" size={11} /></button
			>
		{/if}
		<input
			bind:this={photoInput}
			type="file"
			accept="image/*"
			class="hidden-file"
			onchange={onPhotoPicked}
		/>
	</div>

	<label class="namewrap">
		<span class="visually-hidden">{$_('build.nameLabel')}</span>
		<input class="nameinput" placeholder={$_('build.namePlaceholder')} bind:value={b.draft.name} />
	</label>

	<span class="level" title={$_('build.levelTotal')}>
		<b>{b.sheet?.level ?? b.classRows.totalLevel}</b>
		<small>{$_('build.levelMeta', { values: { bonus: signed(b.sheet?.proficiencyBonus ?? 2) } })}</small>
	</span>

	<!-- the keyboard's Ctrl+Z has to have a face: every way in is doable from the UI, and a shortcut
	     is not a way in for someone who never learns it -->
	<div class="undo">
		<button
			class="icon-button"
			disabled={!b.history.canUndo}
			title={$_('build.undo')}
			aria-label={$_('build.undo')}
			onclick={build.history.undo}><Icon name="rotate-ccw" size={14} /></button
		>
		<button
			class="icon-button"
			disabled={!b.history.canRedo}
			title={$_('build.redo')}
			aria-label={$_('build.redo')}
			onclick={build.history.redo}><Icon name="rotate-cw" size={14} /></button
		>
	</div>

	<span class="spacer"></span>

	<div class="segment-group" role="group" aria-label={$_('build.ruleset')}>
		<!-- iterates the ONE system list, so a third system is a row in SYSTEM_LABELS, not a button
		     somebody has to remember to add here (docs/internals/compatibility.md) -->
		{#each SYSTEMS as sys (sys)}
			<button
				class:on={b.draft.system === sys}
				aria-pressed={b.draft.system === sys}
				onclick={() => askSwitch(sys)}>{SYSTEM_SHORT_LABELS[sys]}</button
			>
		{/each}
	</div>
	<div class="segment-group" role="group" aria-label={$_('build.enforcement')}>
		<button
			class:on={b.draft.strict}
			aria-pressed={b.draft.strict}
			onclick={() => (b.draft.strict = true)}
			use:provenance={$_('build.strictHint')}>{$_('build.strict')}</button
		>
		<button
			class="free"
			class:on={!b.draft.strict}
			aria-pressed={!b.draft.strict}
			onclick={() => (b.draft.strict = false)}
			use:provenance={$_('build.freeHint')}>{$_('build.free')}</button
		>
	</div>
	<div class="segment-group" role="group" aria-label={$_('build.shortRest')}>
		<!-- per-character rules variant: Dice = RAW (spend Hit Dice), Half = ½ max HP (BG3/house style) -->
		<button
			class:on={b.draft.shortRestMode === 'dice'}
			aria-pressed={b.draft.shortRestMode === 'dice'}
			onclick={() => (b.draft.shortRestMode = 'dice')}
			title={$_('build.shortRestDiceHint')}><Icon name="flame-kindling" size={12} /> {$_('build.shortRestDice')}</button
		>
		<button
			class:on={b.draft.shortRestMode === 'half'}
			aria-pressed={b.draft.shortRestMode === 'half'}
			onclick={() => (b.draft.shortRestMode = 'half')}
			title={$_('build.shortRestHalfHint')}><Icon name="flame-kindling" size={12} /> {$_('build.shortRestHalf')}</button
		>
	</div>
</header>

{#if pendingSystem}
	<EditionSwitchDialog
		system={pendingSystem}
		{losing}
		onConfirm={() => {
			if (pendingSystem) b.switchSystem(pendingSystem);
			pendingSystem = null;
		}}
		onCancel={() => (pendingSystem = null)}
	/>
{/if}

<style>
	/* `.visually-hidden` is the global screen-reader util in app.css — no local copy (C2). */
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-bottom: var(--space-3);
		margin-bottom: 14px;
		border-bottom: 1px solid var(--color-border);
		flex-wrap: wrap;
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-lg);
		margin: 0;
		white-space: nowrap;
	}
	/* the button IS the portrait: no frame of its own, so the picture is not a picture inside a box */
	.portrait-slot {
		position: relative;
		display: flex;
		line-height: 0;
	}
	.portrait-button {
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		border-radius: var(--radius-md);
	}
	.portrait-clear {
		position: absolute;
		inset-block-start: -5px;
		inset-inline-end: -5px;
		display: grid;
		place-items: center;
		inline-size: 17px;
		block-size: 17px;
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.portrait-clear:hover {
		color: var(--color-danger);
	}
	.hidden-file {
		display: none;
	}
	.namewrap {
		flex: 1;
		min-width: 180px;
		max-width: 320px;
	}
	.nameinput {
		width: 100%;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-md);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-3);
	}
	.nameinput:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.level {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1-5);
	}
	.level b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-h5);
		color: var(--color-resource);
	}
	.level small {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.undo {
		display: flex;
		gap: 2px;
	}
	.undo button {
		padding: var(--space-1-5);
		border-radius: var(--radius-sm);
	}
	.undo button:hover:not(:disabled) {
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.undo button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.undo button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.spacer {
		flex: 1;
	}
</style>
