<script lang="ts">
	// Thin shell: state + logic live in ./state.svelte.ts (the `combat` view-model);
	// pure helpers in $lib/combat/helpers. Markup keeps bare names via reactive read-aliases;
	// writes/binds go through `combat.*`.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { dndzone } from 'svelte-dnd-action';
	import { toast } from 'svelte-sonner';
	import { SKILL_ABILITY, type SkillId } from '$lib/character/derive';
	import { combat } from './state.svelte';
	import { saveCharacterToStore } from '$lib/character/store.svelte';
	import { onBeforeReload } from '$lib/content/reload';
	import CombatMenus from './CombatMenus.svelte';
	import Controls from './blocks/Controls.svelte';
	import Turnbar from './blocks/Turnbar.svelte';
	import ResourceBar from './blocks/ResourceBar.svelte';
	import HpPanel from './blocks/HpPanel/HpPanel.svelte';
	import Loading from '$lib/components/Loading.svelte';
	import {
		why,
		signed,
		metres,
		titleCase,
		effectTag,
		range,
		ABIL,
		ABILITY_NAME,
		PANEL_TITLE
	} from '$lib/combat/helpers';

	// reactive read-aliases (bare names in markup); writes/binds use combat.* directly.
	// (overlay/dice/roll* etc. moved to CombatMenus, so they're not aliased here.)
	const character = $derived(combat.character);
	const sheet = $derived(combat.sheet);
	const className = $derived(combat.className);
	const speciesName = $derived(combat.speciesName);
	const passives = $derived(combat.passives);
	const attacks = $derived(combat.attacks);
	const visibleActions = $derived(combat.visibleActions);
	const spellGroups = $derived(combat.spellGroups);
	const preparedCount = $derived(combat.preparedCount);
	const preparedCap = $derived(combat.preparedCap);
	const groupByLabel = $derived(combat.groupByLabel);
	const log = $derived(combat.tray.log);
	const collapsed = $derived(combat.layout.collapsed);
	const columns = $derived(combat.layout.columns);
	const flipDurationMs = combat.layout.flipDurationMs;
	const dragDisabled = $derived(combat.layout.dragDisabled);
	const pinned = $derived(combat.pinned);

	const { openMenu, roll, cast, cycleGroupBy, togglePrepared } = combat;
	const { toggle, dndConsider, dndFinalize, releaseDrag } = combat.layout;
	const { slotClick } = combat.resources;

	onMount(combat.load);

	// autosave play-state edits back to storage (debounced), so combat persists per character
	let saveTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const c = combat.character;
		if (!c) return;
		JSON.stringify(c.play); // deep-track play changes
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void saveCharacterToStore(c), 800);
	});

	// flush the pending autosave before a manual refresh, so an unsaved edit survives the reload
	onMount(() =>
		onBeforeReload(async () => {
			clearTimeout(saveTimer);
			if (combat.character) await saveCharacterToStore(combat.character);
		})
	);
</script>

<svelte:head><title>Combat — Charnik</title></svelte:head>
<svelte:window onpointerup={releaseDrag} />

{#if !sheet || !character}
	<Loading message="Computing your character sheet…" />
{:else}
	{@const s = sheet}
	{@const c = character}
	<section class="hero">
		<div>
			<div class="eyebrow">{className}{speciesName ? ` · ${speciesName}` : ''}</div>
			<h1>{c.build.name}</h1>
			<div class="subline">
				Level <b>{s.level}</b> · <span class="system-badge">{c.system}</span> · Proficiency
				<b>{signed(s.proficiencyBonus)}</b>
				{#if combat.canLevelUp}
					<button
						class="levelup"
						onclick={async () => {
							await saveCharacterToStore(c); // persist first (e.g. the demo) so the builder can load it
							goto(`${base}/build?levelup=${c.id}`);
						}}>▲ Level up</button
					>
				{/if}
			</div>
		</div>
		<HpPanel {c} {s} />
	</section>

	<Controls {c} />

	{#if c.play.inCombat}
		<Turnbar {c} />
	{/if}

	{#if s.resources.length}
		<ResourceBar {s} />
	{/if}

	<div class="playbar">
		<span class="panel-hint"
			>Tap any check · save · attack · spell to roll it · <b>Alt + click</b> (or Ctrl) for advantage /
			custom dice.</span
		>
		<button class="rollout" onclick={(e) => openMenu('log', e)}>
			🎲 {#if log[0]}Last · <b>{log[0].label}</b> <i>{log[0].expr}</i> =
				<span class="roll-result">{log[0].total}</span>{:else}<i>no rolls yet</i>{/if}<span
				class="log-cue">▸ log</span
			>
		</button>
	</div>

	<div class="sectlab">
		<button class="slabtoggle" onclick={() => toggle('combat')}
			><span class="chevron">{collapsed.combat ? '▸' : '▾'}</span>Combat</button
		>
	</div>
	{#if !collapsed.combat}
		<section class="combat">
			<button class="tile" title={why(s.ac)} onclick={(e) => roll('AC (touch)', 0, e)}>
				<div class="tile-key">Armor class</div>
				<div class="tile-value">{s.ac.value}</div>
				<div class="tile-text">
					{s.ac.trace.map((x) => `${x.source} ${signed(x.amount)}`).join(' ')}
				</div>
			</button>
			<button
				class="tile"
				title={why(s.initiative)}
				onclick={(e) => roll('Initiative', s.initiative.value, e, 'initiative')}
			>
				<div class="tile-key">Initiative</div>
				<div class="tile-value">{signed(s.initiative.value)}</div>
				<div class="tile-text">DEX <b>{signed(s.abilities.dex.mod)}</b></div>
			</button>
			<div class="tile" title={why(s.speed)}>
				<div class="tile-key">Speed</div>
				<div class="tile-value">{s.speed.value} ft<small> ({metres(s.speed.value)})</small></div>
				<div class="tile-text">base walk</div>
			</div>
		</section>
		<div class="senses-strip">
			<span class="bar-label">Passive senses</span>
			{#each passives as p, i (p.key)}
				{#if i > 0}<span class="separator-dot">·</span>{/if}
				<span class="ability-save" title={why(p.comp)}><i>{p.name}</i>{p.comp.value}</span>
			{:else}
				<span class="ability-save"><i>none pinned</i></span>
			{/each}
			<button class="edit" onclick={(e) => openMenu('pinskills', e)}>✎ Pin skills</button>
		</div>
		{#if s.defenses.resist.length || s.defenses.immune.length || s.defenses.vulnerable.length}
			<div class="senses-strip">
				<span class="bar-label">Defenses</span>
				{#if s.defenses.resist.length}<span class="ability-save"
						><i>Resist</i>{s.defenses.resist.join(', ')}</span
					>{/if}
				{#if s.defenses.immune.length}<span class="ability-save"
						><i>Immune</i>{s.defenses.immune.join(', ')}</span
					>{/if}
				{#if s.defenses.vulnerable.length}<span class="ability-save"
						><i>Vulnerable</i>{s.defenses.vulnerable.join(', ')}</span
					>{/if}
			</div>
		{/if}
	{/if}

	<div class="sectlab">
		<button class="slabtoggle" onclick={() => toggle('abilities')}
			><span class="chevron">{collapsed.abilities ? '▸' : '▾'}</span>Abilities</button
		><em>tap to roll a check or save</em>
	</div>
	{#if !collapsed.abilities}
		<section class="grid">
			{#each ABIL as ab (ab)}
				{@const a = s.abilities[ab]}
				{@const prof = a.save.trace.some((t) => t.layer === 'proficiency')}
				<button class="ability" onclick={(e) => roll(`${ab.toUpperCase()} check`, a.mod, e)}>
					<div class="ability-name"><b>{ab.toUpperCase()}</b> · {a.score}</div>
					<div class="ability-mod">{signed(a.mod)}</div>
					<span
						class="ability-save"
						class:prof
						role="button"
						tabindex="-1"
						title={why(a.save)}
						onclick={(e) => {
							e.stopPropagation();
							roll(`${ab.toUpperCase()} save`, a.save.value, e, `save.${ab}`);
						}}
					>
						<i class="prof-dot" class:on={prof}></i>SAVE <b>{signed(a.save.value)}</b>
					</span>
				</button>
			{/each}
		</section>
	{/if}

	{#snippet panelCard(pid: string)}
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
				<button class="pill-btn" onclick={cycleGroupBy} title="Change grouping"
					>{groupByLabel} ▾</button
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
						<span class="combat-row-desc">{at.dmg}</span><span class="combat-row-marker"
							>{at.meta}</span
						>
					</button>
				{/each}
			{:else if pid === 'actions'}
				{#each visibleActions as a (a.id)}
					<button class="combat-row" onclick={(e) => combat.actionClick(a, e)}>
						<span class="row-name">{a.name}</span><span class="combat-row-hint"
							>{a.hint || '—'}</span
						>
						<span class="combat-row-desc">{a.desc}</span><span class="combat-row-marker"
							>{a.marker}</span
						>
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
	{/snippet}

	<section class="panels">
		{#each columns as col, ci (ci)}
			<div
				class="panel-column"
				use:dndzone={{
					items: col,
					type: 'panel',
					dragDisabled,
					flipDurationMs,
					dropTargetStyle: {}
				}}
				onconsider={(e) => dndConsider(ci, e)}
				onfinalize={(e) => dndFinalize(ci, e)}
			>
				{#each col as item (item.id)}
					<div class="card">{@render panelCard(item.id)}</div>
				{/each}
			</div>
		{/each}
	</section>
	<CombatMenus />
{/if}

<style>
	.hero {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 22px;
		align-items: end;
		margin-bottom: 16px;
	}
	.eyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: 11px;
		color: var(--color-accent-bright);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		line-height: 1.02;
		letter-spacing: -0.02em;
		margin: 7px 0 4px;
	}
	.subline {
		color: var(--color-text-muted);
		font-size: 14px;
	}
	.subline b {
		color: var(--color-resource);
		font-weight: 600;
	}
	.levelup {
		margin-left: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		color: var(--color-good);
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		border-radius: 7px;
		padding: 3px 10px;
		cursor: pointer;
	}
	.levelup:hover {
		filter: brightness(1.15);
	}
	.system-badge {
		font-family: var(--font-mono);
		font-size: 11px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
	}

	.playbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 22px;
	}
	.panel-hint {
		font-size: 12px;
		color: var(--color-text-muted);
		flex: 1;
		min-width: 220px;
	}
	.rollout {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 6px 11px;
		cursor: pointer;
		margin-left: auto;
		white-space: nowrap;
	}
	.rollout:hover {
		border-color: var(--color-border-strong);
	}
	.rollout i {
		font-style: normal;
		color: var(--color-text-muted);
	}
	.rollout .roll-result {
		color: var(--color-good);
		font-size: 14px;
		font-weight: 700;
	}
	.rollout .log-cue {
		color: var(--color-text-muted);
		margin-left: 8px;
	}

	.combat {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 12px;
	}
	.tile {
		text-align: left;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		padding: 13px 15px;
		color: var(--color-text);
	}
	button.tile {
		cursor: pointer;
	}
	/* only the clickable tiles (AC / Init) light up; the Speed tile is a plain div */
	button.tile:hover {
		border-color: var(--color-accent);
		background: var(--color-surface-2);
	}
	.tile .tile-key {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-accent-bright);
	}
	.tile .tile-value {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 26px;
		line-height: 1.05;
		margin-top: 4px;
	}
	.tile .tile-value small {
		font-size: 13px;
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.tile .tile-text {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 6px;
	}
	.tile .tile-text b {
		color: var(--color-resource);
	}

	.senses-strip {
		display: flex;
		align-items: baseline;
		gap: 14px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 11px 16px;
		margin-bottom: 22px;
	}
	.senses-strip .bar-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.senses-strip .ability-save {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
	}
	.senses-strip .ability-save i {
		font-style: normal;
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-right: 6px;
	}
	.senses-strip .separator-dot {
		color: var(--color-border-strong);
	}
	.senses-strip .edit {
		margin-left: auto;
		font-family: var(--font-body);
		font-size: 12px;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 3px 8px;
		cursor: pointer;
		align-self: center;
	}
	.senses-strip .edit:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
		background: var(--color-surface-2);
	}
	/* colored pill buttons keep their semantic colour but brighten on hover */
	.nextturn:hover {
		filter: brightness(1.14);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
		margin-bottom: 22px;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
		.hero {
			grid-template-columns: 1fr;
		}
	}
	.ability {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 11px;
		text-align: center;
		padding: 12px 8px;
		cursor: pointer;
		color: var(--color-text);
		display: block;
		width: 100%;
	}
	.ability:hover {
		border-color: var(--color-border-strong);
		background: var(--color-surface);
	}
	.ability .ability-name {
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	.ability .ability-name b {
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.ability .ability-mod {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 34px;
		line-height: 1;
		margin: 6px 0 9px;
	}
	.ability .ability-save {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 5px 6px;
		cursor: pointer;
	}
	.ability .ability-save:hover {
		border-color: var(--color-accent);
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.ability .ability-save b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 12px;
		line-height: 1;
		color: var(--color-text);
	}
	.ability .ability-save.prof {
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.ability .ability-save.prof b {
		color: var(--color-resource);
	}
	.ability .ability-save .prof-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
	}
	.ability .ability-save .prof-dot.on {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}

	/* Two flex columns (not multicol): drag-safe with svelte-dnd-action, packs tight
	   top-to-bottom so a block's height never bumps another into the next column. */
	.panels {
		display: flex;
		gap: 18px;
		align-items: stretch;
	}
	/* stretch + min-height so the whole column (incl. empty tail below the last card)
	   is inside the dndzone → a panel can be dropped anywhere in the other column. */
	.panel-column {
		flex: 1;
		min-width: 0;
		min-height: 160px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	@media (max-width: 760px) {
		.panels {
			flex-direction: column;
		}
	}

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
