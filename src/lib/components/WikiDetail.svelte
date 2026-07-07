<script lang="ts">
	// Right-pane wiki detail rendered from a content CSV row (d-spellmgr design). Shared by
	// the Compendium (read-only) and the Spellbook (passes an `actions` snippet). The body
	// text may be Markdown and/or contain HTML markup (that's OK — user-owned CSV): it's
	// parsed with marked, then sanitized with DOMPurify so injected <script>/on*/javascript:
	// can't run.
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';
	import { toast } from 'svelte-sonner';
	import { rollFormula } from '$lib/rules/dice';
	import type { DetailModel } from '$lib/content/detail';

	let { detail, actions }: { detail: DetailModel | null; actions?: Snippet } = $props();

	// Some content mixes Markdown with raw HTML tables. marked won't process Markdown that
	// sits inside/right after an HTML block, so: force blank lines around <table> (so the
	// following text parses as Markdown), then mop up emphasis left literal inside table cells.
	function renderBody(md: string): string {
		const spaced = md.replace(/\n*(<table>)/g, '\n\n$1').replace(/(<\/table>)\n*/g, '$1\n\n');
		let html = marked.parse(spaced, { async: false }) as string;
		html = html
			.replace(/\*\*([^*<>\n]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*<>\n]+)\*/g, '<em>$1</em>');
		return DOMPurify.sanitize(html);
	}
	const bodyHtml = $derived(detail && browser ? renderBody(detail.bodyHtml) : '');

	// roll a dice formula ("16d12 + 80", "8d6") and toast the total (shared roller)
	function rollDice(formula: string, label: string) {
		toast(`${label} — ${rollFormula(formula).total}`, { description: formula });
	}
	const rollHp = (formula: string) => rollDice(formula, 'HP rolled');
</script>

<article class="detail-body">
	{#if detail?.spell}
		{@const s = detail.spell}
		<div class="detail-eyebrow">
			<span class="monster-type">{detail.eyebrow}</span>
			<span>{s.edition}</span>
		</div>
		<div class="stat-title">
			<h1>{detail.title}</h1>
			{#if s.ritual}<span class="stat-chip util">Ritual</span>{/if}
			{#if s.concentration}<span class="stat-chip save">Concentration</span>{/if}
		</div>
		<div class="strip">
			<div class="spell-effect {s.resChip}">
				<span class="stat-chip {s.resChip}">{s.resLabel}</span>
				{#if s.dice || s.resChip === 'hit'}
					{#if s.dice}
						<span class="spell-effect-value">{s.dice}</span>
						{#if s.dmgType}<span class="spell-effect-sub">{s.dmgType}</span>{/if}
					{/if}
					<div class="spell-effect-rolls">
						{#if s.resChip === 'hit'}
							<button
								class="spell-effect-roll"
								onclick={() => rollDice('1d20', `${detail.title} — to hit`)}>🎲 d20</button
							>
						{/if}
						{#if s.dice}
							<button class="spell-effect-roll" onclick={() => rollDice(s.dice, detail.title)}
								>🎲 {s.resChip === 'auto' ? 'Heal' : 'Dmg'}</button
							>
						{/if}
					</div>
				{:else}
					<span class="spell-effect-value none">No roll</span>
				{/if}
			</div>
			<div class="stat-cells">
				{#each s.cells as [k, v] (k)}
					<div class="stat-cell">
						<div class="stat-key">{k}</div>
						<div class="stat-value">{v}</div>
					</div>
				{/each}
				{#if s.availableTo?.length}
					<div class="stat-cell span">
						<div class="stat-key">Available to</div>
						<div class="stat-value">
							{#each s.availableTo as c, i (c.name)}{i ? ', ' : ''}{c.name}{#if c.homebrew}<span
										class="homebrew-mark"
										title="granted class-side (not on the spell)">+</span
									>{/if}{/each}
						</div>
					</div>
				{:else if s.classes}
					<div class="stat-cell span">
						<div class="stat-key">Available to</div>
						<div class="stat-value">{s.classes}</div>
					</div>
				{/if}
			</div>
		</div>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
		{#if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}
		{#if s.higherLevel}<div class="highlight">At higher levels — {s.higherLevel}</div>{/if}
		{#if s.material}<div class="source-line">Material — {s.material}</div>{/if}
		<div class="source-line">{detail.source} · CC-BY-4.0</div>
	{:else if detail?.monster}
		{@const m = detail.monster}
		<div class="detail-eyebrow">
			<span>Monster</span>
			<span><span class="monster-type">{m.type}</span> · {m.edition}</span>
		</div>
		<h1>{detail.title}</h1>
		<div class="content-cols">
			<div class="detail-panel">
				<div class="panel-header">Vitals</div>
				<div class="value-row challenge-rating">
					<span class="value-key">CR</span><span class="challenge-rating-value">{m.cr || '—'}</span>
				</div>
				{#if m.ac}<div class="value-row">
						<span class="value-key">AC</span><span>{m.ac}</span>
					</div>{/if}
				{#if m.initiative}<div class="value-row">
						<span class="value-key">Initiative</span><span>{m.initiative}</span>
					</div>{/if}
				{#if m.hp}
					<div class="value-row">
						<span class="value-key">HP</span>
						<span>
							{m.hp}
							{#if m.hpFormula}<span class="dim">{m.hpFormula}</span>
								<button class="hp-dice" title="Roll HP" onclick={() => rollHp(m.hpFormula)}
									>🎲</button
								>{/if}
						</span>
					</div>
				{/if}
				{#if m.speed}<div class="value-row">
						<span class="value-key">Speed</span><span>{m.speed}</span>
					</div>{/if}
			</div>
			<div class="detail-panel">
				<div class="panel-header">Abilities</div>
				<div class="ability-row head" class:has-save={m.hasSaves}>
					<span></span><span>score</span><span>mod</span>{#if m.hasSaves}<span>save</span>{/if}
				</div>
				{#each m.abilities as a (a.ab)}
					<div class="ability-row" class:has-save={m.hasSaves}>
						<span class="ab-n">{a.ab}</span>
						<span>{a.score}</span>
						<span class="amod">{a.mod}</span>
						{#if m.hasSaves}<span class="ability-save">{a.save ?? a.mod}</span>{/if}
					</div>
				{/each}
			</div>
		</div>
		{#if m.band.length || m.defenses.length}
			<div class="band">
				{#each m.band as [k, v] (k)}
					<div class="band-row">
						<span class="band-key">{k}</span><span class="band-value">{v}</span>
					</div>
				{/each}
				{#each m.defenses as [k, v] (k)}
					<div class="band-row defenses">
						<span class="band-key">{k}</span><span class="band-value">{v}</span>
					</div>
				{/each}
			</div>
		{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
		{#if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}
		<div class="source-line">{detail.source} · CC-BY-4.0</div>
	{:else if detail}
		<div class="deyebrow">{detail.eyebrow}</div>
		<h1>{detail.title}</h1>
		{#if actions}<div class="dactions">{@render actions()}</div>{/if}
		{#if detail.abilities.length}
			<div class="abilities">
				{#each detail.abilities as a (a.ab)}
					<div class="ability-block">
						<span class="ability-code">{a.ab}</span>
						<span class="ability-score">{a.score}</span>
						<span class="markdown">{a.mod}</span>
					</div>
				{/each}
			</div>
		{/if}
		{#if detail.meta.length}
			<div class="detail-meta">
				{#each detail.meta as [k, v] (k)}
					<div class="meta-cell">
						<div class="meta-key">{k}</div>
						<div class="meta-value">{v}</div>
					</div>
				{/each}
			</div>
		{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
		{#if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}
		{#if detail.higherLevel}
			<div class="highlight">At higher levels — {detail.higherLevel}</div>
		{/if}
		<div class="source-line">{detail.source} · CC-BY-4.0</div>
	{:else}
		<p class="pick">Select an entry to see its detail.</p>
	{/if}
</article>

<style>
	.detail-body h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
		margin: 6px 0 12px;
	}
	.dactions {
		display: flex;
		gap: 14px;
		align-items: center;
		margin: 4px 0 16px;
		flex-wrap: wrap;
	}
	.abilities {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 6px;
		margin-bottom: 16px;
	}
	.ability-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 8px 4px;
		text-align: center;
	}
	.ability-block .ability-code {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.ability-block .ability-score {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
	}
	.ability-block .markdown {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-accent-bright);
	}
	@media (max-width: 560px) {
		.abilities {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.meta-cell {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 7px 11px;
	}
	.meta-cell :global(.meta-key) {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.meta-cell :global(.meta-value) {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		margin-top: 2px;
		overflow-wrap: anywhere;
	}
	.body {
		font-size: 14px;
		line-height: 1.5;
		color: var(--color-text);
	}
	.body :global(p) {
		margin: 0 0 12px;
	}
	/* content tables (spell/item tables, embedded summon stat blocks) rendered from the CSV */
	.body :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 6px 0 14px;
		font-size: 13px;
	}
	.body :global(th),
	.body :global(td) {
		border: 1px solid var(--color-border);
		padding: 5px 9px;
		text-align: left;
		vertical-align: top;
	}
	.body :global(th) {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		background: var(--color-surface-2);
	}
	.body :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-border);
		margin: 12px 0;
	}
	.body :global(h4),
	.body :global(h5) {
		font-family: var(--font-display);
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 14px 0 6px;
	}
	.body :global(ul),
	.body :global(ol) {
		margin: 0 0 12px;
		padding-left: 20px;
	}
	.body :global(li) {
		margin: 2px 0;
	}
	.highlight {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-resource);
		border-radius: 8px;
		padding: 10px 13px;
		font-size: 13px;
		color: var(--color-text-muted);
		margin: 6px 0 14px;
	}
	.pick {
		color: var(--color-text-muted);
		padding: 20px 22px;
	}

	/* ---- monster stat block (C layout) ---- */
	.detail-eyebrow {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.detail-eyebrow .monster-type {
		color: var(--color-accent-bright);
	}
	.content-cols {
		display: grid;
		grid-template-columns: 1fr 1.2fr;
		gap: 12px;
		margin-bottom: 12px;
	}
	.detail-panel {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 11px;
		padding: 11px 14px;
	}
	.panel-header {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 6px;
	}
	.value-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		padding: 5px 0;
		border-top: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.value-row:first-of-type {
		border-top: 0;
	}
	.value-row .value-key {
		color: var(--color-text-muted);
	}
	.value-row .dim {
		color: var(--color-text-muted);
	}
	.value-row.challenge-rating {
		padding: 2px 0 6px;
	}
	.value-row.challenge-rating .value-key {
		align-self: center;
	}
	.value-row.challenge-rating .challenge-rating-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 26px;
		color: var(--color-accent-bright);
	}
	.hp-dice {
		border: 0;
		background: transparent;
		color: var(--color-accent-bright);
		cursor: pointer;
		font-size: 12px;
		padding: 0 0 0 2px;
	}
	.ability-row {
		display: grid;
		grid-template-columns: 42px 1fr 1fr;
		gap: 6px;
		padding: 4px 0;
		border-top: 1px solid var(--color-border);
		align-items: baseline;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.ability-row.has-save {
		grid-template-columns: 42px 1fr 1fr 1fr;
	}
	.ability-row:first-of-type {
		border-top: 0;
	}
	.ability-row.head {
		color: var(--color-text-muted);
		font-size: 10px;
	}
	.ability-row .ability-code-n {
		color: var(--color-accent-bright);
		font-family: var(--font-display);
		font-weight: 600;
	}
	.ability-row .ability-save {
		color: var(--color-good);
	}
	.band {
		border: 1px solid var(--color-border);
		border-radius: 11px;
		padding: 2px 14px;
		margin-bottom: 4px;
	}
	.band-row {
		display: flex;
		gap: 12px;
		padding: 6px 0;
		border-top: 1px solid var(--color-border);
		font-size: 13px;
	}
	.band-row:first-child {
		border-top: 0;
	}
	.band-row .band-key {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		min-width: 96px;
		flex: none;
		padding-top: 2px;
	}
	.band-row .band-value {
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.band-row.defenses .band-value {
		color: var(--color-accent-bright);
	}
	@media (max-width: 560px) {
		.content-cols {
			grid-template-columns: 1fr;
		}
	}

	/* ---- spell article ("strip" layout) ---- */
	.stat-title {
		display: flex;
		align-items: center;
		gap: 11px;
		margin: 4px 0 14px;
	}
	.stat-title h1 {
		margin: 0;
	}
	.stat-chip {
		font-family: var(--font-mono);
		font-size: 10px;
		border-radius: 5px;
		padding: 2px 7px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.stat-chip.hit {
		color: var(--color-resource);
		border-color: #5a4d28;
	}
	.stat-chip.save {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.stat-chip.auto {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.stat-chip.util {
		color: var(--color-text-muted);
		border-color: var(--color-border-strong);
	}
	.strip {
		display: grid;
		grid-template-columns: 168px 1fr;
		gap: 12px;
		align-items: start;
		margin-bottom: 4px;
	}
	.spell-effect {
		min-height: 116px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 1px solid var(--color-border-strong);
		border-radius: 12px;
		background: var(--color-surface-2);
		padding: 12px 10px;
		text-align: center;
	}
	.spell-effect-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 28px;
		line-height: 1;
	}
	.spell-effect.save .spell-effect-value {
		color: var(--color-accent-bright);
	}
	.spell-effect.hit .spell-effect-value {
		color: var(--color-resource);
	}
	.spell-effect.auto .spell-effect-value {
		color: var(--color-good);
	}
	.spell-effect-value.none {
		color: var(--color-text-muted);
		font-size: 18px;
	}
	.spell-effect-sub {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.spell-effect-rolls {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 5px;
	}
	.spell-effect-roll {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		padding: 3px 10px;
		cursor: pointer;
		background: transparent;
	}
	.spell-effect-roll:hover {
		background: var(--color-accent-soft);
	}
	.stat-cells {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		align-content: start;
	}
	.stat-cell {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 7px 11px;
	}
	.stat-cell.span {
		grid-column: span 2;
	}
	.stat-cell .stat-key {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.stat-cell .stat-value {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		margin-top: 2px;
	}
	@media (max-width: 560px) {
		.strip {
			grid-template-columns: 1fr;
		}
	}
	.homebrew-mark {
		color: var(--color-resource);
		font-weight: 700;
		margin-left: 1px;
	}
</style>
