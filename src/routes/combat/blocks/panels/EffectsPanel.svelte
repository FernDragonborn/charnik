<script lang="ts">
	// Effects panel body: active effects grouped into Buffs / Debuffs / Resources (each row shows its
	// mechanical tags, a duration dropdown + remove), then read-only sections for item/feature-derived
	// contributions, unrecognized tokens, and L3 plugin notes. Owns the duration-menu / info-expand
	// local state and the per-effect row snippet.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import ArticleProse from '$lib/components/ArticleProse.svelte';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../../combat-view-model.svelte';
	import {
		effectTagResolved,
		describeDerivedEffects,
		noteText,
		conditionIdOf,
		groupEffects,
		rechargeLabel,
		remainingRounds,
		range,
		type EffectInstance,
	} from '$lib/combat/helpers';
	import { sayText } from '$lib/util/say';
	import EffectDurationMenu from '../EffectDurationMenu.svelte';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();

	// past this many pips, render a numeric counter instead of a wall of dots — also caps the
	// render cost so an unbounded/garbage homebrew `max` can't OOM the view (B10).
	const PIP_CAP = 20;

	// effects grouped into Buffs / Debuffs / Resources sections
	const effectGroups = $derived(groupEffects(c.play.effects));
	/** Which section renders first — only that one drops the divider above it. */
	const firstKind = $derived.by(() => {
		if (effectGroups.buffs.length) return 'buffs';
		return effectGroups.debuffs.length ? 'debuffs' : 'resources';
	});
	// the open duration dropdown (which effect + its anchor button); its rounds tracked live
	let durationMenu = $state<{ iid: string; anchor: HTMLElement } | null>(null);
	// the condition effect whose rules text is expanded (the G2 info channel), by iid; single-open
	let infoOpen = $state<string | null>(null);
	const menuEffect = $derived(
		durationMenu ? c.play.effects.find((e) => e.iid === durationMenu?.iid) : undefined,
	);
	// the menu prefills / the chip shows REMAINING rounds at the live round counter, not the total
	const menuRounds = $derived(menuEffect ? remainingRounds(menuEffect, combat.round) : null);
	const durationLabel = (rounds: number | null | undefined) =>
		rounds != null ? $_('combat.effects.roundsLeft', { values: { rounds } }) : '∞';
	// item/feature-derived contributions + unknown/plugin notes (read-only, from sheet.facts)
	const derivedEffects = $derived(describeDerivedEffects(s.facts, $_));
</script>

<!-- one Buffs/Debuffs effect row: name (white) + wrapping tags, then the duration dropdown + remove -->
{#snippet effectRow(e: EffectInstance, polarity: 'positive' | 'negative')}
	{@const condId = conditionIdOf(e)}
	<!-- every effect that HAS something to say carries the ⓘ, not only a condition: a spell's buff
	     opens the spell's own text, a custom one opens what the player typed. -->
	{@const infoText = combat.effects.effectProse(e)}
	<!-- a condition instance only carries `apply_condition:<id>`; show what the condition DOES by
	     rendering the condition row's own tokens (mechanical tags + display-only notes) instead -->
	{@const tags = condId ? combat.effects.conditionTokens(condId) : e.effects}
	{@const isConc = !!e.source && c.play.concentration === e.source}
	<div class="effect-row">
		<div class="effect-main">
			<span class="effect-name">{e.label}</span>
			{#if isConc}
				<!-- CONCENTRATION-PLAN §4: the concentration carrier (often token-less: Hold Person, Web)
				     reads as a "Concentration" marker, not a blank buff. Tap to drop it. -->
				<button
					class="conc-badge"
					title={$_('combat.effects.concentrating')}
					onclick={combat.clearConcentration}
					><Icon name="target" size={13} /> {$_('combat.effects.concentration')}</button
				>
			{/if}
			{#each tags as tok (tok)}
				{@const note = noteText(tok)}
				{#if note}
					<span class="effect-tag effect-tag--note" title={$_('combat.effects.referenceOnly')}
						>ⓘ {note}</span
					>
				{:else}
					<span class="effect-tag effect-tag--{polarity}"
						>{effectTagResolved(tok, s.facts, $_)}</span
					>
				{/if}
			{/each}
		</div>
		<span class="effect-ctrl">
			{#if infoText}
				<button
					class="icon-button effect-info-btn"
					class:on={infoOpen === e.iid}
					title={$_('combat.effects.rulesText')}
					aria-expanded={infoOpen === e.iid}
					onclick={() => (infoOpen = infoOpen === e.iid ? null : e.iid)}>ⓘ</button
				>
			{/if}
			<button
				class="duration-select"
				title={$_('combat.effects.setDuration')}
				onclick={(ev) => (durationMenu = { iid: e.iid, anchor: ev.currentTarget })}
				>{durationLabel(remainingRounds(e, combat.round))}
				<Icon name="chevron-down" size={12} /></button
			>
			<button
				class="icon-button effect-remove"
				title={$_('combat.effects.remove')}
				onclick={() => combat.effects.removeEffect(e.iid)}
				><Icon name="x" size={13} label={$_('combat.effects.remove')} /></button
			>
		</span>
	</div>
	{#if infoText && infoOpen === e.iid}
		<!-- reference prose is user-owned CSV: reuse ArticleProse so it renders Markdown/HTML through
		     the same sanitize pipeline + styling as the compendium (UBUG-7) -->
		<div class="effect-info-text"><ArticleProse bodyMarkdown={infoText} /></div>
	{/if}
{/snippet}

{#if !c.play.effects.length && !derivedEffects.groups.length && !derivedEffects.unknown.length && !s.facts.pluginNotes.length}
	<p class="trace">{$_('combat.effects.none')}</p>
{:else}
	{#if effectGroups.buffs.length}
		<div class="effect-section" class:effect-section--first={firstKind === 'buffs'}>
			<div class="section-head section-head--buff">
				<svg
					width="14"
					height="14"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M10 2.5 L16 5 V10 C16 14 13 16.6 10 18 C7 16.6 4 14 4 10 V5 Z" /><path
						d="M10 7 V12 M7.5 9.5 H12.5"
						stroke-linecap="round"
					/></svg
				>
				{$_('combat.effects.buffs')}
				<span class="section-count">· {effectGroups.buffs.length}</span>
			</div>
			{#each effectGroups.buffs as e (e.iid)}{@render effectRow(e, 'positive')}{/each}
		</div>
	{/if}
	{#if effectGroups.debuffs.length}
		<div class="effect-section" class:effect-section--first={firstKind === 'debuffs'}>
			<div class="section-head section-head--debuff">
				<svg
					width="14"
					height="14"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M10 2.5 L16 5 V10 C16 14 13 16.6 10 18 C7 16.6 4 14 4 10 V5 Z" /><path
						d="M10.5 4.5 L8.5 9 L11 10.5 L9.2 15.5"
						stroke-linecap="round"
					/></svg
				>
				{$_('combat.effects.debuffs')}
				<span class="section-count">· {effectGroups.debuffs.length}</span>
			</div>
			{#each effectGroups.debuffs as e (e.iid)}{@render effectRow(e, 'negative')}{/each}
		</div>
	{/if}
	{#if effectGroups.resources.length}
		<div class="effect-section" class:effect-section--first={firstKind === 'resources'}>
			<div class="section-head section-head--resource">
				<svg
					width="14"
					height="14"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linejoin="round"
					aria-hidden="true"
					><rect x="3" y="6" width="12" height="8" rx="2" /><path
						d="M17 9 V11"
						stroke-linecap="round"
					/><path d="M6 10 H9" stroke-linecap="round" /></svg
				>
				{$_('combat.effects.resources')}
				<span class="section-count">· {effectGroups.resources.length}</span>
			</div>
			{#each effectGroups.resources as r (r.iid)}
				{@const spent = combat.resources.resourceSpent(r.id)}
				<!-- the NAME is the "use one" action (UBUG-8), the resource analogue of casting a spell
				     row; the pips beside it set the count manually (restore / arbitrary) and the ✕ drops
				     the pool. Three real buttons side by side rather than one row-button with spans
				     inside it: interactive content nested in a `<button>` is invalid, and it is why the
				     row swallowed the tab stops of everything it contained — so a resource-borne effect
				     could be added and not removed without a mouse. -->
				<div class="resource-row">
					<button
						class="resource-use"
						title={$_('combat.resource.useOne', { values: { name: r.name } })}
						onclick={() => combat.useResourceOrEnter(r.id, r.max)}
					>
						<span class="resource-name">{r.name}</span>
					</button>
					{#if Number.isFinite(r.max) && r.max <= PIP_CAP}
						<span class="resource-pips">
							{#each range(r.max) as i (i)}
								<button
									class="resource-pip"
									class:off={i >= r.max - spent}
									title="{r.name} {i + 1}"
									aria-label="{r.name} {i + 1}"
									onclick={() => combat.resources.resourceClick(r.id, r.max, i)}
								></button>
							{/each}
						</span>
						<span class="resource-count">{r.max - spent}/{r.max}</span>
					{:else if Number.isFinite(r.max)}
						<!-- too many to draw as pips (B10): numeric counter only -->
						<span class="resource-count">{r.max - spent}/{r.max}</span>
					{:else}
						<!-- unlimited pool (`inf` max): no pips, count = uses since recharge -->
						<span class="resource-count">{spent} · ∞</span>
					{/if}
					<span class="recharge-chip">{sayText(rechargeLabel(r.recharge), $_)}</span>
					<button
						class="icon-button effect-remove"
						title={$_('combat.effects.remove')}
						onclick={() => combat.effects.removeEffect(r.iid)}
						><Icon name="x" size={12} label={$_('combat.effects.remove')} /></button
					>
				</div>
			{/each}
		</div>
	{/if}
	{#if derivedEffects.groups.length}
		<!-- B14: content-borne item/feature contributions — read-only (they follow equip/feature
		     state, not user CRUD), read from sheet.facts (D7), never re-parsed here. -->
		<div class="effect-section">
			<div class="section-head">{$_('combat.effects.fromItems')}</div>
			{#each derivedEffects.groups as g (g.source)}
				<div class="derived-effect-row">
					<span class="row-name">{g.source}</span>
					<span class="derived-tags">
						{#each g.tags as tag, i (i)}<span class="effect-tag">{tag}</span>{/each}
					</span>
				</div>
			{/each}
		</div>
	{/if}
	{#if derivedEffects.unknown.length}
		<!-- unknown/unsupported tokens — surfaced as distinctly-styled inert notes (never dropped) -->
		<div class="effect-section">
			<div class="section-head">{$_('combat.effects.unrecognized')}</div>
			{#each derivedEffects.unknown as u, i (i)}
				<p class="trace"><b>{u.source}</b> — <code>{u.token}</code></p>
			{/each}
		</div>
	{/if}
	{#if s.facts.pluginNotes.length}
		<!-- L3 plugin notes (plugins.md §4.3) — PLAIN TEXT only (PLG-SEC 3), attributed to
		     the carrying effect · plugin namespace, styled like the display-only rules notes -->
		<div class="effect-section">
			<div class="section-head">
				<Icon name="settings" size={13} />
				{$_('combat.effects.pluginNotes')}
			</div>
			{#each s.facts.pluginNotes as n, i (i)}
				<p class="plugin-note"><b>{n.source}</b> — {n.text}</p>
			{/each}
		</div>
	{/if}
{/if}

{#if durationMenu}
	<EffectDurationMenu
		iid={durationMenu.iid}
		rounds={menuRounds}
		anchor={durationMenu.anchor}
		onclose={() => (durationMenu = null)}
	/>
{/if}

<style>
	/* --- effects panel: Buffs / Debuffs / Resources sections (see effects-block-SPEC.md) --- */
	.section-head {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		padding: var(--space-3) 0 var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
	}
	.section-head svg {
		flex: none;
	}
	.section-head--buff {
		color: var(--color-good);
	}
	.section-head--debuff {
		color: var(--color-accent-bright);
	}
	.section-head--resource {
		color: var(--color-resource);
	}
	.section-head .section-count {
		color: var(--color-text-muted);
	}
	.effect-row {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-1-5) 0;
		border-top: 1px solid var(--color-border);
		align-items: flex-start;
	}
	/* the very first row of the very first section has no divider above it */
	.effect-section--first .effect-row:first-of-type,
	.effect-section--first .resource-row:first-of-type {
		border-top: 0;
	}
	.effect-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5) var(--space-2);
	}
	.effect-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	.effect-ctrl {
		display: flex;
		gap: var(--space-2);
		flex: none;
	}
	/* tag pill — pos/neg share the box (identical height); modifier names avoid the row `.r` collision */
	/* B14: derived (item/feature) contributions row — name left, mechanical tags wrapping right */
	.derived-effect-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-1);
	}
	.derived-effect-row .row-name {
		flex: none;
	}
	.derived-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		justify-content: flex-end;
		flex: 1;
	}
	.effect-tag {
		display: inline-flex;
		align-items: center;
		line-height: 1.35;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1-5);
		color: var(--color-text-muted);
		white-space: nowrap;
		flex: none;
	}
	/* concentration marker on the carrier row — a tappable badge (accent-tinted) that reads as
	   "this is your concentration" even when the carrier has no mechanical tags */
	.conc-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-accent-bright);
		border: 1px solid var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1-5);
		cursor: pointer;
		white-space: nowrap;
	}
	.conc-badge:hover {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}
	.effect-tag--positive {
		color: var(--color-good);
		border-color: color-mix(in srgb, var(--color-good) 40%, transparent);
		background: color-mix(in srgb, var(--color-good) 8%, transparent);
	}
	.effect-tag--negative {
		color: var(--color-accent-bright);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}
	/* display-only rules note (not engine-computed) — dashed + muted so it reads as reference, and
	   allowed to wrap since it carries a sentence, not a short tag */
	.effect-tag--note {
		color: var(--color-text-muted);
		border-style: dashed;
		border-color: var(--color-border-strong);
		background: transparent;
		font-family: var(--font-body);
		white-space: normal;
		font-style: italic;
	}
	/* duration dropdown control (closed) */
	.duration-select {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-resource);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		padding: var(--space-1) var(--space-1-5);
		cursor: pointer;
		white-space: nowrap;
		flex: none;
		background: transparent;
	}
	.effect-remove:hover {
		color: var(--color-accent-bright);
	}
	.effect-info-btn {
		color: var(--color-text-muted);
	}
	.effect-info-btn:hover,
	.effect-info-btn.on {
		color: var(--color-resource);
	}
	/* the expanded condition rules text (G2 info channel) — reference prose under the row */
	.effect-info-text {
		margin: 0 0 var(--space-1-5);
		padding: var(--space-1-5) var(--space-2);
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
	}
	/* ArticleProse's .body trails a bottom margin on its last block — collapse it inside the chip */
	.effect-info-text :global(.body > :last-child) {
		margin-bottom: 0;
	}
	/* a plugin handler's explanatory note — same reference styling family as the info text */
	.plugin-note {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-xs);
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	.plugin-note b {
		color: var(--color-text);
		font-weight: 600;
	}
	/* resource row: the NAME is the "use one" button (UBUG-8) and it fills the row, so the row still
	   reads as one clickable thing and highlights on hover like a spell / action row; margin bleed
	   makes the tint span full width. */
	.resource-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1-5) var(--space-2);
		margin: 0 calc(-1 * var(--space-2));
		width: calc(100% + 18px);
		border-top: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
	}
	.resource-row:hover {
		background: var(--color-surface-2);
	}
	.resource-use {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		text-align: start;
		cursor: pointer;
	}
	.resource-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--color-text);
		flex: 1;
	}
	.resource-pips {
		display: inline-flex;
		gap: var(--space-1);
	}
	.resource-pip {
		display: inline-block;
		position: relative;
		width: 11px;
		height: 11px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--color-resource);
		background: var(--color-resource);
		cursor: pointer;
	}
	/* a pip is 11px, which is smaller than any pointer target should be — the inset grows the hit area
	   without moving the dot (ui.md ▸ Every interactive element says so) */
	.resource-pip::before {
		content: '';
		position: absolute;
		inset: -4px;
	}
	.resource-pip.off {
		background: transparent;
		border-color: var(--color-border-strong);
	}
	.resource-count {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		min-width: 26px;
	}
	.recharge-chip {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-resource);
		border: 1px solid var(--color-resource-line);
		background: color-mix(in srgb, var(--color-resource) 8%, transparent);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1-5);
		white-space: nowrap;
	}
</style>
