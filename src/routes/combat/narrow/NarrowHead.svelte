<script lang="ts">
	// The character in one block, for a desktop window dragged small (`work/play-layout.md` ▸
	// NARROW-DESKTOP, `design-preview/narrow-desktop-variants.html`): who, how hurt, the three numbers
	// and what is on them. Each opens what stood around it on the wide screen — the name its title line
	// (D11), the hit points the damage, healing and exhaustion (D5), the armour class what it is made of
	// and the defenses (D10) — so the block stays one block.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { provenance } from '#lib/actions/provenance.ts';
	import type { Character } from '#lib/character/schema.ts';
	import type { CharacterSheet } from '#lib/character/derive.ts';
	import { saveCharacterToStore } from '#lib/character/store.svelte.ts';
	import { localizedName } from '#lib/content/detail.ts';
	import { signed, why } from '#lib/combat/helpers.ts';
	import { contributionText } from '#lib/combat/effects-view.ts';
	import { shownTrace } from '#lib/combat/shown-trace.ts';
	import { metres } from '#lib/util/format.ts';
	import { systemShortLabel } from '#lib/rules/pipeline.ts';
	import { app } from '#lib/stores/app.svelte.ts';
	import { _ } from '#lib/i18n/index.ts';
	import DefenseStrip from '#lib/components/DefenseStrip.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { combat } from '../combat-view-model.svelte';
	import HpPanel from '../blocks/HpPanel/HpPanel.svelte';
	import Exhaustion from '../blocks/Exhaustion.svelte';
	import HeadPopover from './HeadPopover.svelte';
	import HitLine from '../blocks/HpPanel/HitLine.svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { THREE_COLUMNS_QUERY } from '#lib/config/narrow-window.ts';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();

	const OPEN = { title: 'title', hp: 'hp', ac: 'ac' } as const;
	type Open = (typeof OPEN)[keyof typeof OPEN];
	let open = $state<{ what: Open; anchor: HTMLElement } | null>(null);
	const toggle = (what: Open, e: MouseEvent) => {
		const anchor = e.currentTarget;
		if (!(anchor instanceof HTMLElement)) return;
		open = open?.what === what ? null : { what, anchor };
	};
	const close = () => (open = null);

	const hp = $derived(c.play.hp);
	/** At 0 hit points, or dead: the hit-point popover is the whole block with its saves. */
	const down = $derived(hp.current <= 0 || !!c.play.death);
	const exhaustionMax = $derived(combat.effects.exhaustionMax);
	const roomForTheField = new MediaQuery(THREE_COLUMNS_QUERY);
	const max = $derived(s.maxHp.value);
	const xp = $derived(combat.experience.progress);
	const backgroundName = $derived.by(() => {
		const row = c.build.background ? combat.graph?.get(c.build.background) : undefined;
		return row ? localizedName(row, app.activeLocale) : '';
	});
	const ofMax = (n: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, max)) * 100))}%`;
</script>

<section class="narrow-head" data-region>
	<div class="headline">
		<button
			class="who"
			class:open={open?.what === OPEN.title}
			aria-expanded={open?.what === OPEN.title}
			onclick={(e) => toggle(OPEN.title, e)}
		>
			<span class="who-classes">{combat.className}</span>
			<b class="who-name">{c.build.name}<Icon name="chevron-down" size={13} /></b>
		</button>

		<button
			class="hp"
			class:open={open?.what === OPEN.hp}
			aria-expanded={open?.what === OPEN.hp}
			aria-label={$_('combat.hp.hitPoints')}
			onclick={(e) => toggle(OPEN.hp, e)}
		>
			<span class="hp-num"
				>{hp.current} <small>/ {max}</small>{#if hp.temp}<em>+{hp.temp}</em>{/if}</span
			>
			<span class="hp-bar" aria-hidden="true"
				><i style="width: {ofMax(hp.current)}"></i><u style="width: {ofMax(hp.temp)}"></u></span
			>
		</button>

		{#if roomForTheField.current && !down}
			<!-- D6: at half the screen the hit has room to stand open in the block itself -->
			<div class="hp-inline">
				<HitLine />
				<button
					type="button"
					class="hp-heal"
					aria-label={$_('combat.hp.healOrTemp')}
					use:provenance={$_('combat.hp.healOrTemp')}
					onclick={(event) => combat.openMenu('restore', event)}
					><Icon name="plus" size={13} /></button
				>
			</div>
		{/if}

		<div class="stats">
			<button
				class="stat"
				class:open={open?.what === OPEN.ac}
				aria-expanded={open?.what === OPEN.ac}
				use:provenance={why(s.ac, $_)}
				onclick={(e) => toggle(OPEN.ac, e)}
				><b>{s.ac.value}</b><span>{$_('combat.narrow.ac')}</span></button
			>
			<button
				class="stat"
				use:provenance={why(s.initiative, $_)}
				onclick={(e) =>
					combat.roll(
						{ text: 'Initiative', key: 'combat.roll.initiative' },
						s.initiative.value,
						e,
						'initiative',
					)}
				><b>{signed(s.initiative.value)}</b><span>{$_('combat.narrow.initiative')}</span></button
			>
			<span class="stat" use:provenance={why(s.speed, $_)}
				><b>{s.speed.value} ft</b><span>{$_('combat.narrow.speed')}</span></span
			>
		</div>
	</div>
	<!-- what is on the character, one chip each — concentration first, with its way out — and the way
	     in last, so the row never disappears (the mock's chips line) -->
	<div class="chips">
		{#if combat.conc}
			{@const conc = combat.conc}
			<span class="chip conc"
				><Icon name="target" size={11} />{conc.label}<button
					class="chip-x"
					onclick={combat.endConcentrationByHand}
					aria-label={$_('combat.hp.endConcentration', { values: { spell: conc.label } })}
					use:provenance={$_('combat.hp.endConcentration', { values: { spell: conc.label } })}
					><Icon name="x" size={10} /></button
				></span
			>
		{/if}
		{#if c.play.exhaustion > 0}
			<span class="chip bad"
				>{$_('combat.exhaustion.reading', {
					values: { level: c.play.exhaustion, max: exhaustionMax },
				})}</span
			>
		{/if}
		{#each c.play.effects as effect (effect.iid)}
			<span class="chip" class:good={effect.positive} class:bad={!effect.positive}
				>{effect.label}</span
			>
		{/each}
		<button
			class="chip add"
			aria-label={$_('combat.narrow.addEffect')}
			use:provenance={$_('combat.narrow.addEffect')}
			onclick={(e) => combat.openMenu('addstate', e)}><Icon name="plus" size={11} /></button
		>
	</div>
</section>

{#if open?.what === OPEN.title}
	<HeadPopover anchor={open.anchor} label={c.build.name} onclose={close}>
		<dl class="facts">
			<dt>{$_('combat.hero.level')}</dt>
			<dd>
				{#if combat.canLevelUp}
					<button
						class="pill-btn"
						onclick={async () => {
							await saveCharacterToStore(c);
							void goto(resolve(`build?levelup=${c.id}`));
						}}
						>{s.level} · {$_(xp?.levelDue ? 'combat.hero.levelEarned' : 'combat.hero.levelUpTo', {
							values: { level: s.level + 1 },
						})}</button
					>
				{:else}{s.level}{/if}
			</dd>
			<dt>{$_('combat.hero.proficiency')}</dt>
			<dd>{signed(s.proficiencyBonus)}</dd>
			{#if combat.speciesName}<dt>{$_('combat.narrow.species')}</dt>
				<dd>{combat.speciesName}</dd>{/if}
			{#if backgroundName}<dt>{$_('combat.narrow.background')}</dt>
				<dd>{backgroundName}</dd>{/if}
			<dt>{$_('combat.narrow.rules')}</dt>
			<dd>{systemShortLabel(c.system)}</dd>
			<dt>{$_('combat.narrow.advancement')}</dt>
			<dd>
				<button class="pill-btn" onclick={(e) => combat.openMenu('experience', e)}
					>{xp ? `${$_('combat.hero.xp')} ${xp.xp}` : $_('combat.hero.milestone')}</button
				>
			</dd>
		</dl>
	</HeadPopover>
{:else if open?.what === OPEN.hp}
	<HeadPopover anchor={open.anchor} label={$_('combat.hp.hitPoints')} onclose={close}>
		{#if down}
			<!-- at 0 hit points the block is the wide screen's whole one: its saves, its roll, its motion
			     (AT-ZERO-HP redraws it) -->
			<div class="hp-pop"><HpPanel {c} {s} /><Exhaustion {c} /></div>
		{:else}
			<!-- D5: the hit on one line — amount, type, the red press — healing and temporary hit points
			     behind the green one, and exhaustion as a stepper -->
			<div class="hp-quick">
				<HitLine />
				<button type="button" class="hp-heal" onclick={(event) => combat.openMenu('restore', event)}
					><Icon name="plus" size={13} />{$_('combat.hp.healOrTemp')}</button
				>
				{#if exhaustionMax > 0}
					<div class="hp-exhaustion">
						<span>{$_('combat.exhaustion.title')} <b>{c.play.exhaustion}</b> / {exhaustionMax}</span
						>
						<button
							class="icon-button"
							aria-label={$_('combat.exhaustion.decrease')}
							disabled={c.play.exhaustion <= 0}
							onclick={() => combat.effects.setExhaustion(c.play.exhaustion - 1)}
							><Icon name="minus" size={13} /></button
						>
						<button
							class="icon-button"
							aria-label={$_('combat.exhaustion.increase')}
							disabled={c.play.exhaustion >= exhaustionMax}
							onclick={() => combat.effects.setExhaustion(c.play.exhaustion + 1)}
							><Icon name="plus" size={13} /></button
						>
					</div>
				{/if}
			</div>
		{/if}
	</HeadPopover>
{:else if open?.what === OPEN.ac}
	<HeadPopover anchor={open.anchor} label={$_('combat.narrow.ac')} onclose={close}>
		<p class="ac-total">{$_('combat.section.armorClass')} <b>{s.ac.value}</b></p>
		<!-- the parts a reader adds up, as the wide screen's tile prints them -->
		<ul class="ac-parts">
			{#each shownTrace(s.ac) as part, index (index)}<li>{contributionText(part, $_)}</li>{/each}
		</ul>
		<DefenseStrip sheet={s} graph={combat.graph} system={c.system} />
		<p class="ac-speed">{$_('combat.narrow.speed')} {s.speed.value} ft ({metres(s.speed.value)})</p>
	</HeadPopover>
{/if}

<style>
	.narrow-head {
		container-type: inline-size;
		flex: none;
		padding: var(--space-3) var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	.headline {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.who,
	.hp,
	.stat {
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius);
		color: var(--color-text);
		text-align: start;
		cursor: pointer;
	}
	.who {
		flex: 1;
		min-width: 0;
		padding: var(--space-1);
	}
	.who-classes {
		display: block;
		color: var(--color-accent-bright);
		font-size: var(--font-size-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.who-name {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-family: var(--font-display);
		font-size: var(--font-size-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hp {
		flex: none;
		width: 8rem;
		padding: var(--space-1) var(--space-2);
	}
	.open {
		border-color: var(--color-border-strong);
		background: var(--color-surface-2);
	}
	.hp-num {
		display: block;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		white-space: nowrap;
	}
	.hp-num small {
		font-weight: 400;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.hp-num em {
		font-style: normal;
		font-size: var(--font-size-xs);
		color: var(--color-good);
		margin-inline-start: var(--space-1);
	}
	.hp-bar {
		display: flex;
		height: 5px;
		margin-top: var(--space-1-5);
		border-radius: var(--radius-full);
		background: var(--color-bg);
		overflow: hidden;
	}
	.hp-bar i {
		background: var(--color-accent);
	}
	.hp-bar u {
		background: var(--color-good);
	}
	.stats {
		display: flex;
		flex: none;
		gap: var(--space-1);
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: var(--space-1) var(--space-1-5);
	}
	.stat b {
		font-family: var(--font-display);
		font-size: var(--font-size-lg);
		white-space: nowrap;
	}
	.stat span {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 1px var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		white-space: nowrap;
	}
	.chip.conc,
	.chip.bad {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.chip.conc {
		background: var(--color-accent-soft);
	}
	.chip.good {
		color: var(--color-good);
		border-color: var(--color-good-line);
	}
	.chip.add {
		border-style: dashed;
		cursor: pointer;
	}
	.chip-x {
		display: inline-grid;
		place-items: center;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1-5) var(--space-3);
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.facts dt {
		color: var(--color-text-muted);
	}
	.facts dd {
		margin: 0;
	}
	.hp-quick {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 15rem;
	}
	.hp-heal {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-1-5) var(--space-2-5);
		border: 1px solid var(--color-good);
		border-radius: var(--radius-full);
		background: var(--color-good-soft);
		color: var(--color-good);
		font-weight: 600;
		cursor: pointer;
	}
	.hp-inline {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		flex: 0 1 15rem;
		min-width: 0;
	}
	.hp-exhaustion {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.hp-exhaustion span {
		margin-inline-end: auto;
	}
	.hp-pop {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.ac-total {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-sm);
	}
	.ac-parts {
		margin: 0 0 var(--space-2);
		padding: 0;
		list-style: none;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.ac-speed {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	/* a phone (P1): the name takes its own line and the numbers share the one under it */
	@container (max-width: 420px) {
		.headline {
			flex-wrap: wrap;
		}
		.who {
			flex-basis: 100%;
		}
		.hp {
			flex: 1;
		}
	}
</style>
