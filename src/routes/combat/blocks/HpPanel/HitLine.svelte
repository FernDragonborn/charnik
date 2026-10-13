<script lang="ts">
	// The hit, said as the dice tray says a damage line: one field holding the amount and then the
	// type that owns it, and the one red press. The type is the tray's own pill and opens the tray's
	// two-column menu — or is typed without leaving the field (`12 f ↵`), found by the tray's own
	// matcher (`hit-line.ts`). Amount, type, press: one pass, the order the table says "12 fire" in.
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import DamageIcon from '$lib/components/DamageIcon.svelte';
	import { damageGlyph } from '$lib/components/damage-glyphs';
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { provenance } from '$lib/actions/provenance';
	import { damageTypeLabel } from '$lib/combat/attacks';
	import { rollerCandidates } from '$lib/dice/roller-vocabulary';
	import { damageTypeSources } from '$lib/dice/roller-sources';
	import { optionDomId, walkOptions } from '$lib/util/option-walk';
	import { combat } from '../../combat-view-model.svelte';
	import { completionOf, DEFENCE_MARK, readTypedHit, typeRows, type TypeRow } from './hit-line';

	/** The menu's id for the row that takes the type back off — a row needs one and `null` is not it. */
	const UNTYPED = 'untyped';
	const MENU = 'hit-type';

	const hp = combat.hp;
	let field: HTMLInputElement | undefined = $state();
	let line: HTMLElement | undefined = $state();
	/** The start of a type's name, typed after the amount and not yet picked. */
	let word = $state('');
	let menuOpen = $state(false);
	let highlight = $state<string | null>(null);

	const candidates = $derived(rollerCandidates(damageTypeSources(), app.activeLocale));
	const rows = $derived(
		typeRows(word, {
			candidates,
			order: hp.damageTypeOptions,
			defended: new Set(hp.defendedTypes),
			untyped: $_('combat.hp.untyped'),
		}),
	);
	const idOf = (row: TypeRow) => row.key ?? UNTYPED;
	const completion = $derived(menuOpen ? completionOf(word, rows) : '');
	/** Column-first, like the tray's type picker: ↓ walks straight down a column. */
	const rowsPerColumn = $derived(Math.ceil(rows.length / 2));
	const preview = $derived(hp.damagePreview);
	const said = $derived(hp.damageType);
	const saidDefence = $derived(hp.defenceAgainst(said));
	const text = $derived(`${hp.hpAmount}${word ? ` ${word}` : ''}`);

	function typed(value: string) {
		const hit = readTypedHit(value);
		hp.hpAmount = hit.amount ?? 0;
		word = hit.word;
		menuOpen = word !== '';
		highlight = rows[0] ? idOf(rows[0]) : null;
	}

	async function openMenu() {
		menuOpen = true;
		highlight = said ?? (rows[0] ? idOf(rows[0]) : null);
		await tick();
		field?.focus();
	}
	function closeMenu() {
		menuOpen = false;
		word = '';
	}
	function pick(id: string) {
		hp.damageType = id === UNTYPED ? null : id;
		closeMenu();
		field?.focus();
	}

	function onKey(event: KeyboardEvent) {
		if (menuOpen) {
			if (event.code === 'Escape') {
				// the menu's, not the page's: one Escape closes one thing
				event.preventDefault();
				event.stopPropagation();
				closeMenu();
				return;
			}
			const walked = walkOptions(event, {
				ids: rows.map(idOf),
				previewId: highlight,
				onpreview: (id) => (highlight = id),
				onenter: pick,
				// Home and End are the caret's while a word is being typed
				jumpKeys: false,
			});
			if (walked) return;
		}
		if (event.code === 'ArrowDown') {
			event.preventDefault();
			void openMenu();
		} else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
			event.preventDefault();
			combat.damage();
		} else if (event.code === 'Backspace' && said && !word && field?.selectionEnd === 0) {
			// the caret at the start has nothing left to delete but the type, as on a tray line
			event.preventDefault();
			hp.damageType = null;
		}
	}

	/** A press or a focus that lands outside the line closes its menu. */
	function leftLine(event: FocusEvent) {
		if (menuOpen && !line?.contains(event.relatedTarget as Node | null)) closeMenu();
	}
</script>

<span class="hit-line" bind:this={line} onfocusout={leftLine}>
	<span class="hit-field" class:open={menuOpen}>
		<input
			bind:this={field}
			class="hit-amount"
			type="text"
			inputmode="numeric"
			autocomplete="off"
			spellcheck="false"
			size={Math.max(1, text.length)}
			value={text}
			role="combobox"
			aria-label={$_('combat.hp.hitField')}
			aria-expanded={menuOpen}
			aria-controls={MENU}
			aria-autocomplete="list"
			aria-activedescendant={menuOpen && highlight ? optionDomId(MENU, highlight) : undefined}
			oninput={(event) => typed(event.currentTarget.value)}
			onkeydown={onKey}
		/>{#if completion}<span class="hit-completion" aria-hidden="true">{completion}</span>{/if}
		<button
			type="button"
			class="roller-pill type-pill hit-type"
			class:said
			aria-label={said ? damageTypeLabel(said, $_) : $_('combat.hp.damageTypeLabel')}
			aria-haspopup="listbox"
			aria-expanded={menuOpen}
			use:provenance={said
				? [
						damageTypeLabel(said, $_),
						preview
							? $_(`combat.hp.damagePreview.${preview.bucket}`, {
									values: { raw: preview.raw, final: preview.final },
								})
							: '',
					]
						.filter(Boolean)
						.join('\n')
				: $_('combat.hp.damageTypeLabel')}
			onclick={() => (menuOpen ? closeMenu() : void openMenu())}
		>
			{#if said}
				{#if damageGlyph(said).length}
					<DamageIcon type={said} size={14} />
				{:else}
					<span class="hit-type-word">{damageTypeLabel(said, $_)}</span>
				{/if}
				{#if saidDefence}
					<b class="defence-mark {saidDefence}">{DEFENCE_MARK[saidDefence]}</b>
				{/if}
			{/if}
			<Icon name="chevron-down" size={10} />
		</button>
	</span>
	<!-- red is this press and nothing else; it says a number only when a defense changed it -->
	<button
		type="button"
		class="hit-take"
		onclick={combat.damage}
		aria-label={$_('combat.hp.damageTitle')}
		use:provenance={$_('combat.hp.damageTitle')}
	>
		<Icon name="minus" size={16} />{#if preview}<b>{preview.final}</b>{/if}
	</button>
	{#if menuOpen}
		<div
			class="roller-menu types hit-menu"
			id={MENU}
			role="listbox"
			style:--type-rows={rowsPerColumn}
		>
			<div class="roller-menu-rows">
				{#each rows as row (idOf(row))}
					{@const defence = row.key ? hp.defenceAgainst(row.key) : null}
					<button
						type="button"
						tabindex="-1"
						id={optionDomId(MENU, idOf(row))}
						role="option"
						aria-selected={row.key === said}
						class="roller-menu-row"
						class:on={idOf(row) === highlight}
						onmousedown={(event) => {
							// the press must not take the caret out of the field
							event.preventDefault();
							pick(idOf(row));
						}}
					>
						<span class="roller-menu-glyph"
							>{#if row.key && damageGlyph(row.key).length}<DamageIcon type={row.key} />{/if}</span
						>
						<span class="roller-menu-name">
							{#if row.at >= 0}{row.label.slice(0, row.at)}<b
									>{row.label.slice(row.at, row.at + row.length)}</b
								>{row.label.slice(row.at + row.length)}{:else}{row.label}{/if}
						</span>
						{#if defence}<b class="defence-mark {defence}">{DEFENCE_MARK[defence]}</b>{/if}
						{#if idOf(row) === highlight}<span class="roller-menu-key">↵</span>{/if}
					</button>
				{:else}
					<span class="hit-menu-empty">{$_('combat.hp.noSuchType')}</span>
				{/each}
			</div>
		</div>
	{/if}
</span>

<style>
	.hit-line {
		position: relative;
		display: inline-flex;
		align-items: stretch;
		gap: var(--space-1);
	}
	/* one field: the amount, then the type that owns it */
	.hit-field {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		padding: 2px;
		padding-inline-start: var(--space-2);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		cursor: text;
	}
	.hit-field:focus-within {
		border-color: var(--color-border-strong);
	}
	.hit-field.open {
		border-color: var(--color-text-muted);
	}
	.hit-amount {
		field-sizing: content;
		min-width: 2ch;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--font-size-body);
	}
	/* the grey completion, as in the tray: what the word will become, before it becomes it */
	.hit-completion {
		margin-inline-start: calc(-1 * var(--space-1-5));
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-body);
		opacity: 0.55;
	}
	.hit-type {
		background: var(--color-surface);
		font-weight: 600;
		/* the tray's pill is dragged along its line; this one is only pressed */
		cursor: pointer;
	}
	.hit-type.said {
		color: var(--color-text);
	}
	.hit-type-word {
		font-weight: 500;
	}
	.defence-mark {
		flex: none;
		font-weight: 600;
		color: var(--color-good);
	}
	.defence-mark.vulnerable {
		color: var(--color-danger);
	}
	.hit-take {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		/* room for the number a defense puts here, so saying it does not move the line */
		min-width: 3rem;
		padding: var(--space-1) var(--space-1-5);
		border-radius: var(--radius);
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger);
		color: var(--color-danger);
		font-family: var(--font-display);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	.hit-take:hover {
		filter: brightness(1.12);
	}
	/* the menu hangs off the line and is wider than it: a type's name needs more room than its pill */
	.hit-menu {
		position: absolute;
		z-index: 3;
		top: calc(100% + var(--space-1));
		inset-inline-end: 0;
		width: 17rem;
		padding: var(--space-1-5) var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius);
		box-shadow: var(--shadow-2);
	}
	.hit-menu-empty {
		padding: var(--space-1-5) var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	/* ---- a narrow block: the line is a row of its own, and everything pressed is 44px ---- */
	@container hp-block (max-width: 26rem) {
		.hit-line {
			display: flex;
			gap: var(--space-2);
		}
		.hit-field {
			flex: 1;
			min-width: 0;
			min-height: 2.75rem;
			box-sizing: border-box;
			padding-inline-start: var(--space-3);
		}
		.hit-amount {
			flex: 1;
			min-width: 0;
			font-size: var(--font-size-md);
		}
		.hit-type {
			align-self: stretch;
			justify-content: center;
			min-width: 2.75rem;
		}
		.hit-take {
			min-width: 2.75rem;
		}
		.hit-menu {
			inset-inline: 0;
			width: auto;
		}
	}
</style>
