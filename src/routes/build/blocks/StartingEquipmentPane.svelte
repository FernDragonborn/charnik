<script lang="ts">
	// The starting equipment the class and the background hand out: a card per alternative the book
	// offers, a row of cards per line it prints. A press takes the card — its items land in the
	// Equipment card at once — and a press on another swaps that line and nothing else. Every card
	// shows what it holds, so nothing is picked blind; an item the player chooses ("a martial weapon")
	// is asked on the card itself, with the same "which one" popover an item from the list uses.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { rowName } from '../rows';
	import { KIT_PART, type KitPart } from '$lib/content/starting-equipment';
	import { askKey } from '../starting-kit';
	import { purseSaid, type KitView } from '../starting-kit-picks.svelte';
	import type { InstanceAsk } from '../item-instance-picking.svelte';
	import ItemInstanceAsk from './ItemInstanceAsk.svelte';
	const b = build;

	const kits = $derived(b.kit.kits);
	/** The pick being answered, and where its answer goes. */
	let asking = $state<{
		ask: InstanceAsk;
		kit: KitView;
		at: { line: number; part: number; n: number };
	} | null>(null);

	const letter = (alternative: number) => String.fromCharCode(65 + alternative);
	const isTaken = (kit: KitView, line: number, alternative: number) =>
		!!kit.taken && (kit.taken.picks[line] ?? 0) === alternative;
	const answerOf = (kit: KitView, line: number, alternative: number, part: number, n: number) =>
		kit.taken?.asks[askKey(line, alternative, part, n)];
	const askFor = (
		kit: KitView,
		at: { line: number; part: number; n: number },
		part: Extract<KitPart, { kind: 'any' }>,
		anchor: HTMLElement,
	) => {
		const current = answerOf(kit, at.line, kit.taken?.picks[at.line] ?? 0, at.part, at.n);
		asking = {
			kit,
			at,
			ask: {
				ref: '',
				name: $_('build.kit.anyItem'),
				questions: { bases: b.kit.candidates(part.tagSets), rungs: [], choices: [] },
				anchor,
				...(current ? { current: { base: current } } : {}),
			},
		};
	};
</script>

{#if !kits.length}
	<p class="subtext">{$_('build.kit.none')}</p>
{/if}
{#each kits as kit (kit.source)}
	<div class="kit-head">
		<b>{rowName(kit.row)}</b>
		<span class="subtext">{$_(`build.kit.source.${kit.source}`)}</span>
		<span class="spacer"></span>
		{#if kit.taken}
			<button class="pill-btn" onclick={() => b.kit.putBack(kit.source)}>{$_('build.kit.putBack')}</button>
		{/if}
	</div>
	{#if !kit.taken}<p class="subtext">{$_('build.kit.pressToTake')}</p>{/if}
	{#each kit.lines as line, l (l)}
		<div class="alts" role="radiogroup" aria-label={$_('build.kit.line', { values: { n: l + 1 } })}>
			{#each line.alternatives as alternative, a (a)}
				{@const block = b.kit.blockOf(kit, l, a)}
				{@const on = isTaken(kit, l, a)}
				<div
					class={['alt', on && 'on', block && 'blocked']}
					role="radio"
					tabindex="0"
					aria-checked={on}
					aria-disabled={block && b.draft.strict ? true : undefined}
					onclick={() => b.kit.take(kit.source, l, a)}
					onkeydown={(e) => {
						if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
						e.preventDefault();
						b.kit.take(kit.source, l, a);
					}}
				>
					{#if line.alternatives.length > 1}<span class="letter">{letter(a)}</span>{/if}
					<ul>
						{#each alternative.parts as part, p (p)}
							{#if part.kind === KIT_PART.item}
								<li>
									{#if part.count > 1}{part.count}&nbsp;×&nbsp;{/if}{b.kit.itemName(part.id)}{#if part.ifProficient}<span class="why"
											>{$_('build.kit.ifProficient')}</span
										>{/if}
								</li>
							{:else if part.kind === KIT_PART.any}
								{#each { length: part.count } as _n, n (n)}
									{@const answer = answerOf(kit, l, a, p, n)}
									<li>
										{#if on}
											<button
												type="button"
												class={['ask', answer && 'done']}
												aria-haspopup="dialog"
												onclick={(e) => {
													e.stopPropagation();
													askFor(kit, { line: l, part: p, n }, part, e.currentTarget);
												}}
											>
												{answer ? rowName(b.row(answer)) : $_('build.kit.choose', { values: { count: b.kit.candidates(part.tagSets).length } })}
											</button>
										{:else}
											<span class="ask">{$_('build.kit.choose', { values: { count: b.kit.candidates(part.tagSets).length } })}</span>
										{/if}
									</li>
								{/each}
							{:else if part.kind === KIT_PART.coin}
								<li class="gold">{purseSaid({ [part.coin]: part.amount }, $_)}</li>
							{:else}
								<li class="unread">{part.text}</li>
							{/if}
						{/each}
					</ul>
					{#if block}<span class="why">{$_(`build.kit.block.${block}`)}</span>{/if}
				</div>
			{/each}
		</div>
	{/each}
{/each}
{#if Object.keys(b.kit.coins).length}
	<p class="subtext">{$_('build.kit.purse', { values: { coins: purseSaid(b.kit.coins, $_) } })}</p>
{/if}
{#if asking}
	{@const now = asking}
	<ItemInstanceAsk
		ask={now.ask}
		onanswer={(answers) => {
			// `now` follows `asking`, so it is read before the popover is closed
			const { kit, at } = now;
			asking = null;
			if (answers.base) b.kit.answer(kit.source, at, answers.base);
		}}
		oncancel={() => (asking = null)}
	/>
{/if}

<style>
	.kit-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin: var(--space-4) 0 var(--space-2);
	}
	.kit-head:first-child {
		margin-top: 0;
	}
	.spacer {
		flex: 1;
	}
	.alts {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.alt {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		padding: var(--space-2) var(--space-2-5);
		font-size: var(--font-size-xs);
		cursor: pointer;
	}
	.alt:hover {
		border-color: var(--color-border-strong);
	}
	.alt:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.alt.on {
		border-color: var(--color-accent);
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}
	.alt[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}
	.letter {
		display: block;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-body);
		margin-bottom: var(--space-1);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		line-height: var(--line-height);
	}
	.gold {
		color: var(--color-resource);
		font-weight: 600;
	}
	.unread {
		color: var(--color-text-muted);
		font-style: italic;
	}
	.why {
		display: block;
		color: var(--color-text-muted);
	}
	li .why {
		display: inline;
		margin-inline-start: var(--space-1);
	}
	.ask {
		border: 1px dashed var(--color-accent);
		border-radius: var(--radius-xs);
		padding: 0 var(--space-1);
		color: var(--color-accent);
		background: none;
		font: inherit;
	}
	button.ask {
		cursor: pointer;
	}
	.ask.done {
		border-style: solid;
		border-color: var(--color-border);
		color: var(--color-text);
	}
</style>
