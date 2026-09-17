<script lang="ts">
	// ONE line of the dice tray: the role stripe, the pills, the caret, the suggestion menu that
	// grows out of the line, and the state toggle that belongs to this line's role (advantage for a
	// test, a crit for damage). All state lives on the dice tray — this component owns none.
	//
	// Two things here are load-bearing and easy to undo by accident:
	//  · colour lives in the TEXT, never in a pill's fill. Every pill is the same surface + border;
	//    the number's colour says what it is. Tinted fills are reserved for the state toggles, so
	//    "this is a test" and "this line is active" can't be read as the same signal.
	//  · the menu is a CONTINUATION of the line, not a dropdown over it: same width, joined borders,
	//    so the pills appear to grow downward.
	import { _ } from '$lib/i18n';
	import { tick } from 'svelte';
	import DamageIcon from './DamageIcon.svelte';
	import { isDamageType } from '$lib/dice/roller-vocabulary';
	import Icon from './Icon.svelte';
	import { damageGlyph } from './damage-glyphs';
	import {
		PILL_KIND,
		ROLLER_ROLE,
		TOKEN_KIND,
		pillGroups,
		type DicePill,
		type RollerLine,
		type RollerPill,
	} from '$lib/dice/roller';
	import type { DiceTray } from '$lib/dice/dice-tray.svelte';
	import type { RollerCandidate } from '$lib/dice/roller-vocabulary';
	import { ADVANTAGE_CUE, ADVANTAGE_MODE } from '$lib/rules/dice';
	import { signed } from '$lib/util/format';

	let {
		diceTray,
		index,
		line,
		roll,
	}: { diceTray: DiceTray; index: number; line: RollerLine; roll: () => void } = $props();

	/** How many columns the type picker lays out in. Here rather than only in the CSS because the
	 *  markup has to say how many rows go in each column for a column-first fill — and because ←/→
	 *  cross a column by stepping exactly that many rows along the flat list. */
	const TYPE_COLUMNS = 2;
	const typeRows = $derived(Math.ceil(diceTray.menu.length / TYPE_COLUMNS));

	const isTest = $derived(line.role === ROLLER_ROLE.test);
	const focused = $derived(diceTray.focus === index);
	/** The menu hangs off the line it belongs to — the one being typed in, or, when a type pill opened
	 *  it, the one that pill is in (the caret may well still be in the other line). */
	const menuOpen = $derived(
		diceTray.menu.length > 0 && (diceTray.retyping ? diceTray.retyping.line === index : focused),
	);
	/** The line's state doubles this die — and WHICH dice differs by role: advantage draws a second
	 *  d20 and touches nothing else, while a crit doubles every damage die in the line. */
	const doubles = (p: DicePill): boolean =>
		isTest ? p.sides === 20 && line.advantage !== ADVANTAGE_MODE.neither : line.crit;
	/** Where the caret stands in this line — the pill index it is in front of. */
	const caret = $derived(diceTray.caretAt(index));

	/** Damage groups: everything left of a type pill is that type's, drawn as one figure. A group that
	 *  does NOT end in a type is damage with no type — underlined, never blocked: a type is not
	 *  arithmetic, and without one the number is still right (§7 / §10).
	 *
	 *  Split at the caret: the groups of the tokens before it, and of those after (their pill indices
	 *  shifted back to absolute, since the pills they name are the same ones). */
	const before = $derived(pillGroups(line.pills.slice(0, caret)));
	const after = $derived(
		pillGroups(line.pills.slice(caret)).map((group) => group.map((at) => at + caret)),
	);
	const closedByType = (group: number[]): boolean =>
		line.pills[group[group.length - 1] ?? -1]?.kind === PILL_KIND.damageType;
	const untyped = (group: number[]): boolean =>
		!isTest &&
		!closedByType(group) &&
		group.some((at) => {
			const kind = line.pills[at]?.kind;
			return kind === PILL_KIND.dice || kind === PILL_KIND.flat;
		});
	const cue = $derived(ADVANTAGE_CUE[line.advantage]);
	/** The same cue for a MENU row that sets a mode — the `advantage`/`disadvantage`/`neutral` rows and
	 *  any source whose whole contribution is advantage. Null for every other row, which has a chip. */
	const rowCue = (candidate: RollerCandidate): string | null =>
		candidate.insert.kind === TOKEN_KIND.advantage ? ADVANTAGE_CUE[candidate.insert.mode] : null;

	let input = $state<HTMLInputElement | null>(null);

	/** Which colour a die's number wears — the ROLE it plays in this line, since the pill itself is
	 *  the same surface as every other. Crimson decides the roll, gold was doubled, teal/red is a
	 *  signed contribution from somewhere, plain is just dice. */
	const diceTone = (p: DicePill): string => {
		if (isTest && p.sides === 20) return 'deciding';
		if (!isTest && line.crit) return 'doubled';
		if (!p.source) return '';
		return p.sign < 0 ? 'negative' : 'positive';
	};
	/** A sourced die writes its sign, a pool die does not — the same rule the roller's own `expr`
	 *  rendering follows, so a pill and the record of it read alike. */
	const diceText = (p: DicePill): string =>
		`${p.sign < 0 ? '−' : p.source ? '+' : ''}${p.count}d${p.sides}`;
	const sourceOf = (p: RollerPill): string =>
		(p.kind === PILL_KIND.dice || p.kind === PILL_KIND.flat) && p.source ? p.source : '';
	const previewTone = (preview: string): string =>
		preview.startsWith('−') ? 'negative' : preview.startsWith('+') ? 'positive' : '';

	/** Whether the TEXT caret is at an edge of the draft — only then does an arrow leave the token it
	 *  is in and step to the next one. Inside the text, ← and → are ordinary text editing. */
	const atTextStart = (i: HTMLInputElement): boolean =>
		i.selectionStart === 0 && i.selectionEnd === 0;
	const atTextEnd = (i: HTMLInputElement): boolean =>
		i.selectionStart === i.value.length && i.selectionEnd === i.value.length;

	/** Step to the next token and put the TEXT caret where the step arrived from — the end of the token
	 *  when walking left, its start when walking right, so the next arrow reads as one more character
	 *  rather than a jump. `atEnd` overrides that for Ctrl+arrow, which lands on a whole token. */
	async function step(left: boolean, atEnd = left): Promise<void> {
		// a step that went nowhere leaves the text caret alone: re-placing it is what threw you to the
		// end of the token you were already in when there was nothing to step into
		if (!(left ? diceTray.caretLeft(index) : diceTray.caretRight(index))) return;
		await tick();
		// the caret MOVED in the markup, so this is a different input element than the one the key was
		// pressed in — it has to be re-focused or the walk drops focus on its first step
		input?.focus();
		const at = atEnd ? (input?.value.length ?? 0) : 0;
		input?.setSelectionRange(at, at);
	}

	/** Put the caret in ANOTHER line of this same roller. The input lives in that line's component, so
	 *  the only handle on it is the DOM — scoped to this tray's panel, since a page may mount more
	 *  than one. Out of range is a no-op: the first line's ↑ and the last line's ↓ do nothing. */
	function focusLine(at: number): void {
		const inputs = input
			?.closest('.roller-panel')
			?.querySelectorAll<HTMLInputElement>('.roller-input');
		inputs?.[at]?.focus();
	}

	function onKeydown(event: KeyboardEvent): void {
		const held = event.ctrlKey || event.metaKey;
		// walk a token left: what is typed folds back into the line and the token before it opens.
		// Ctrl+Z is the same move — the browser's own undo would restore the TEXT of a token while the
		// pill it became stayed in the line, which is a line that says the same thing twice.
		// the PHYSICAL key (AGENTS.md ▸ Taste): on a Ukrainian layout — a shipped locale — `key` is "я"
		if (event.code === 'KeyZ' && held) {
			event.preventDefault();
			void step(true);
			return;
		}
		// Ctrl+arrow jumps a whole TOKEN, not a word: "Blessing of the Trickster" is one thing here, and
		// the browser's word-at-a-time jump would stop three times inside it.
		if (
			event.key === 'ArrowLeft' &&
			(held || atTextStart(event.currentTarget as HTMLInputElement))
		) {
			event.preventDefault();
			void step(true);
			return;
		}
		if (
			event.key === 'ArrowRight' &&
			(held || atTextEnd(event.currentTarget as HTMLInputElement))
		) {
			event.preventDefault();
			void step(false, held);
			return;
		}
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			// the panel handles Ctrl+Enter too, for focus that is NOT in a line (a header die button).
			// Without this the event reaches both and one press rolls twice.
			event.stopPropagation();
			roll();
			return;
		}
		// Tab with no menu open is still Tab — the roller must not trap focus
		if (event.key === 'Enter' || (event.key === 'Tab' && diceTray.menu.length)) {
			event.preventDefault();
			// Enter FINISHES what is pending — the token being typed, or the suggestion under the
			// highlight. With neither, it had nothing to finish and did nothing at all, which is the one
			// state where the press obviously means "roll it" (playtest). Ctrl+Enter is unchanged: it
			// rolls from anywhere, including a header die button with no line focused.
			if (
				event.key === 'Enter' &&
				!diceTray.menu.length &&
				!(diceTray.drafts[index] ?? '').trim()
			) {
				event.stopPropagation();
				roll();
				return;
			}
			diceTray.commit(index);
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const down = event.key === 'ArrowDown';
			// with a menu open the arrows walk IT; with none open there is nothing else vertical in a
			// roller but its lines, so they step between test and damage
			if (diceTray.menu.length) {
				if (down) diceTray.selectDown();
				else diceTray.selectUp();
			} else focusLine(index + (down ? 1 : -1));
			return;
		}
		if (event.key === 'Escape' && diceTray.menu.length) {
			// the suggestion menu is a hint, not a layer to dismiss on its own: Escape closes the tray
			// around us in the same press (the tray keeps what you built, so nothing is lost). Only the
			// menu state is cleaned up here, so re-opening doesn't come back onto a stale list.
			diceTray.dismissMenu();
			return;
		}
		if (event.key === 'Backspace' && !(diceTray.drafts[index] ?? '')) {
			event.preventDefault();
			void step(true);
		}
	}

	/** Leaving the line parses what is in it. A token is finished by a space, by Enter — or by you
	 *  going somewhere else, which is the same statement ("I'm done with this one") made with the
	 *  mouse. Same single path as Tab/Enter/Roll, so what the ghost promised is what lands.
	 *  Clicking a menu row does NOT reach this: that row preventDefaults its mousedown and the caret
	 *  never leaves. */
	function onblur(): void {
		diceTray.commit(index);
	}

	const picking = $derived(diceTray.retyping?.line === index ? diceTray.retyping.pill : -1);

	/** Take a menu row. The caret goes back into the line either way — after picking from a PILL's
	 *  menu the pill would otherwise keep the focus ring, still reading as selected when the thing it
	 *  was selected for is over. */
	function pickRow(candidate: RollerCandidate): void {
		diceTray.pick(index, candidate);
		input?.focus();
	}

	/** A focused pill IS the selected pill — no second piece of state for it, and the focus ring is
	 *  the selection. While the pill's own type menu is open the arrows and Enter belong to THAT, so a
	 *  picker opened by a click is still finishable without the mouse. */
	function onPillKey(event: KeyboardEvent, at: number): void {
		const row = picking === at ? diceTray.menu[diceTray.highlight] : undefined;
		if (picking === at && event.key === 'ArrowDown') diceTray.selectDown();
		else if (picking === at && event.key === 'ArrowUp') diceTray.selectUp();
		// the picker is two columns, so it is walked in two directions: ↓↑ down a column, ←→ across to
		// the next one — a whole column's worth of rows along the list
		else if (picking === at && event.key === 'ArrowRight') diceTray.selectAcross(typeRows);
		else if (picking === at && event.key === 'ArrowLeft') diceTray.selectAcross(-typeRows);
		else if (picking === at && event.key === 'Escape') diceTray.dismissMenu();
		else if (row && event.key === 'Enter') pickRow(row.candidate);
		else return onPillEdit(event, at);
		event.preventDefault();
	}

	/** Delete/Backspace removes the pill, Enter unfolds it back to text (the same act as a
	 *  double-click), and the caret goes back into the line either way so typing continues. */
	function onPillEdit(event: KeyboardEvent, at: number): void {
		if (event.key === 'Delete' || event.key === 'Backspace') diceTray.removePill(index, at);
		else if (event.key === 'Enter') diceTray.unfold(index, at);
		else return;
		event.preventDefault();
		input?.focus();
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		const moved = event.dataTransfer?.getData('text/roller-pill');
		const [from, pill] = (moved ?? '').split(':').map(Number);
		if (from === undefined || pill === undefined || Number.isNaN(from)) return;
		diceTray.movePill(from, pill, index);
	}
</script>

<!-- one pill. A raw fragment is NOT drawn as a pill: it stays the text it was, underlined, because
     that is exactly what it is — something the parser could not turn into a pill (§4). -->
{#snippet pillView(pill: RollerPill, at: number)}
	{#if pill.kind === PILL_KIND.raw}
		<span class="roller-raw" title={$_('roller.rawHeld')}>{pill.text}</span>
	{:else if pill.kind === PILL_KIND.note}
		<span class="roller-note" title={$_('roller.noteHint')}>{pill.text}</span>
	{:else}
		<!-- Focusable but NOT in the tab order on purpose: a line can hold half a dozen pills, and
		     tabbing through every one to leave the roller would be worse than the affordance is worth.
		     A keyboard already reaches every pill — Backspace at the caret unfolds them one at a time,
		     right to left — so what a click buys here is a shortcut for a mouse, not the only path. -->
		<span
			class="roller-pill"
			class:type-pill={pill.kind === PILL_KIND.damageType}
			class:inherited={pill.kind === PILL_KIND.damageType && pill.inherited}
			draggable="true"
			role="button"
			tabindex="-1"
			title={pill.kind === PILL_KIND.damageType
				? pill.inherited
					? $_('roller.inheritedType', { values: { type: pill.type ?? '' } })
					: (pill.type ?? '')
				: pill.text}
			ondragstart={(e) => e.dataTransfer?.setData('text/roller-pill', `${index}:${at}`)}
			onclick={(e) => {
				e.currentTarget.focus();
				// a type pill has no caret to click into, so clicking it opens the type menu; clicking any
				// other pill is what closes that menu again
				diceTray.retype(index, at);
			}}
			ondblclick={() => diceTray.unfold(index, at)}
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
				<!-- the pill OPENS something, and nothing said so: the playtest found the type menu by
				     accident. The same chevron every menu control in the app wears (the duration select,
				     the base-item chooser) is what marks it, rather than a cue invented for one pill. -->
				<Icon name="chevron-down" size={10} />
			{/if}
			{#if sourceOf(pill)}<span class="roller-source">{sourceOf(pill)}</span>{/if}
			{#if pill.kind === PILL_KIND.dice || pill.kind === PILL_KIND.flat}
				<!-- clicking the NUMBER has to stay a caret placement, or a pill can't be entered with a
				     mouse at all — so the quantity gets its own two controls (§4) -->
				<!-- the two clicks stop here: they belong to the STEPPER, and letting them reach the pill
				     would select it on the first and unfold it into text on the second — so nudging a
				     modifier twice would throw you into editing it -->
				<span class="roller-steps">
					<button
						type="button"
						aria-label={$_('roller.oneLess')}
						onclick={(e) => (e.stopPropagation(), diceTray.bumpPill(index, at, -1))}
						ondblclick={(e) => e.stopPropagation()}><Icon name="minus" size={9} /></button
					><button
						type="button"
						aria-label={$_('roller.oneMore')}
						onclick={(e) => (e.stopPropagation(), diceTray.bumpPill(index, at, 1))}
						ondblclick={(e) => e.stopPropagation()}><Icon name="plus" size={9} /></button
					>
				</span>
			{/if}
		</span>
	{/if}
{/snippet}

<!-- a damage group: everything left of a type pill belongs to it. A group the caret walked INTO is
     drawn as two, one either side of the caret — which is what it is while you are editing it. -->
{#snippet groupView(group: number[])}
	<span
		class="roller-group"
		class:typed={closedByType(group)}
		class:untyped={untyped(group)}
		title={untyped(group) ? $_('roller.untypedGroup') : undefined}
	>
		{#each group as at (at)}{@const pill = line.pills[at]}{#if pill}{@render pillView(
					pill,
					at,
				)}{/if}{/each}
	</span>
{/snippet}

<!-- the caret and its grey completion are ONE item, so the field's pill gap can't open between what
     you typed and what it is about to become. -->
{#snippet caretView()}
	<span class="roller-caret">
		<input
			bind:this={input}
			class="roller-input"
			type="text"
			size={(diceTray.drafts[index] ?? '').length + 1}
			value={diceTray.drafts[index] ?? ''}
			aria-label={$_(isTest ? 'roller.testRoll' : 'roller.damageRoll')}
			oninput={(e) => diceTray.type(index, e.currentTarget.value)}
			onfocus={() => {
				diceTray.focus = index;
				// back at the caret: the menu belongs to what is typed again, not to a pill
				diceTray.retyping = null;
			}}
			{onblur}
			onkeydown={onKeydown}
		/>
		{#if focused && diceTray.ghost}<span class="roller-ghost">{diceTray.ghost}</span>{/if}
	</span>
{/snippet}

<div class="roller-line">
	<div class="roller-stack">
		<!-- the stripe stands beside the FIELD only. Stretched down the whole stack it also ran the
		     length of an open menu, which is a long coloured rule saying nothing about the list. -->
		<div class="roller-row">
			<span class="roller-stripe" class:damage={!isTest}></span>
			<!-- a drop target for a pill dragged from the other line, not a control of its own -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="roller-field"
				class:focused
				class:menu-open={menuOpen}
				ondragover={(e) => e.preventDefault()}
				ondrop={onDrop}
			>
				<!-- the tokens before the caret, the caret, the tokens after it. The caret is rendered ONCE,
			     between the two blocks, and never inside one: walking the line then MOVES the input
			     element instead of destroying and rebuilding it, and a moved element keeps its focus. -->
				{#each before as group, g (g)}{@render groupView(group)}{/each}
				{@render caretView()}
				{#each after as group, g (g)}{@render groupView(group)}{/each}
				<button
					type="button"
					class="roller-field-rest"
					tabindex="-1"
					aria-label={$_('roller.typeIntoLine')}
					onclick={() => {
						// the empty rest of the row is past every token, so clicking it means "type at the end"
						diceTray.caretToEnd(index);
						input?.focus();
					}}
				></button>
			</div>
		</div>
		{#if menuOpen}
			<!-- the menu is the line continued: same width, joined border, no shadow. Active effects
			     lead; the green dot is what marks them, so the two groups need no headings. -->
			<div class="roller-menu" class:types={picking >= 0}>
				<!-- the type picker's two columns are filled COLUMN-first (`--type-rows` is how many go in
				     each), so the next row in the list is the next row on screen: ↓ walks straight down a
				     column instead of hopping left–right–down through a row-major grid. -->
				<div class="roller-menu-rows" style:--type-rows={typeRows}>
					{#each diceTray.menu as hit, row (hit.candidate.key)}
						<button
							type="button"
							class="roller-menu-row"
							class:on={row === diceTray.highlight}
							onmousedown={(e) => {
								e.preventDefault();
								pickRow(hit.candidate);
							}}
						>
							{#if isDamageType(hit.candidate)}
								<span class="roller-menu-glyph">
									{#if damageGlyph(hit.candidate.key).length}<DamageIcon
											type={hit.candidate.key}
										/>{/if}
								</span>
								<!-- a row that sets the MODE wears the same cue the line's toggle and a rolled d20 do, so the
							     shape is what you look for rather than three words of similar length -->
							{:else if rowCue(hit.candidate)}
								<span class="roller-menu-glyph cue-{rowCue(hit.candidate)}">
									<span class="advantage-cue advantage-cue-{rowCue(hit.candidate)}"></span>
								</span>
							{:else}
								<span
									class="roller-menu-preview {previewTone(hit.candidate.preview)}"
									class:empty={!hit.candidate.preview}>{hit.candidate.preview}</span
								>
							{/if}
							<span class="roller-menu-name">
								{#if hit.at >= 0}{hit.candidate.label.slice(0, hit.at)}<b
										>{hit.candidate.label.slice(hit.at, hit.at + hit.length)}</b
									>{hit.candidate.label.slice(hit.at + hit.length)}{:else}{hit.candidate.label}{/if}
							</span>
							{#if !isDamageType(hit.candidate)}
								<span class="roller-menu-dot" class:active={hit.candidate.active}></span>
							{/if}
							{#if row === diceTray.highlight}<span class="roller-menu-key"
									>{picking >= 0 ? '↵' : 'Tab'}</span
								>{/if}
						</button>
					{/each}
				</div>
				<span class="roller-menu-hints">
					{#if picking >= 0}
						<span><b>↓ ↑ ← →</b> {$_('roller.pickType')}</span>
						<span><b>Esc</b> {$_('roller.keepThisOne')}</span>
					{:else}
						<span><b>Tab</b> {$_('roller.complete')}</span>
						<span><b>↓</b> {$_('roller.intoTheList')}</span>
						<span><b>↑</b> {$_('roller.backToLine')}</span>
					{/if}
				</span>
			</div>
		{/if}
	</div>
	{#if isTest}
		<button
			type="button"
			class="roller-state advantage {cue}"
			title={$_('roller.advantageCycle')}
			onclick={() => diceTray.cycleAdvantage(index)}
		>
			<span class="advantage-cue advantage-cue-{cue}"></span>
		</button>
	{:else}
		<button
			type="button"
			class="roller-state crit"
			class:on={line.crit}
			title={$_('roller.critHint')}
			onclick={() => diceTray.toggleCrit(index)}>×2</button
		>
	{/if}
</div>

<style>
	.roller-line {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}
	/* the stripe and the field, side by side — the row the stripe measures itself against */
	.roller-row {
		display: flex;
		align-items: stretch;
		gap: var(--space-2);
	}
	/* the role, said once and quietly: crimson decides, gold hurts */
	.roller-stripe {
		flex: none;
		width: 3px;
		align-self: stretch;
		border-radius: var(--radius-xs);
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
	/* the field draws NO box at rest. What a line is, is said by its stripe and by the pills standing
	   in it; a permanent frame around them only nested a third rectangle between the panel and the
	   number. The border is kept in place as transparent so appearing on focus shifts nothing. */
	.roller-field {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
		min-height: 36px;
		padding: var(--space-1-5) var(--space-2);
		background: transparent;
		/* A field you can type into says so before you click it. It used to be transparent at rest, so
		   the only way to find out there was a field here was to click where you guessed one was —
		   `ui.md` ▸ Every interactive element says so. The edge is quiet; focus is what brightens it. */
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	/* focus is NEUTRAL and light on purpose: colouring it by role would make "active" and "this is a
	   test" the same signal, and then neither reads. It reads as focus by being a STEP up from the
	   resting edge rather than by appearing out of nothing. */
	.roller-field.focused {
		border-color: var(--color-border-strong);
	}
	.roller-field.menu-open {
		border-radius: var(--radius) var(--radius) 0 0;
		border-bottom-color: transparent;
	}
	/* a damage group: everything left of a type pill belongs to it. Outlined only on hover, and only
	   when there IS a group to outline — a permanent second frame around every run would be as loud as
	   the pills it contains, and the reading it answers ("does this +3 go to the fire or the cold?") is
	   one you have on the pill you are pointing at. */
	.roller-group {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		padding: 2px;
		margin: -2px;
		border: 1px solid transparent;
		border-radius: var(--radius);
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
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius);
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
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-1-5);
		color: var(--color-text-muted);
	}
	/* the chevron is quieter than the type it belongs to until the pill is under the pointer */
	.roller-pill.type-pill :global(svg:last-child) {
		opacity: 0.55;
	}
	.roller-pill.type-pill:hover :global(svg:last-child),
	.roller-pill.type-pill:focus :global(svg:last-child) {
		opacity: 1;
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
		margin: -2px calc(-1 * var(--space-1)) -2px 0;
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
		/* 1ch, not 2: the floor is only there so an EMPTY field still shows a caret to click into. At 2
		   it stayed wider than one or two typed letters, and the grey completion — which starts where
		   the field ends — drifted a space off the word it was completing as you deleted back. */
		min-width: 1ch;
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
		gap: var(--space-1);
		/* it hangs off the FIELD, so it starts where the field does — past the stripe's column */
		margin-inline-start: calc(var(--space-1) + var(--space-2));
		padding: var(--space-1-5) var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-top: 0;
		border-radius: 0 0 var(--radius) var(--radius);
	}
	.roller-menu-rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	/* the type picker is every damage type there is — a dozen-odd rows. Two columns because the list is
	   a CHOICE, not a search result: nothing is ranked, so height is all the single column was buying.
	   Filled column-FIRST (`grid-auto-flow: column` over an explicit row count), because the arrow keys
	   walk the list by index: row-major columns made ↓ jump sideways before it ever went down. */
	.roller-menu.types .roller-menu-rows {
		display: grid;
		grid-auto-flow: column;
		grid-template-rows: repeat(var(--type-rows), auto);
		grid-template-columns: repeat(2, 1fr);
		gap: 2px var(--space-2);
	}
	.roller-menu-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1-5) var(--space-2);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		text-align: start;
		cursor: pointer;
	}
	/* selection is a FILL, never an outline — the spec is explicit that menu rows carry no borders */
	.roller-menu-row.on,
	.roller-menu-row:hover {
		background: color-mix(in srgb, var(--color-text) 10%, var(--color-surface-2));
		color: var(--color-text);
	}
	/* a damage type wears its glyph where an effect writes its number. No chip behind it: the icon is
	   already a shape, and a second plate around it would be the third box in one row. */
	.roller-menu-glyph {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 1.6em;
		color: var(--color-text-muted);
	}
	.roller-menu-row.on .roller-menu-glyph {
		color: var(--color-text);
	}
	/* the cue is drawn in `currentColor`, so the direction is said in colour exactly as a `+1d4` /
	   `−1d4` chip says its own — and it keeps that colour when the row is highlighted, which is why
	   these come after the rule above at the same weight. Neutral stays uncoloured: it is the ABSENCE
	   of a state, and a third colour would make "no advantage" look like a third one. */
	.roller-menu-row .roller-menu-glyph.cue-up {
		color: var(--color-good);
	}
	.roller-menu-row .roller-menu-glyph.cue-down {
		color: var(--color-danger);
	}
	.roller-menu-preview {
		flex: none;
		min-width: 3.4em;
		padding: 2px var(--space-1-5);
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
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-size: var(--font-size-micro);
	}
	.roller-menu-hints {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-1-5) var(--space-2) 2px;
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
		border-radius: var(--radius);
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
