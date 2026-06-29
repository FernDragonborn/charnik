<script lang="ts">
	// Ctrl/Cmd+K command + search palette (a11y convention pinned at P1; full search P6).
	// Thin shell: the destination list is data; navigation goes through the router. Real
	// content search (spells/items/rules) plugs into the same filtered list later.
	import { goto } from '$app/navigation';
	import { _ } from '$lib/i18n';

	interface Command {
		id: string;
		labelKey: string;
		href: string;
	}

	const COMMANDS: Command[] = [
		{ id: 'roster', labelKey: 'nav.roster', href: '/' },
		{ id: 'compendium', labelKey: 'nav.compendium', href: '/compendium' },
		{ id: 'settings', labelKey: 'nav.settings', href: '/settings' }
	];

	let open = $state(false);
	let query = $state('');
	let active = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let restoreEl: HTMLElement | null = null;

	const results = $derived(
		COMMANDS.filter((c) => $_(c.labelKey).toLowerCase().includes(query.trim().toLowerCase()))
	);

	function openPalette() {
		restoreEl = document.activeElement as HTMLElement;
		query = '';
		active = 0;
		open = true;
	}

	function closePalette() {
		open = false;
		restoreEl?.focus();
	}

	function run(cmd: Command | undefined) {
		if (!cmd) return;
		closePalette();
		goto(cmd.href);
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			open ? closePalette() : openPalette();
		}
	}

	function onPaletteKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closePalette();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % Math.max(results.length, 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = (active - 1 + results.length) % Math.max(results.length, 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			run(results[active]);
		}
	}

	// Keep selection in range as the query narrows results; focus the input on open.
	$effect(() => {
		if (active >= results.length) active = 0;
	});
	$effect(() => {
		if (open) inputEl?.focus();
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={closePalette}></div>
	<div
		class="palette"
		role="dialog"
		aria-modal="true"
		aria-label={$_('nav.openCommandPalette')}
		onkeydown={onPaletteKeydown}
	>
		<input
			bind:this={inputEl}
			bind:value={query}
			class="input"
			type="text"
			role="combobox"
			aria-expanded="true"
			aria-controls="cmd-list"
			aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
			placeholder={$_('command.placeholder')}
			autocomplete="off"
		/>
		<ul id="cmd-list" class="list" role="listbox">
			{#each results as cmd, i (cmd.id)}
				<li
					id="cmd-{cmd.id}"
					role="option"
					aria-selected={i === active}
					class="item"
					class:active={i === active}
					onmousemove={() => (active = i)}
					onclick={() => run(cmd)}
				>
					{$_(cmd.labelKey)}
				</li>
			{:else}
				<li class="empty">{$_('command.empty')}</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-overlay);
		z-index: 50;
	}
	.palette {
		position: fixed;
		top: 14vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(560px, calc(100vw - 2 * var(--space-4)));
		z-index: 51;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
		overflow: hidden;
	}
	.input {
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--color-border);
		background: transparent;
		padding: var(--space-4);
		font-size: var(--font-size-lg);
		outline: none;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: var(--space-1);
		max-height: 50vh;
		overflow: auto;
	}
	.item {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-display);
	}
	.item.active {
		background: var(--color-surface-2);
		color: var(--color-accent);
	}
	.empty {
		padding: var(--space-3);
		color: var(--color-text-muted);
	}
</style>
