<script lang="ts">
	// ONE line of the roller organ: the role stripe, the pills, the caret, the suggestion menu that
	// grows out of the line, and the state toggle that belongs to this line's role (advantage for a
	// test, a crit for damage). All state lives on the organ — this component owns none.
	//
	// Two things here are load-bearing and easy to undo by accident:
	//  · colour lives in the TEXT, never in a pill's fill. Every pill is the same surface + border;
	//    the number's colour says what it is. Tinted fills are reserved for the state toggles, so
	//    "this is a test" and "this line is active" can't be read as the same signal.
	//  · the menu is a CONTINUATION of the line, not a dropdown over it: same width, joined borders,
	//    so the pills appear to grow downward.
	import DamageIcon from './DamageIcon.svelte';
	import Icon from './Icon.svelte';
	import { damageGlyph } from './damage-glyphs';
	import {
		PILL_KIND,
		ROLLER_ROLE,
		pillGroups,
		type DicePill,
		type RollerLine,
		type RollerPill,
	} from '$lib/dice/roller';
	import type { RollerOrgan } from '$lib/dice/roller.svelte';
	import { ADVANTAGE_MODE } from '$lib/rules/dice';
	import { signed } from '$lib/util/format';

	let {
		organ,
		index,
		line,
		roll,
	}: { organ: RollerOrgan; index: number; line: RollerLine; roll: () => void } = $props();

	const isTest = $derived(line.role === ROLLER_ROLE.test);
	const focused = $derived(organ.focus === index);
	const menuOpen = $derived(focused && organ.menu.length > 0);
	/** The line's state doubles this die — and WHICH dice differs by role: advantage draws a second
	 *  d20 and touches nothing else, while a crit doubles every damage die in the line. */
	const doubles = (p: DicePill): boolean =>
		isTest ? p.sides === 20 && line.advantage !== ADVANTAGE_MODE.neither : line.crit;
	/** Damage groups: everything left of a type pill is that type's, drawn as one figure. A group
	 *  that does NOT end in a type is damage with no type — underlined, never blocked: a type is not
	 *  arithmetic, and without one the number is still right (§7 / §10). */
	const groups = $derived(pillGroups(line.pills));
	const closedByType = (group: number[]): boolean =>
		line.pills[group[group.length - 1] ?? -1]?.kind === PILL_KIND.damageType;
	const untyped = (group: number[]): boolean =>
		!isTest &&
		!closedByType(group) &&
		group.some((at) => {
			const kind = line.pills[at]?.kind;
			return kind === PILL_KIND.dice || kind === PILL_KIND.flat;
		});
	const cue = $derived(
		line.advantage === ADVANTAGE_MODE.advantage
			? 'up'
			: line.advantage === ADVANTAGE_MODE.disadvantage
				? 'down'
				: 'neither',
	);

	let input = $state<HTMLInputElement | null>(null);

	/** Which colour a die's number wears — the ROLE it plays in this line, since the pill itself is
	 *  the same surface as every other. Crimson decides the roll, gold was doubled, teal/red is a
	 *  signed contribution from somewhere, plain is just dice. */
	const diceTone = (p: DicePill): string =>
		isTest && p.sides === 20
			? 'deciding'
			: !isTest && line.crit
				? 'doubled'
				: p.source
					? p.sign < 0
						? 'negative'
						: 'positive'
					: '';
	/** A sourced die writes its sign, a pool die does not — the same rule the roller's own `expr`
	 *  rendering follows, so a pill and the record of it read alike. */
	const diceText = (p: DicePill): string =>
		`${p.sign < 0 ? '−' : p.source ? '+' : ''}${p.count}d${p.sides}`;
	const sourceOf = (p: RollerPill): string =>
		(p.kind === PILL_KIND.dice || p.kind === PILL_KIND.flat) && p.source ? p.source : '';
	const previewTone = (preview: string): string =>
		preview.startsWith('−') ? 'negative' : preview.startsWith('+') ? 'positive' : '';

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			// the panel handles Ctrl+Enter too, for focus that is NOT in a line (a header die button).
			// Without this the event reaches both and one press rolls twice.
			event.stopPropagation();
			roll();
			return;
		}
		// Tab with no menu open is still Tab — the roller must not trap focus
		if (event.key === 'Enter' || (event.key === 'Tab' && organ.menu.length)) {
			event.preventDefault();
			organ.commit(index);
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (event.key === 'ArrowDown') organ.selectDown();
			else organ.selectUp();
			return;
		}
		if (event.key === 'Escape' && organ.menu.length) {
			// the menu closes; the dialog around us does not
			event.stopPropagation();
			organ.dismissMenu();
			return;
		}
		if (event.key === 'Backspace' && !(organ.drafts[index] ?? '')) {
			event.preventDefault();
			organ.unfoldLast(index);
		}
	}

	/** A focused pill IS the selected pill — no second piece of state for it, and the focus ring is
	 *  the selection. Del/Backspace removes it, Enter unfolds it back to text (the same act as a
	 *  double-click), and the caret goes back into the line either way so typing continues. */
	function onPillKey(event: KeyboardEvent, at: number): void {
		if (event.key === 'Delete' || event.key === 'Backspace') organ.removePill(index, at);
		else if (event.key === 'Enter') organ.unfold(index, at);
		else return;
		event.preventDefault();
		input?.focus();
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		const moved = event.dataTransfer?.getData('text/roller-pill');
		const [from, pill] = (moved ?? '').split(':').map(Number);
		if (from === undefined || pill === undefined || Number.isNaN(from)) return;
		organ.movePill(from, pill, index);
	}
</script>

<!-- one pill. A raw fragment is NOT drawn as a pill: it stays the text it was, underlined, because
     that is exactly what it is — something the parser could not turn into a pill (§4). -->
{#snippet pillView(pill: RollerPill, at: number)}
	{#if pill.kind === PILL_KIND.raw}
		<span class="roller-raw" title="I can't account for this — the roll is held until it goes"
			>{pill.text}</span
		>
	{:else if pill.kind === PILL_KIND.note}
		<span class="roller-note" title="your own label — it changes no number">{pill.text}</span>
	{:else}
		<span
			class="roller-pill"
			class:type-pill={pill.kind === PILL_KIND.damageType}
			class:inherited={pill.kind === PILL_KIND.damageType && pill.inherited}
			draggable="true"
			role="button"
			tabindex="-1"
			title={pill.kind === PILL_KIND.damageType
				? `${pill.type}${pill.inherited ? ' · inherited from the group on its left' : ''}`
				: pill.text}
			ondragstart={(e) => e.dataTransfer?.setData('text/roller-pill', `${index}:${at}`)}
			onclick={(e) => e.currentTarget.focus()}
			ondblclick={() => organ.unfold(index, at)}
			onkeydown={(e) => onPillKey(e, at)}
		>
			{#if pill.kind === PILL_KIND.dice}
				<span class="roller-value {diceTone(pill)}">{diceText(pill)}</span>
				{#if pill.min !== undefined}<span class="roller-bound">≥{pill.min}</span>{/if}
				{#if pill.max !== undefined}<span class="roller-bound">≤{pill.max}</span>{/if}
				{#if doubles(pill)}<span class="roller-mult">×2</span>{/if}
			{:else if pill.kind === PILL_KIND.flat}
				<span class="roller-value {pill.amount < 0 ? 'negative' : 'positive'}"
					>{signed(pill.amount)}</span
				>
			{:else if pill.kind === PILL_KIND.count}
				<span class="roller-value">×{pill.times} attacks</span>
			{:else if pill.kind === PILL_KIND.damageType}
				<!-- a type the app can draw collapses to its glyph and keeps the word in the tooltip; that
				     is most of the width back when a line carries several types. Homebrew invents types
				     freely, and one with no glyph simply stays a word. -->
				{#if damageGlyph(pill.type).length}
					<DamageIcon type={pill.type} />
				{:else}
					<span class="roller-value muted-value">{pill.type}</span>
				{/if}
			{/if}
			{#if sourceOf(pill)}<span class="roller-source">{sourceOf(pill)}</span>{/if}
			{#if pill.kind === PILL_KIND.dice || pill.kind === PILL_KIND.flat}
				<!-- clicking the NUMBER has to stay a caret placement, or a pill can't be entered with a
				     mouse at all — so the quantity gets its own two controls (§4) -->
				<span class="roller-steps">
					<button type="button" aria-label="one less" onclick={() => organ.bumpPill(index, at, -1)}
						><Icon name="minus" size={9} /></button
					><button type="button" aria-label="one more" onclick={() => organ.bumpPill(index, at, 1)}
						><Icon name="plus" size={9} /></button
					>
				</span>
			{/if}
		</span>
	{/if}
{/snippet}

<div class="roller-line">
	<span class="roller-stripe" class:damage={!isTest}></span>
	<div class="roller-stack">
		<!-- a drop target for a pill dragged from the other line, not a control of its own -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="roller-field"
			class:focused
			class:menu-open={menuOpen}
			ondragover={(e) => e.preventDefault()}
			ondrop={onDrop}
		>
			{#each groups as group, g (g)}
				<span
					class="roller-group"
					class:typed={closedByType(group)}
					class:untyped={untyped(group)}
					title={untyped(group) ? 'damage with no type — it rolls anyway' : undefined}
				>
					{#each group as at (at)}{@render pillView(line.pills[at] as RollerPill, at)}{/each}
				</span>
			{/each}
			<!-- the caret and its grey completion are ONE item, so the field's pill gap can't open
			     between what you typed and what it is about to become -->
			<span class="roller-caret">
				<input
					bind:this={input}
					class="roller-input"
					type="text"
					size={(organ.drafts[index] ?? '').length + 1}
					value={organ.drafts[index] ?? ''}
					aria-label={isTest ? 'test roll' : 'damage roll'}
					oninput={(e) => organ.type(index, e.currentTarget.value)}
					onfocus={() => (organ.focus = index)}
					onkeydown={onKeydown}
				/>
				{#if focused && organ.ghost}<span class="roller-ghost">{organ.ghost}</span>{/if}
			</span>
			<button
				type="button"
				class="roller-field-rest"
				tabindex="-1"
				aria-label="type into this line"
				onclick={() => input?.focus()}
			></button>
		</div>
		{#if menuOpen}
			<!-- the menu is the line continued: same width, joined border, no shadow. Active effects
			     lead; the green dot is what marks them, so the two groups need no headings. -->
			<div class="roller-menu">
				{#each organ.menu as hit, row (hit.candidate.key)}
					<button
						type="button"
						class="roller-menu-row"
						class:on={row === organ.highlight}
						onmousedown={(e) => {
							e.preventDefault();
							organ.pick(index, hit.candidate);
						}}
					>
						<span
							class="roller-menu-preview {previewTone(hit.candidate.preview)}"
							class:empty={!hit.candidate.preview}>{hit.candidate.preview}</span
						>
						<span class="roller-menu-name">
							{#if hit.at >= 0}{hit.candidate.label.slice(0, hit.at)}<b
									>{hit.candidate.label.slice(hit.at, hit.at + hit.length)}</b
								>{hit.candidate.label.slice(hit.at + hit.length)}{:else}{hit.candidate.label}{/if}
						</span>
						<span class="roller-menu-dot" class:active={hit.candidate.active}></span>
						{#if row === organ.highlight}<span class="roller-menu-key">Tab</span>{/if}
					</button>
				{/each}
				<span class="roller-menu-hints">
					<span><b>Tab</b> complete</span>
					<span><b>↓</b> into the list</span>
					<span><b>↑</b> back to the line</span>
				</span>
			</div>
		{/if}
	</div>
	{#if isTest}
		<button
			type="button"
			class="roller-state advantage {cue}"
			title="advantage → disadvantage → neither"
			onclick={() => organ.cycleAdvantage(index)}
		>
			<span class="advantage-cue advantage-cue-{cue}"></span>
		</button>
	{:else}
		<button
			type="button"
			class="roller-state crit"
			class:on={line.crit}
			title="crit — double this line's dice"
			onclick={() => organ.toggleCrit(index)}>×2</button
		>
	{/if}
</div>

<style>
	.roller-line {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}
	/* the role, said once and quietly: crimson decides, gold hurts */
	.roller-stripe {
		flex: none;
		width: 3px;
		align-self: stretch;
		border-radius: 2px;
		background: var(--color-accent);
	}
	.roller-stripe.damage {
		background: var(--color-resource);
	}
	.roller-stack {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.roller-field {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 6px 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 9px;
	}
	/* focus is NEUTRAL and light on purpose: colouring it by role would make "active" and "this is a
	   test" the same signal, and then neither reads */
	.roller-field.focused {
		border-color: var(--color-text-muted);
	}
	.roller-field.menu-open {
		border-radius: 9px 9px 0 0;
		border-bottom-color: transparent;
	}
	/* a damage group: everything left of a type pill belongs to it. Outlined only on hover, and only
	   when there IS a group to outline — a permanent second frame around every run would be as loud as
	   the pills it contains, and the reading it answers ("does this +3 go to the fire or the cold?") is
	   one you have on the pill you are pointing at. */
	.roller-group {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px;
		margin: -2px;
		border: 1px solid transparent;
		border-radius: 9px;
	}
	/* nothing on its left to inherit and no type of its own: the same wavy underline a raw fragment
	   gets, in a muted colour, because this one does not stop the roll */
	.roller-group.untyped {
		text-decoration: underline wavy var(--color-text-muted);
		text-decoration-skip-ink: none;
		text-underline-offset: 5px;
	}
	.roller-group.typed:hover {
		border-color: var(--color-resource-line);
		background: color-mix(in srgb, var(--color-resource) 7%, transparent);
	}
	/* every pill is the SAME surface — the number's colour carries the meaning */
	.roller-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 9px;
		border-radius: 7px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		font-size: var(--font-size-xs);
		white-space: nowrap;
		cursor: grab;
	}
	/* focus is the selection: the pill you clicked is the pill Del removes */
	.roller-pill:focus {
		outline: none;
		border-color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-text) 8%, var(--color-surface-2));
	}
	.roller-pill.type-pill {
		padding: 4px 7px;
		color: var(--color-text-muted);
	}
	/* an inherited type is drawn as the same pill, dashed — so inheritance is visible and editable
	   rather than a silent assumption (§7) */
	.roller-pill.inherited {
		border-style: dashed;
		border-color: var(--color-text-muted);
		opacity: 0.75;
	}
	.roller-value {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.roller-value.deciding {
		color: var(--color-accent-bright);
	}
	.roller-value.doubled {
		color: var(--color-resource);
	}
	.roller-value.positive {
		color: var(--color-good);
	}
	.roller-value.negative {
		color: var(--color-danger);
	}
	.roller-value.muted-value {
		color: var(--color-text-muted);
	}
	/* the provenance: present only when a real source exists — a die typed by hand has none, and a
	   "by hand" marker would add nothing (§8) */
	.roller-source {
		color: var(--color-text-muted);
	}
	.roller-bound,
	.roller-mult {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.roller-steps {
		display: none;
		align-items: center;
		gap: 1px;
		margin: -2px -5px -2px 0;
	}
	.roller-pill:hover .roller-steps,
	.roller-pill:focus-within .roller-steps {
		display: inline-flex;
	}
	.roller-steps button {
		display: flex;
		align-items: center;
		padding: 2px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.roller-steps button:hover {
		color: var(--color-text);
	}
	/* not a pill, because it isn't one: text the parser could not account for, left where it was */
	.roller-raw {
		font-size: var(--font-size-sm);
		color: var(--color-danger);
		text-decoration: underline wavy var(--color-danger);
		text-underline-offset: 3px;
	}
	.roller-note {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.roller-caret {
		display: inline-flex;
		align-items: center;
		min-width: 0;
	}
	/* the field grows with what is typed, so the grey completion sits right after the caret instead of
	   at the far end of a full-width input. `size` is the fallback where `field-sizing` isn't known. */
	.roller-input {
		field-sizing: content;
		min-width: 2ch;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-body);
		font-size: var(--font-size-sm);
		outline: none;
	}
	/* the grey completion, as in a code editor: what this token will become, before it becomes it */
	.roller-ghost {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		opacity: 0.65;
		white-space: nowrap;
		pointer-events: none;
	}
	/* the rest of the row is a click target for the caret — a real button so it needs no a11y excuse */
	.roller-field-rest {
		flex: 1;
		min-width: 20px;
		align-self: stretch;
		border: 0;
		background: transparent;
		cursor: text;
	}
	.roller-menu {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 7px 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-top: 0;
		border-radius: 0 0 9px 9px;
	}
	.roller-menu-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 6px 8px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		text-align: left;
		cursor: pointer;
	}
	/* selection is a FILL, never an outline — the spec is explicit that menu rows carry no borders */
	.roller-menu-row.on,
	.roller-menu-row:hover {
		background: color-mix(in srgb, var(--color-text) 10%, var(--color-surface-2));
		color: var(--color-text);
	}
	.roller-menu-preview {
		flex: none;
		min-width: 3.4em;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	/* a damage type inserts nothing but itself, so its slot stays EMPTY rather than absent — the names
	   have to line up or the list reads as two lists */
	.roller-menu-preview.empty {
		background: transparent;
	}
	.roller-menu-preview.positive {
		color: var(--color-good);
	}
	.roller-menu-preview.negative {
		color: var(--color-danger);
	}
	.roller-menu-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.roller-menu-name b {
		font-weight: 600;
		color: var(--color-text);
	}
	/* activity is a dot, which is why the two groups need no headings */
	.roller-menu-dot {
		flex: none;
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: var(--color-border-strong);
	}
	.roller-menu-dot.active {
		background: var(--color-good);
	}
	.roller-menu-key {
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-size: var(--font-size-micro);
	}
	.roller-menu-hints {
		display: flex;
		gap: var(--space-3);
		padding: 6px 8px 2px;
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		opacity: 0.7;
	}
	.roller-menu-hints b {
		font-weight: 600;
		color: var(--color-text-muted);
	}
	/* the state toggles are the ONE place a tinted fill is allowed: the fill says which state is on,
	   so the glyph never has to be dimmed to say it */
	.roller-state {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 7px;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface-2);
		font-family: var(--font-display);
		font-size: var(--font-size-micro);
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.roller-state:hover {
		border-color: var(--color-text-muted);
	}
	.roller-state.advantage.up {
		background: var(--color-good-soft);
		border-color: var(--color-good-line);
		color: var(--color-success);
	}
	.roller-state.advantage.neither {
		color: var(--color-resource);
	}
	.roller-state.advantage.down {
		background: var(--color-danger-soft);
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.roller-state.crit.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource-line);
		color: var(--color-resource);
	}
</style>
