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
	import type { DetailModel } from '$lib/content/detail';

	let { detail, actions }: { detail: DetailModel | null; actions?: Snippet } = $props();

	const bodyHtml = $derived(
		detail && browser ? DOMPurify.sanitize(marked.parse(detail.bodyHtml, { async: false })) : ''
	);

	// roll a dice formula ("16d12 + 80", "8d6") and toast the total
	function rollDice(formula: string, label: string) {
		let total = 0;
		const dm = /(\d+)d(\d+)/.exec(formula);
		if (dm)
			for (let i = 0; i < Number(dm[1]); i++)
				total += 1 + Math.floor(Math.random() * Number(dm[2]));
		const fm = /([+-]\s*\d+)\s*$/.exec(formula);
		if (fm) total += Number(fm[1].replace(/\s/g, ''));
		toast(`${label} — ${total}`, { description: formula });
	}
	const rollHp = (formula: string) => rollDice(formula, 'HP rolled');
</script>

<article class="detail">
	{#if detail?.spell}
		{@const s = detail.spell}
		<div class="meyebrow">
			<span class="mtype">{detail.eyebrow}</span>
			<span>{s.edition}</span>
		</div>
		<div class="stitle">
			<h1>{detail.title}</h1>
			{#if s.ritual}<span class="schip util">Ritual</span>{/if}
			{#if s.concentration}<span class="schip save">Concentration</span>{/if}
		</div>
		<div class="strip">
			<div class="fx {s.resChip}">
				<span class="schip {s.resChip}">{s.resLabel}</span>
				{#if s.dice || s.resChip === 'hit'}
					{#if s.dice}
						<span class="fxbig">{s.dice}</span>
						{#if s.dmgType}<span class="fxsub">{s.dmgType}</span>{/if}
					{/if}
					<div class="fxrolls">
						{#if s.resChip === 'hit'}
							<button class="fxroll" onclick={() => rollDice('1d20', `${detail.title} — to hit`)}
								>🎲 d20</button
							>
						{/if}
						{#if s.dice}
							<button class="fxroll" onclick={() => rollDice(s.dice, detail.title)}
								>🎲 {s.resChip === 'auto' ? 'Heal' : 'Dmg'}</button
							>
						{/if}
					</div>
				{:else}
					<span class="fxbig none">No roll</span>
				{/if}
			</div>
			<div class="scells">
				{#each s.cells as [k, v] (k)}
					<div class="scell">
						<div class="sk">{k}</div>
						<div class="sv">{v}</div>
					</div>
				{/each}
				{#if s.classes}
					<div class="scell span">
						<div class="sk">Classes</div>
						<div class="sv">{s.classes}</div>
					</div>
				{/if}
			</div>
		</div>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
		{#if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}
		{#if s.higherLevel}<div class="hl">At higher levels — {s.higherLevel}</div>{/if}
		{#if s.material}<div class="src">Material — {s.material}</div>{/if}
		<div class="src">{detail.source} · CC-BY-4.0</div>
	{:else if detail?.monster}
		{@const m = detail.monster}
		<div class="meyebrow">
			<span>Monster</span>
			<span><span class="mtype">{m.type}</span> · {m.edition}</span>
		</div>
		<h1>{detail.title}</h1>
		<div class="c-cols">
			<div class="mpanel">
				<div class="mph">Vitals</div>
				<div class="vrow cr"><span class="vk">CR</span><span class="crv">{m.cr || '—'}</span></div>
				{#if m.ac}<div class="vrow"><span class="vk">AC</span><span>{m.ac}</span></div>{/if}
				{#if m.initiative}<div class="vrow">
						<span class="vk">Initiative</span><span>{m.initiative}</span>
					</div>{/if}
				{#if m.hp}
					<div class="vrow">
						<span class="vk">HP</span>
						<span>
							{m.hp}
							{#if m.hpFormula}<span class="dim">{m.hpFormula}</span>
								<button class="hpdice" title="Roll HP" onclick={() => rollHp(m.hpFormula)}
									>🎲</button
								>{/if}
						</span>
					</div>
				{/if}
				{#if m.speed}<div class="vrow">
						<span class="vk">Speed</span><span>{m.speed}</span>
					</div>{/if}
			</div>
			<div class="mpanel">
				<div class="mph">Abilities</div>
				<div class="arow head" class:has-save={m.hasSaves}>
					<span></span><span>score</span><span>mod</span>{#if m.hasSaves}<span>save</span>{/if}
				</div>
				{#each m.abilities as a (a.ab)}
					<div class="arow" class:has-save={m.hasSaves}>
						<span class="ab-n">{a.ab}</span>
						<span>{a.score}</span>
						<span class="amod">{a.mod}</span>
						{#if m.hasSaves}<span class="asv">{a.save ?? a.mod}</span>{/if}
					</div>
				{/each}
			</div>
		</div>
		{#if m.band.length || m.defenses.length}
			<div class="band">
				{#each m.band as [k, v] (k)}
					<div class="brow"><span class="bk">{k}</span><span class="bv">{v}</span></div>
				{/each}
				{#each m.defenses as [k, v] (k)}
					<div class="brow def"><span class="bk">{k}</span><span class="bv">{v}</span></div>
				{/each}
			</div>
		{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
		{#if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}
		<div class="src">{detail.source} · CC-BY-4.0</div>
	{:else if detail}
		<div class="deyebrow">{detail.eyebrow}</div>
		<h1>{detail.title}</h1>
		{#if actions}<div class="dactions">{@render actions()}</div>{/if}
		{#if detail.abilities.length}
			<div class="abilities">
				{#each detail.abilities as a (a.ab)}
					<div class="abil">
						<span class="ab">{a.ab}</span>
						<span class="sc">{a.score}</span>
						<span class="md">{a.mod}</span>
					</div>
				{/each}
			</div>
		{/if}
		{#if detail.meta.length}
			<div class="meta">
				{#each detail.meta as [k, v] (k)}
					<div class="mcell">
						<div class="k">{k}</div>
						<div class="v">{v}</div>
					</div>
				{/each}
			</div>
		{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
		{#if bodyHtml}<div class="body">{@html bodyHtml}</div>{/if}
		{#if detail.higherLevel}
			<div class="hl">At higher levels — {detail.higherLevel}</div>
		{/if}
		<div class="src">{detail.source} · CC-BY-4.0</div>
	{:else}
		<p class="pick">Select an entry to see its detail.</p>
	{/if}
</article>

<style>
	.detail {
		padding: 20px 22px;
		overflow: auto;
		min-height: 0;
	}
	.deyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.18em;
		font-size: 11px;
		color: var(--color-accent-bright);
	}
	.detail h1 {
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
	.abil {
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
	.abil .ab {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.abil .sc {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 17px;
	}
	.abil .md {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-accent-bright);
	}
	@media (max-width: 560px) {
		.abilities {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.meta {
		display: grid;
		/* short values (AC, size, CR…) pack more per row instead of two giant boxes */
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
		margin-bottom: 16px;
	}
	.mcell {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 7px 11px;
	}
	.mcell :global(.k) {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.mcell :global(.v) {
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
	.hl {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-resource);
		border-radius: 8px;
		padding: 10px 13px;
		font-size: 13px;
		color: var(--color-text-muted);
		margin: 6px 0 14px;
	}
	.src {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-border);
		padding-top: 11px;
	}
	.pick {
		color: var(--color-text-muted);
		padding: 20px 22px;
	}

	/* ---- monster stat block (C layout) ---- */
	.meyebrow {
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
	.meyebrow .mtype {
		color: var(--color-accent-bright);
	}
	.c-cols {
		display: grid;
		grid-template-columns: 1fr 1.2fr;
		gap: 12px;
		margin-bottom: 12px;
	}
	.mpanel {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 11px;
		padding: 11px 14px;
	}
	.mph {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 6px;
	}
	.vrow {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		padding: 5px 0;
		border-top: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.vrow:first-of-type {
		border-top: 0;
	}
	.vrow .vk {
		color: var(--color-text-muted);
	}
	.vrow .dim {
		color: var(--color-text-muted);
	}
	.vrow.cr {
		padding: 2px 0 6px;
	}
	.vrow.cr .vk {
		align-self: center;
	}
	.vrow.cr .crv {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 26px;
		color: var(--color-accent-bright);
	}
	.hpdice {
		border: 0;
		background: transparent;
		color: var(--color-accent-bright);
		cursor: pointer;
		font-size: 12px;
		padding: 0 0 0 2px;
	}
	.arow {
		display: grid;
		grid-template-columns: 42px 1fr 1fr;
		gap: 6px;
		padding: 4px 0;
		border-top: 1px solid var(--color-border);
		align-items: baseline;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.arow.has-save {
		grid-template-columns: 42px 1fr 1fr 1fr;
	}
	.arow:first-of-type {
		border-top: 0;
	}
	.arow.head {
		color: var(--color-text-muted);
		font-size: 10px;
	}
	.arow .ab-n {
		color: var(--color-accent-bright);
		font-family: var(--font-display);
		font-weight: 600;
	}
	.arow .asv {
		color: var(--color-good);
	}
	.band {
		border: 1px solid var(--color-border);
		border-radius: 11px;
		padding: 2px 14px;
		margin-bottom: 4px;
	}
	.brow {
		display: flex;
		gap: 12px;
		padding: 6px 0;
		border-top: 1px solid var(--color-border);
		font-size: 13px;
	}
	.brow:first-child {
		border-top: 0;
	}
	.brow .bk {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		min-width: 96px;
		flex: none;
		padding-top: 2px;
	}
	.brow .bv {
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.brow.def .bv {
		color: var(--color-accent-bright);
	}
	@media (max-width: 560px) {
		.c-cols {
			grid-template-columns: 1fr;
		}
	}

	/* ---- spell article ("strip" layout) ---- */
	.stitle {
		display: flex;
		align-items: center;
		gap: 11px;
		margin: 4px 0 14px;
	}
	.stitle h1 {
		margin: 0;
	}
	.schip {
		font-family: var(--font-mono);
		font-size: 10px;
		border-radius: 5px;
		padding: 2px 7px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.schip.hit {
		color: var(--color-resource);
		border-color: #5a4d28;
	}
	.schip.save {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.schip.auto {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.schip.util {
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
	.fx {
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
	.fxbig {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 28px;
		line-height: 1;
	}
	.fx.save .fxbig {
		color: var(--color-accent-bright);
	}
	.fx.hit .fxbig {
		color: var(--color-resource);
	}
	.fx.auto .fxbig {
		color: var(--color-good);
	}
	.fxbig.none {
		color: var(--color-text-muted);
		font-size: 18px;
	}
	.fxsub {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.fxrolls {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 5px;
	}
	.fxroll {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		padding: 3px 10px;
		cursor: pointer;
		background: transparent;
	}
	.fxroll:hover {
		background: var(--color-accent-soft);
	}
	.scells {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		align-content: start;
	}
	.scell {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 7px 11px;
	}
	.scell.span {
		grid-column: span 2;
	}
	.scell .sk {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.scell .sv {
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
</style>
