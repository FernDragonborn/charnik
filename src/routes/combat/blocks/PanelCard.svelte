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
		ABIL,
		ABILITY_NAME,
		PANEL_TITLE
	} from '$lib/combat/helpers';

	let { pid, c, s }: { pid: string; c: Character; s: CharacterSheet } = $props();

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
		<button class="pill-btn" onclick={cycleGroupBy} title="Change grouping">{groupByLabel} ▾</button>
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
				<span class="row-name">{at.name}</span><span class="combat-row-hint">{signed(at.toHit)}</span
				>
				<span class="combat-row-desc">{at.dmg}</span><span class="combat-row-marker">{at.meta}</span>
			</button>
		{/each}
	{:else if pid === 'actions'}
		{#each visibleActions as a (a.id)}
			<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
				<span class="row-name">{a.name}</span><span class="combat-row-hint">{a.hint || '—'}</span>
				<span class="combat-row-desc">{a.desc}</span><span class="combat-row-marker">{a.marker}</span>
			</button>
		{/each}
	{:else if pid === 'effects'}
		{#each c.play.effects as e (e.iid)}
			<div class="effect" class:positive={e.positive} class:negative={!e.positive}>
				<span class="effect-dot"></span>
				<div class="body">
					<b>{e.label}</b>
					{#if e.effects.length || e.durationRounds}<span class="effect-tags"
							>{#each e.effects as t (t)}<span class="effect-tag">{effectTag(t)}</span
								>{/each}{#if e.durationRounds}<span class="durpill">{e.durationRounds} rds</span
								>{/if}</span
						>{/if}
				</div>
			</div>
		{:else}<p class="trace">No active effects.</p>{/each}
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

	.effect {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 0;
		border-top: 1px solid var(--color-border);
	}
	.effect:first-of-type {
		border-top: 0;
	}
	.effect .body {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
	}
	.effect .effect-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}
	.effect.positive .effect-dot {
		background: var(--color-good);
	}
	.effect.positive .body b {
		color: var(--color-good);
	}
	.effect.negative .effect-dot {
		background: var(--color-accent);
	}
	.effect.negative .body b {
		color: var(--color-accent-bright);
	}
	.effect-tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 5px;
		margin-left: auto;
	}
	.effect-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.effect.positive .effect-tag {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.effect.negative .effect-tag {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
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
