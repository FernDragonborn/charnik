<script lang="ts">
	// Thin shell: state + logic live in ./state.svelte.ts (the `combat` view-model);
	// pure helpers in $lib/combat/helpers. Markup keeps bare names via reactive read-aliases;
	// writes/binds go through `combat.*`.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { dndzone } from 'svelte-dnd-action';
	import { toast } from 'svelte-sonner';
	import { SKILL_ABILITY } from '$lib/character/derive';
	import { combat } from './state.svelte';
	import { saveCharacterToStore } from '$lib/character/store.svelte';
	import CombatMenus from './CombatMenus.svelte';
	import {
		why,
		signed,
		metres,
		titleCase,
		effectTag,
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
	const conc = $derived(combat.conc);
	const hpBar = $derived(combat.hpBar);
	const passives = $derived(combat.passives);
	const attacks = $derived(combat.attacks);
	const visibleActions = $derived(combat.visibleActions);
	const spellGroups = $derived(combat.spellGroups);
	const preparedCount = $derived(combat.preparedCount);
	const preparedCap = $derived(combat.preparedCap);
	const groupByLabel = $derived(combat.groupByLabel);
	const log = $derived(combat.log);
	const collapsed = $derived(combat.collapsed);
	const columns = $derived(combat.columns);
	const flipDurationMs = combat.flipDurationMs;
	const dragDisabled = $derived(combat.dragDisabled);
	const pinned = $derived(combat.pinned);
	const shieldOn = $derived(combat.shieldOn);

	const {
		openMenu,
		openDice,
		roll,
		cast,
		toggle,
		cycleGroupBy,
		slotClick,
		togglePrepared,
		dndConsider,
		dndFinalize,
		releaseDrag
	} = combat;

	// action-economy slots (id + label); base 1 pip each until a feature grants extras
	const SLOTS = [
		['action', 'Action'],
		['bonus', 'Bonus'],
		['reaction', 'Reaction']
	] as const;
	const range = (n: number) => Array.from({ length: n }, (_, i) => i);

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
</script>

<svelte:head><title>Combat — Charnik</title></svelte:head>
<svelte:window onpointerup={releaseDrag} />

{#if !sheet || !character}
	<p class="loading">Computing sheet…</p>
{:else}
	{@const s = sheet}
	{@const c = character}
	<section class="hero">
		<div>
			<div class="eyebrow">{className}{speciesName ? ` · ${speciesName}` : ''}</div>
			<h1>{c.build.name}</h1>
			<div class="subl">
				Level <b>{s.level}</b> · <span class="sysx">{c.system}</span> · Proficiency
				<b>{signed(s.proficiencyBonus)}</b>
			</div>
		</div>
		<div class="hp">
			<div class="lab">
				<span>Hit points</span>
				<button class="temptag" onclick={(e) => openMenu('temphp', e)}>＋ Temp HP</button>
			</div>
			<div class="val" title={why(s.maxHp)}>
				{c.play.hp.current}<small>
					/ {c.play.hp.max ?? s.maxHp.value}</small
				>{#if c.play.hp.temp > 0}<span class="temp">+{c.play.hp.temp} temp</span>{/if}
			</div>
			<div class="bar">
				<i class="cur" style="width:{hpBar.cur}%"></i><i class="tmp" style="width:{hpBar.tmp}%"></i>
			</div>
			<div class="hpadj">
				<button class="hpbtn dmg" onclick={combat.damage} title="Apply damage">− Damage</button>
				<input
					class="hpnum"
					type="number"
					min="0"
					bind:value={combat.hpAmount}
					aria-label="HP amount"
				/>
				<button class="hpbtn heal" onclick={combat.heal} title="Apply healing">Heal ＋</button>
			</div>
		</div>
	</section>

	<section class="controls">
		<button class="toggle" class:on={shieldOn} onclick={() => (combat.shieldOn = !combat.shieldOn)}
			>🛡 Shield <span class="sw">{shieldOn ? 'ON' : 'OFF'}</span></button
		>
		{#if conc}<button class="toggle conc on"
				>◈ Concentration <span class="sw">{conc.label}</span></button
			>{/if}
		<button
			class="toggle"
			class:on={c.play.inspiration}
			onclick={() => (c.play.inspiration = !c.play.inspiration)}
			>✦ Inspiration <span class="sw">{c.play.inspiration ? 'ON' : 'OFF'}</span></button
		>
		<span class="spacer"></span>
		<button class="toggle auto on">⚙ Auto-calc <span class="sw">ON</span></button>
		<button class="toggle dice" onclick={openDice}>🎲 Dice tray</button>
	</section>

	<section class="turnbar">
		<span class="lbl">Round <b>{combat.round}</b></span>
		{#each SLOTS as [slot, label] (slot)}
			<span class="ae">
				{label}
				<span class="aepips">
					{#each range(combat.slotMax[slot]) as i (i)}
						<button
							type="button"
							class="aedot"
							class:used={i < c.play.turn[slot]}
							onclick={() => combat.usePip(slot, i)}
							title="{label}: {i < c.play.turn[slot] ? 'used — click to restore' : 'available'}"
							aria-label="{label} pip {i + 1}"
						></button>
					{/each}
				</span>
			</span>
		{/each}
		<button
			type="button"
			class="ae move"
			onclick={() => combat.spendMove(5)}
			title="Click: spend 5 ft"
		>
			🦶 Move <b class:spent={combat.moveLeft === 0}>{combat.moveLeft}</b> / {combat.moveMax} ft
		</button>
		<button type="button" class="aereset" onclick={combat.resetMove} title="Reset movement"
			>↺</button
		>
		<span class="spacer"></span>
		<button type="button" class="nextturn" onclick={combat.nextTurn}>Next turn ▸</button>
	</section>

	<div class="playbar">
		<span class="phint"
			>Tap any check · save · attack · spell to roll it · <b>Alt + click</b> (or Ctrl) for advantage /
			custom dice.</span
		>
		<button class="rollout" onclick={(e) => openMenu('log', e)}>
			🎲 {#if log[0]}Last · <b>{log[0].label}</b> <i>{log[0].expr}</i> =
				<span class="res">{log[0].total}</span>{:else}<i>no rolls yet</i>{/if}<span class="logcue"
				>▸ log</span
			>
		</button>
	</div>

	<div class="sectlab">
		<button class="slabtoggle" onclick={() => toggle('combat')}
			><span class="chev">{collapsed.combat ? '▸' : '▾'}</span>Combat</button
		>
	</div>
	{#if !collapsed.combat}
		<section class="combat">
			<button class="tile" title={why(s.ac)} onclick={(e) => roll('AC (touch)', 0, e)}>
				<div class="k">Armor class</div>
				<div class="v">{s.ac.value}</div>
				<div class="t">{s.ac.trace.map((x) => `${x.source} ${signed(x.amount)}`).join(' ')}</div>
			</button>
			<button
				class="tile"
				title={why(s.initiative)}
				onclick={(e) => roll('Initiative', s.initiative.value, e)}
			>
				<div class="k">Initiative</div>
				<div class="v">{signed(s.initiative.value)}</div>
				<div class="t">DEX <b>{signed(s.abilities.dex.mod)}</b></div>
			</button>
			<div class="tile" title={why(s.speed)}>
				<div class="k">Speed</div>
				<div class="v">{s.speed.value} ft<small> ({metres(s.speed.value)})</small></div>
				<div class="t">base walk</div>
			</div>
		</section>
		<div class="senses-strip">
			<span class="lbl">Passive senses</span>
			{#each passives as p, i (p.key)}
				{#if i > 0}<span class="sdot">·</span>{/if}
				<span class="sv" title={why(p.comp)}><i>{p.name}</i>{p.comp.value}</span>
			{:else}
				<span class="sv"><i>none pinned</i></span>
			{/each}
			<button class="edit" onclick={(e) => openMenu('pinskills', e)}>✎ Pin skills</button>
		</div>
	{/if}

	<div class="sectlab">
		<button class="slabtoggle" onclick={() => toggle('abilities')}
			><span class="chev">{collapsed.abilities ? '▸' : '▾'}</span>Abilities</button
		><em>tap to roll a check or save</em>
	</div>
	{#if !collapsed.abilities}
		<section class="grid">
			{#each ABIL as ab (ab)}
				{@const a = s.abilities[ab]}
				{@const prof = a.save.trace.some((t) => t.layer === 'proficiency')}
				<button class="ab" onclick={(e) => roll(`${ab.toUpperCase()} check`, a.mod, e)}>
					<div class="n"><b>{ab.toUpperCase()}</b> · {a.score}</div>
					<div class="m">{signed(a.mod)}</div>
					<span
						class="sv"
						class:prof
						role="button"
						tabindex="-1"
						title={why(a.save)}
						onclick={(e) => {
							e.stopPropagation();
							roll(`${ab.toUpperCase()} save`, a.save.value, e);
						}}
					>
						<i class="pdot" class:on={prof}></i>SAVE <b>{signed(a.save.value)}</b>
					</span>
				</button>
			{/each}
		</section>
	{/if}

	{#snippet panelCard(pid: string)}
		<div class="phead">
			<button class="htoggle" onclick={() => toggle(pid)}>
				<span class="chev">{collapsed[pid] ? '▸' : '▾'}</span>{PANEL_TITLE[pid]}
			</button>
			{#if pid === 'actions'}
				<button class="grpby" onclick={(e) => openMenu('showhide', e)}>👁 Show / hide</button>
			{:else if pid === 'effects'}
				<button class="grpby" onclick={(e) => openMenu('addeffect', e)}>＋ Add effect</button>
			{:else if pid === 'spells' && s.spellcasting.classes.length}
				<span class="prepct">Prepared <b>{preparedCount}</b> / {preparedCap}</span>
				<button class="grpby" onclick={cycleGroupBy} title="Change grouping"
					>{groupByLabel} ▾</button
				>
				<a class="grpby" href="{base}/spellbook">⛭ Manage all</a>
			{/if}
			<span class="dh" title="drag to reorder" onpointerdown={() => (combat.dragDisabled = false)}
				>⠿</span
			>
		</div>
		{#if !collapsed[pid]}
			{#if pid === 'skills'}
				<div class="sklgrid">
					{#each ABIL as ab (ab)}
						{@const list = Object.keys(SKILL_ABILITY).filter((k) => SKILL_ABILITY[k] === ab)}
						{#if list.length}
							<div class="catblock">
								<div class="ssec">{ABILITY_NAME[ab]}</div>
								{#each list as skill (skill)}
									{@const sk = s.skills[skill]}
									<button
										class="skl"
										title={why(sk)}
										onclick={(e) => roll(titleCase(skill), sk.value, e)}
									>
										<i
											class="pdot"
											class:on={sk.prof !== 'none'}
											class:exp={sk.prof === 'expertise'}
											title={sk.prof}
										></i>
										<span class="sn">{titleCase(skill)}</span>
										<b class="sm">{signed(sk.value)}</b>
									</button>
								{/each}
							</div>
						{/if}
					{/each}
				</div>
			{:else if pid === 'attacks'}
				{#each attacks as at (at.name)}
					<button class="atk" onclick={(e) => roll(at.name, at.toHit, e)}>
						<span class="an">{at.name}</span><span class="ah">{signed(at.toHit)}</span>
						<span class="ad">{at.dmg}</span><span class="am">{at.meta}</span>
					</button>
				{/each}
			{:else if pid === 'actions'}
				{#each visibleActions as a (a.id)}
					<button class="atk" onclick={(e) => a.roll && roll(a.roll[0], a.roll[1], e)}>
						<span class="an">{a.n}</span><span class="ah">{a.h || '—'}</span>
						<span class="ad">{a.d}</span><span class="am">{a.m}</span>
					</button>
				{/each}
			{:else if pid === 'effects'}
				{#each c.play.effects as e (e.iid)}
					<div class="eff" class:pos={e.positive} class:neg={!e.positive}>
						<span class="d"></span>
						<div class="body">
							<b>{e.label}</b>
							{#if e.effects.length || e.durationRounds}<span class="etags"
									>{#each e.effects as t (t)}<span class="etag">{effectTag(t)}</span
										>{/each}{#if e.durationRounds}<span class="durpill">{e.durationRounds} rds</span
										>{/if}</span
								>{/if}
						</div>
					</div>
				{:else}<p class="trace">No active effects.</p>{/each}
			{:else if pid === 'spells' && s.spellcasting.classes.length}
				{@const sc = s.spellcasting.classes[0]}
				<div class="castline">
					Save DC <b>{sc.saveDC.value}</b> · attack
					<b>{signed(sc.attack.value)}</b> — every spell
				</div>
				<div class="sprows">
					{#each spellGroups as g (g.key)}
						<div class="spgroup">
							<div class="scat" class:star={g.key === 'pinned'}>
								{g.label}
								{#if g.slots}{@const sl = g.slots}<span class="pips"
										>{#each Array(sl.full) as _, i (i)}<button
												class="pip"
												class:full={i < sl.full - sl.spent}
												class:spent={i >= sl.full - sl.spent}
												title="tap to spend / restore"
												onclick={() => slotClick(g.key, sl.full, sl.spent, i)}
											></button>{/each}</span
									>{/if}
							</div>
							{#each g.rows as r (g.key + r.id)}
								<button class="sprow" onclick={(e) => cast(r, e)}>
									<span class="an">
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
										<span class="nm">{r.name}</span>
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
									<span class="spe">{r.spe}</span>
									{#if r.res}<span class="rtag {r.res}">{r.resLabel}</span>{:else}<span></span>{/if}
									<span class="tm"
										>{#if r.ct}<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --><i
												class="ct"
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
				class="pcol"
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
	.loading {
		color: var(--color-text-muted);
		padding: var(--space-6);
		text-align: center;
	}
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
	.subl {
		color: var(--color-text-muted);
		font-size: 14px;
	}
	.subl b {
		color: var(--color-resource);
		font-weight: 600;
	}
	.sysx {
		font-family: var(--font-mono);
		font-size: 11px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
	}
	.hp {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 15px 17px;
	}
	.hp .lab {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}
	.temptag {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
		padding: 3px 9px;
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
	}
	.hp .val {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
	}
	.hp .val small {
		color: var(--color-text-muted);
		font-size: 16px;
		font-weight: 500;
	}
	.hp .val .temp {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		color: var(--color-good);
		margin-left: 7px;
	}
	.bar {
		height: 9px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
		overflow: hidden;
		border: 1px solid var(--color-border);
		margin-top: 8px;
		display: flex;
	}
	.bar > i {
		display: block;
		height: 100%;
	}
	.bar > i.cur {
		background: var(--color-accent);
	}
	.bar > i.tmp {
		background: var(--color-good);
		box-shadow: -1px 0 0 var(--color-surface);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 7px 12px;
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.toggle .sw {
		font-family: var(--font-mono);
		font-size: 10px;
		border: 1px solid var(--color-border-strong);
		border-radius: 5px;
		padding: 1px 6px;
		color: inherit;
	}
	.toggle.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.toggle.on .sw {
		border-color: var(--color-resource);
	}
	.toggle.conc.on {
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.conc.on .sw {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.auto.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.toggle.auto.on .sw {
		border-color: var(--color-good);
	}
	.toggle.dice {
		background: var(--color-accent-deep);
		border-color: var(--color-accent-deep);
		color: #fff;
		font-size: 13px;
	}
	.controls .spacer,
	.turnbar .spacer {
		flex: 1 1 auto;
		min-width: 8px;
	}

	.turnbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 9px 12px;
		margin-bottom: 12px;
	}
	.turnbar .lbl {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.ae {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
	}
	.ae .aepips {
		display: inline-flex;
		gap: 4px;
	}
	.ae .aedot {
		width: 12px;
		height: 12px;
		padding: 0;
		border: 1px solid var(--color-good);
		border-radius: 50%;
		background: var(--color-good);
		box-shadow: 0 0 8px rgba(59, 184, 166, 0.45);
		cursor: pointer;
	}
	.ae .aedot.used {
		background: transparent;
		border-color: var(--color-border-strong);
		box-shadow: none;
	}
	.ae b {
		color: var(--color-text);
	}
	.ae b.spent {
		color: var(--color-text-muted);
	}
	/* the Move slot + reset are buttons but wear the same chip look */
	button.ae {
		cursor: pointer;
		color: var(--color-text-muted);
	}
	button.ae:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.aereset {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		width: 28px;
		height: 28px;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 14px;
	}
	.aereset:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
	}
	/* HP damage / heal control */
	.hpadj {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
	}
	.hpnum {
		width: 58px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 14px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		color: var(--color-text);
		padding: 5px 4px;
	}
	.hpbtn {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 6px 11px;
		border-radius: 7px;
		cursor: pointer;
		flex: 1;
	}
	.hpbtn.dmg {
		background: var(--color-danger-soft, rgba(179, 69, 47, 0.12));
		border: 1px solid var(--color-danger, #b3452f);
		color: var(--color-danger, #d06a52);
	}
	.hpbtn.heal {
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
	}
	.hpbtn:hover {
		filter: brightness(1.12);
	}
	.roundc {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 7px 10px;
		color: var(--color-text-muted);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
	}
	.rstep {
		background: transparent;
		border: 0;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
		padding: 0 2px;
	}
	.nextturn {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: #fff;
		border-radius: 9px;
		padding: 7px 15px;
		cursor: pointer;
	}

	.playbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 22px;
	}
	.phint {
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
	.rollout .res {
		color: var(--color-good);
		font-size: 14px;
		font-weight: 700;
	}
	.rollout .logcue {
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
	.tile .k {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-accent-bright);
	}
	.tile .v {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 26px;
		line-height: 1.05;
		margin-top: 4px;
	}
	.tile .v small {
		font-size: 13px;
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.tile .t {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 6px;
	}
	.tile .t b {
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
	.senses-strip .lbl {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.senses-strip .sv {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
	}
	.senses-strip .sv i {
		font-style: normal;
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-right: 6px;
	}
	.senses-strip .sdot {
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
	.toggle:hover,
	.temptag:hover,
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
	.ab {
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
	.ab:hover {
		border-color: var(--color-border-strong);
		background: var(--color-surface);
	}
	.ab .n {
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	.ab .n b {
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.ab .m {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 34px;
		line-height: 1;
		margin: 6px 0 9px;
	}
	.ab .sv {
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
	.ab .sv:hover {
		border-color: var(--color-accent);
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.ab .sv b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 12px;
		line-height: 1;
		color: var(--color-text);
	}
	.ab .sv.prof {
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.ab .sv.prof b {
		color: var(--color-resource);
	}
	.ab .sv .pdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
	}
	.ab .sv .pdot.on {
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
	.pcol {
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
	.catblock {
		break-inside: avoid;
		margin-bottom: 7px;
	}
	.ssec {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 6px 0 3px;
	}
	.skl {
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
	.skl:hover {
		background: var(--color-surface-2);
	}
	.skl .pdot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		flex: none;
	}
	.skl .pdot.on {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
	/* expertise = a ringed dot (double proficiency) */
	.skl .pdot.exp {
		box-shadow:
			0 0 0 2px var(--color-surface),
			0 0 0 3.5px var(--color-resource);
	}
	.skl .sn {
		flex: 1;
	}
	.skl .sm {
		font-family: var(--font-display);
		font-weight: 700;
	}

	.atk {
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
	.atk + .atk {
		box-shadow: 0 -1px 0 var(--color-border);
	}
	.atk:hover {
		background: var(--color-surface-2);
		box-shadow: none;
	}
	.atk .an {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.atk .ah {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		color: var(--color-resource);
		justify-self: end;
	}
	.atk .ad {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.atk .am {
		font-size: 11px;
		color: var(--color-text-muted);
		justify-self: end;
	}

	.eff {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 0;
		border-top: 1px solid var(--color-border);
	}
	.eff:first-of-type {
		border-top: 0;
	}
	.eff .body {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
	}
	.eff .d {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}
	.eff.pos .d {
		background: var(--color-good);
	}
	.eff.pos .body b {
		color: var(--color-good);
	}
	.eff.neg .d {
		background: var(--color-accent);
	}
	.eff.neg .body b {
		color: var(--color-accent-bright);
	}
	.etags {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 5px;
		margin-left: auto;
	}
	.etag {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.eff.pos .etag {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.eff.neg .etag {
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
	.sprows {
		margin-top: 2px;
	}
	.scat {
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
	.scat.star {
		color: var(--color-accent-bright);
	}
	.scat .pips {
		display: flex;
		gap: 5px;
	}
	.scat .pip {
		width: 12px;
		height: 12px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid #2c4a45;
		cursor: pointer;
	}
	.scat .pip.full {
		background: var(--color-good);
		border-color: var(--color-good);
		box-shadow: 0 0 8px rgba(59, 184, 166, 0.45);
	}
	.scat .pip.spent {
		background: transparent;
		border-style: dashed;
		opacity: 0.5;
	}
	.sprow {
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
	.spgroup:first-child .scat {
		padding-top: 2px;
	}
	.sprow:hover {
		background: var(--color-surface-2);
	}
	.sprow .an {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.sprow .an .nm {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sprow .pinstar {
		flex: none;
	}
	.sprow .spe {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sprow .rtag {
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
	.sprow .rtag.hit {
		color: var(--color-resource);
		border-color: #5a4d28;
	}
	.sprow .rtag.save {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.sprow .rtag.auto {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.sprow .tm {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		text-align: right;
		white-space: nowrap;
	}
	.sprow .tm .ct {
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
	.prepct {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.prepct b {
		color: var(--color-resource);
	}
</style>
