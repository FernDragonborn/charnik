<script lang="ts">
	// One draggable card in the combat panel grid. `pid` selects which panel it renders — skills /
	// attacks / actions / effects / spells — sharing a common collapsible head (title + per-panel
	// toolbar button + drag handle). Reads the `combat` view-model; character + sheet come in as
	// props. The dnd grid that hosts these cards stays in the page.
	import { base } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { SKILL_ABILITY, type SkillId } from '$lib/character/derive';
	import type { Character } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { combat } from '../state.svelte';
	import {
		why,
		signed,
		titleCase,
		effectTag,
		groupEffects,
		rechargeLabel,
		remainingRounds,
		range,
		type EffectInstance,
		ABIL,
		ABILITY_NAME,
		PANEL_TITLE
	} from '$lib/combat/helpers';
	import EffectDurationMenu from './EffectDurationMenu.svelte';

	let { pid, c, s }: { pid: string; c: Character; s: CharacterSheet } = $props();

	// effects grouped into Buffs / Debuffs / Resources sections
	const effectGroups = $derived(groupEffects(c.play.effects));
	// the open duration dropdown (which effect + its anchor button); its rounds tracked live
	let durationMenu = $state<{ iid: string; anchor: HTMLElement } | null>(null);
	const menuEffect = $derived(
		durationMenu ? c.play.effects.find((e) => e.iid === durationMenu?.iid) : undefined
	);
	// the menu prefills / the chip shows REMAINING rounds at the live round counter, not the total
	const menuRounds = $derived(menuEffect ? remainingRounds(menuEffect, combat.round) : null);
	const durationLabel = (rounds: number | null | undefined) =>
		rounds != null ? `${rounds} rds` : '∞';

	const collapsed = $derived(combat.layout.collapsed);
	const attacks = $derived(combat.attacks);
	const visibleActions = $derived(combat.visibleActions);
	const spellGroups = $derived(combat.spellGroups);
	const preparedCount = $derived(combat.preparedCount);
	const preparedCap = $derived(combat.preparedCap);
	const groupByLabel = $derived(combat.groupByLabel);
	const pinned = $derived(combat.pinned);
	const { openMenu, roll, cast, cycleGroupBy, togglePrepared } = combat;
	const { toggle } = combat.layout;
	const { slotClick } = combat.resources;
</script>

<!-- one Buffs/Debuffs effect row: name (white) + wrapping tags, then the duration dropdown + remove -->
{#snippet effectRow(e: EffectInstance, polarity: 'positive' | 'negative')}
	<div class="effect-row">
		<div class="effect-main">
			<span class="effect-name">{e.label}</span>
			{#each e.effects as tok (tok)}
				<span class="effect-tag effect-tag--{polarity}">{effectTag(tok)}</span>
			{/each}
		</div>
		<span class="effect-ctrl">
			<button
				class="duration-select"
				title="Set duration"
				onclick={(ev) => (durationMenu = { iid: e.iid, anchor: ev.currentTarget })}
				>{durationLabel(remainingRounds(e, combat.round))} ▾</button
			>
			<button
				class="icon-button effect-remove"
				title="Remove effect"
				onclick={() => combat.removeEffect(e.iid)}>✕</button
			>
		</span>
	</div>
{/snippet}

<div class="panel-head">
	<button class="htoggle" onclick={() => toggle(pid)}>
		<span class="chevron">{collapsed[pid] ? '▸' : '▾'}</span>{PANEL_TITLE[pid]}
	</button>
	{#if pid === 'actions'}
		<button class="pill-btn" onclick={(e) => openMenu('showhide', e)}>👁 Show / hide</button>
	{:else if pid === 'effects'}
		<button class="pill-btn" onclick={(e) => openMenu('addeffect', e)}>＋ Add effect</button>
	{:else if pid === 'spells' && s.spellcasting.classes.length}
		<span class="prepared-count">Prepared <b>{preparedCount}</b> / {preparedCap}</span>
		<button class="pill-btn" onclick={cycleGroupBy} title="Change grouping">{groupByLabel} ▾</button
		>
		<a class="pill-btn" href="{base}/spellbook">⛭ Manage all</a>
	{/if}
	<span
		class="drag-handle"
		title="drag to reorder"
		onpointerdown={() => (combat.layout.dragDisabled = false)}>⠿</span
	>
</div>
{#if !collapsed[pid]}
	{#if pid === 'skills'}
		<div class="sklgrid">
			{#each ABIL as ab (ab)}
				{@const list = (Object.keys(SKILL_ABILITY) as SkillId[]).filter(
					(k) => SKILL_ABILITY[k] === ab
				)}
				{#if list.length}
					<div class="category-block">
						<div class="ability-heading">{ABILITY_NAME[ab]}</div>
						{#each list as skill (skill)}
							{@const sk = s.skills[skill]}
							{#if sk}
								<button
									class="skill-row"
									title={why(sk)}
									onclick={(e) => roll(titleCase(skill), sk.value, e, `skill.${skill}`)}
								>
									<i
										class="prof-dot"
										class:on={sk.prof !== 'none'}
										class:expertise={sk.prof === 'expertise'}
										title={sk.prof}
									></i>
									<span class="skill-name">{titleCase(skill)}</span>
									<b class="skill-mod">{signed(sk.value)}</b>
								</button>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}
		</div>
	{:else if pid === 'attacks'}
		{#each attacks as at (at.name)}
			<button class="combat-row" onclick={(e) => combat.attackRoll(at, e)}>
				<span class="row-name">{at.name}</span><span class="combat-row-hint"
					>{signed(at.toHit)}</span
				>
				<span class="combat-row-desc">{at.dmg}</span><span class="combat-row-marker">{at.meta}</span
				>
			</button>
		{/each}
	{:else if pid === 'actions'}
		{#each visibleActions as a (a.id)}
			<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
				<span class="row-name">{a.name}</span><span class="combat-row-hint">{a.hint || '—'}</span>
				<span class="combat-row-desc">{a.desc}</span><span class="combat-row-marker"
					>{a.marker}</span
				>
			</button>
		{/each}
	{:else if pid === 'effects'}
		{#if !c.play.effects.length}
			<p class="trace">No active effects.</p>
		{:else}
			{@const firstKind = effectGroups.buffs.length
				? 'buffs'
				: effectGroups.debuffs.length
					? 'debuffs'
					: 'resources'}
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
						Buffs <span class="sec-count">· {effectGroups.buffs.length}</span>
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
						Debuffs <span class="sec-count">· {effectGroups.debuffs.length}</span>
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
						Resources <span class="sec-count">· {effectGroups.resources.length}</span>
					</div>
					{#each effectGroups.resources as r (r.iid)}
						{@const spent = combat.resources.resourceSpent(r.id)}
						<div class="resource-row">
							<span class="resource-name">{r.name}</span>
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
							<span class="recharge-chip">{rechargeLabel(r.recharge)}</span>
							<button
								class="icon-button effect-remove"
								title="Remove effect"
								onclick={() => combat.removeEffect(r.iid)}>✕</button
							>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{:else if pid === 'spells' && s.spellcasting.classes.length}
		{@const multi = s.spellcasting.classes.length > 1}
		<div class="castline">
			{#each s.spellcasting.classes as sc, i (sc.className)}
				{#if i > 0}<span class="castsep"> · </span>{/if}
				{#if multi}<b class="castcls">{sc.className}</b>
				{/if}Save DC
				<b title={why(sc.saveDC)}>{sc.saveDC.value}</b> · attack
				<b>{signed(sc.attack.value)}</b>
			{/each}
			{#if !multi}
				— every spell{/if}
		</div>
		<div class="spell-rows">
			{#each spellGroups as g (g.key)}
				<div class="spgroup">
					<div class="spell-category" class:star={g.key === 'pinned'}>
						{g.label}
						{#if g.slots}{@const sl = g.slots}<span class="pips"
								>{#each Array(sl.full) as _, i (i)}<button
										class="slot-pip"
										class:full={i < sl.full - sl.spent}
										class:spent={i >= sl.full - sl.spent}
										title="tap to spend / restore"
										onclick={() => slotClick(g.key, sl.full, sl.spent, i)}
									></button>{/each}</span
							>{/if}
					</div>
					{#each g.rows as r (g.key + r.id)}
						<button class="spell-row" onclick={(e) => cast(r, e)}>
							<span class="row-name">
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<i
									class="prep"
									class:on={r.prep === 'on'}
									class:always={r.prep === 'always'}
									title={r.prep === 'always' ? 'always prepared' : 'tap to prepare / unprepare'}
									onclick={(e) => {
										e.stopPropagation();
										togglePrepared(r);
									}}
								></i>
								<span class="name-main">{r.name}</span>
								<span
									class="pinstar"
									class:on={pinned[r.id]}
									role="button"
									tabindex="-1"
									title="pin to top"
									onclick={(e) => {
										e.stopPropagation();
										pinned[r.id] = !pinned[r.id];
									}}>{pinned[r.id] ? '★' : '☆'}</span
								>
							</span>
							<span class="spell-summary">{r.spe}</span>
							{#if r.res}<span class="resolution-tag {r.res}">{r.resLabel}</span>{:else}<span
								></span>{/if}
							<span class="spell-level"
								>{#if r.ct}<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --><i
										class="cast-icon"
										title={r.ct === 'react' ? 'reaction' : 'bonus action'}
										onclick={(e) => {
											e.stopPropagation();
											toast(`Casting time: ${r.ct === 'react' ? 'reaction' : 'bonus action'}`);
										}}>{r.ct === 'react' ? '↩' : '⚡'}</i
									>{/if}{r.tm}</span
							>
						</button>
					{/each}
				</div>
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
	.sklgrid {
		column-count: 2;
		column-gap: 16px;
		column-rule: 1px solid var(--color-border);
	}
	.category-block {
		break-inside: avoid;
		margin-bottom: 7px;
	}
	.ability-heading {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 6px 0 3px;
	}
	.skill-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: 8px;
		break-inside: avoid;
		cursor: pointer;
		font-size: 13px;
		width: 100%;
		background: transparent;
		border: 0;
		color: var(--color-text);
		text-align: left;
	}
	.skill-row:hover {
		background: var(--color-surface-2);
	}
	.skill-row .prof-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		flex: none;
	}
	.skill-row .prof-dot.on {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
	/* expertise = a ringed dot (double proficiency) */
	.skill-row .prof-dot.expertise {
		box-shadow:
			0 0 0 2px var(--color-surface),
			0 0 0 3.5px var(--color-resource);
	}
	.skill-row .skill-name {
		flex: 1;
	}
	.skill-row .skill-mod {
		font-family: var(--font-display);
		font-weight: 700;
	}

	.combat-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1px 10px;
		padding: 8px 9px;
		margin: 0 -9px;
		border-radius: 9px;
		cursor: pointer;
		width: calc(100% + 18px);
		background: transparent;
		border: 0;
		color: var(--color-text);
		text-align: left;
	}
	.combat-row + .combat-row {
		box-shadow: 0 -1px 0 var(--color-border);
	}
	.combat-row:hover {
		background: var(--color-surface-2);
		box-shadow: none;
	}
	.combat-row .row-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.combat-row .combat-row-hint {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		color: var(--color-resource);
		justify-self: end;
	}
	.combat-row .combat-row-desc {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.combat-row .combat-row-marker {
		font-size: 11px;
		color: var(--color-text-muted);
		justify-self: end;
	}

	/* --- effects panel: Buffs / Debuffs / Resources sections (see effects-block-SPEC.md) --- */
	.section-head {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 12px 0 5px;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.13em;
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
	.section-head .sec-count {
		color: var(--color-text-muted);
	}
	.effect-row {
		display: flex;
		gap: 9px;
		padding: 7px 0;
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
		gap: 6px 8px;
	}
	.effect-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
		color: var(--color-text);
	}
	.effect-ctrl {
		display: flex;
		gap: 8px;
		flex: none;
	}
	/* tag pill — pos/neg share the box (identical height); modifier names avoid the row `.r` collision */
	.effect-tag {
		display: inline-flex;
		align-items: center;
		line-height: 1.35;
		font-family: var(--font-mono);
		font-size: 10px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: 5px;
		padding: 1px 6px;
		color: var(--color-text-muted);
		white-space: nowrap;
		flex: none;
	}
	.effect-tag--positive {
		color: var(--color-good);
		border-color: rgba(59, 184, 166, 0.4);
		background: rgba(59, 184, 166, 0.08);
	}
	.effect-tag--negative {
		color: var(--color-accent-bright);
		border-color: rgba(207, 43, 64, 0.45);
		background: rgba(207, 43, 64, 0.08);
	}
	/* duration dropdown control (closed) */
	.duration-select {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-resource);
		border: 1px solid var(--color-border-strong);
		border-radius: 7px;
		padding: 3px 7px;
		cursor: pointer;
		white-space: nowrap;
		flex: none;
		background: transparent;
	}
	.effect-remove:hover {
		color: var(--color-accent-bright);
	}
	/* resource row: pips + count + recharge chip */
	.resource-row {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 7px 0;
		border-top: 1px solid var(--color-border);
	}
	.resource-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
		color: var(--color-text);
		flex: 1;
	}
	.resource-pips {
		display: inline-flex;
		gap: 4px;
	}
	.resource-pip {
		width: 11px;
		height: 11px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--color-resource);
		background: var(--color-resource);
		cursor: pointer;
	}
	.resource-pip.off {
		background: transparent;
		border-color: var(--color-border-strong);
	}
	.resource-count {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
		min-width: 26px;
	}
	.recharge-chip {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-resource);
		border: 1px solid #5a4d28;
		background: rgba(202, 162, 74, 0.08);
		border-radius: 5px;
		padding: 1px 6px;
		white-space: nowrap;
	}

	.castline {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin: -2px 0 9px;
	}
	.castline b {
		color: var(--color-resource);
		font-family: var(--font-display);
		font-weight: 700;
	}
	.castline b.castcls {
		color: var(--color-accent-bright);
	}
	.castsep {
		color: var(--color-border-strong);
	}
	.spell-rows {
		margin-top: 2px;
	}
	.spell-category {
		display: flex;
		align-items: center;
		gap: 9px;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 11px 0 3px;
		break-inside: avoid;
	}
	.spell-category.star {
		color: var(--color-accent-bright);
	}
	.spell-category .pips {
		display: flex;
		gap: 5px;
	}
	.spell-category .slot-pip {
		width: 12px;
		height: 12px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid #2c4a45;
		cursor: pointer;
	}
	.spell-category .slot-pip.full {
		background: var(--color-good);
		border-color: var(--color-good);
		box-shadow: 0 0 8px rgba(59, 184, 166, 0.45);
	}
	.spell-category .slot-pip.spent {
		background: transparent;
		border-style: dashed;
		opacity: 0.5;
	}
	.spell-row {
		display: grid;
		/* fixed columns so effect/tag/timing line up across rows even when a row has no
		   resolution pill (its cell stays empty but keeps its width) */
		grid-template-columns: minmax(0, 1fr) 76px 74px 46px;
		align-items: center;
		gap: 8px;
		padding: 7px 6px;
		border-top: 1px solid var(--color-border);
		border-radius: 7px;
		cursor: pointer;
		break-inside: avoid;
		width: 100%;
		background: transparent;
		border-left: 0;
		border-right: 0;
		border-bottom: 0;
		color: var(--color-text);
		text-align: left;
		font: inherit;
	}
	.spgroup:first-child .spell-category {
		padding-top: 2px;
	}
	.spell-row:hover {
		background: var(--color-surface-2);
	}
	.spell-row .row-name {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.spell-row .row-name .name-main {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.spell-row .pinstar {
		flex: none;
	}
	.spell-row .spell-summary {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.spell-row .resolution-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		border-radius: 5px;
		padding: 2px 4px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		white-space: nowrap;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.spell-row .resolution-tag.hit {
		color: var(--color-resource);
		border-color: #5a4d28;
	}
	.spell-row .resolution-tag.save {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.spell-row .resolution-tag.auto {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.spell-row .spell-level {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		text-align: right;
		white-space: nowrap;
	}
	.spell-row .spell-level .cast-icon {
		font-style: normal;
		margin-right: 6px;
		color: var(--color-accent-bright);
		cursor: help;
	}
	.prep {
		position: relative;
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		margin-right: 8px;
		vertical-align: middle;
		cursor: pointer;
	}
	/* big invisible click target so the tiny dot is easy to hit */
	.prep::before {
		content: '';
		position: absolute;
		inset: -14px;
		border-radius: 50%;
	}
	/* hover halo (~2.5× the dot), painted behind it, showing you're on the prep target */
	.prep:hover {
		box-shadow: 0 0 0 6px var(--color-border-strong);
	}
	.prep.always {
		cursor: default;
	}
	.prep.on,
	.prep.always {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
	.pinstar {
		background: transparent;
		border: 0;
		color: var(--color-border-strong);
		margin-left: 7px;
		cursor: pointer;
		font-size: 12px;
	}
	.pinstar.on {
		color: var(--color-accent-bright);
	}
	.prepared-count {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.prepared-count b {
		color: var(--color-resource);
	}
</style>
