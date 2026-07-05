<script lang="ts">
	// Anchored dropdown menus (dice tray / roll builder, add-effect, pin-skills, roll log,
	// show/hide, temp HP, condition). Reads the shared `combat` view-model.
	import { combat } from './state.svelte';
	import { SKILL_ABILITY, type SkillId } from '$lib/character/derive';
	import {
		signed,
		titleCase,
		ABIL,
		ABILITY_NAME,
		DICE,
		EFFECT_PRESETS,
		MOD_TARGETS
	} from '$lib/combat/helpers';

	const overlay = $derived(combat.overlay);
	const rollSrc = $derived(combat.rollSrc);
	const dice = $derived(combat.dice);
	const rollAdvantage = $derived(combat.rollAdvantage);
	const rollMod = $derived(combat.rollMod);
	const rollExpr = $derived(combat.rollExpr);
	const log = $derived(combat.log);
	const actions = $derived(combat.actions);
	const hiddenActions = $derived(combat.hiddenActions);
	const passiveSkills = $derived(combat.passiveSkills);
	const conditionList = $derived(combat.conditionList);
	const character = $derived(combat.character);
	const { bumpDie, doRoll, setTempHp, addEffect, addCustomModifier, togglePassive } = combat;

	// Keep the dropdown inside the viewport: after it renders, if it would run off the bottom (or
	// top) edge, shift it up/down so it fits. `overlay.top` is in document coords (button bottom +
	// scroll); we clamp the equivalent viewport position, then convert back.
	let popEl = $state<HTMLDivElement>();
	$effect(() => {
		if (!overlay || !popEl) return;
		const margin = 8;
		const h = popEl.offsetHeight;
		const vh = window.innerHeight;
		const viewportTop = overlay.top - window.scrollY; // where it currently sits on screen
		let top = viewportTop;
		if (top + h > vh - margin) top = vh - margin - h; // overflowing bottom → pull up
		if (top < margin) top = margin; // …but never above the top edge
		popEl.style.top = `${top + window.scrollY}px`;
	});
</script>

{#if overlay}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<!-- backdrop: click closes; wheeling OUTSIDE the menu closes it too so the page can scroll
	     (wheeling over the menu itself scrolls the menu, via its own overflow:auto) -->
	<div
		class="ovbg"
		onclick={() => (combat.overlay = null)}
		onwheel={() => (combat.overlay = null)}
	></div>
	<div
		bind:this={popEl}
		class="pop"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		style="top:{overlay.top}px; {overlay.left != null
			? `left:${overlay.left}px`
			: `right:${overlay.right}px`}"
	>
		{#if overlay.kind === 'dice'}
			<div class="tray">
				{#if rollSrc}<div class="tray-src"><b>{rollSrc}</b></div>{/if}
				<div class="pool">
					{#each Object.entries(dice).sort((a, b) => Number(b[0]) - Number(a[0])) as [s, c] (s)}
						<div class="poolchip">
							<button onclick={() => bumpDie(Number(s), -1)}>−</button><b>{c}</b>×d{s}<button
								onclick={() => bumpDie(Number(s), 1)}>+</button
							>
						</div>
					{/each}
				</div>
				<p class="gridhint">tap a die to add · ± sets the count</p>
				<div class="dice-grid">
					{#each DICE as d (d)}<button class="die" onclick={() => bumpDie(d, 1)}>d{d}</button
						>{/each}
				</div>
				<div class="advrow">
					<button
						class="seg"
						class:on={rollAdvantage === -1}
						onclick={() => (combat.rollAdvantage = -1)}>Disadv.</button
					>
					<button
						class="seg"
						class:on={rollAdvantage === 0}
						onclick={() => (combat.rollAdvantage = 0)}>Normal</button
					>
					<button
						class="seg"
						class:on={rollAdvantage === 1}
						onclick={() => (combat.rollAdvantage = 1)}>Advant.</button
					>
				</div>
				<div class="modrow">
					<div class="mod">
						<button onclick={() => (combat.rollMod -= 1)}>−</button> mod {signed(rollMod)}
						<button onclick={() => (combat.rollMod += 1)}>+</button>
					</div>
					<button class="rollbtn" onclick={doRoll}>Roll {rollExpr}</button>
				</div>
				{#if log[0]}<div class="hist">
						{log[0].label}
						{#if log[0].advantageRoll}d20 <b class="res">{log[0].advantageRoll.kept}</b>
							<span class="drop">{log[0].advantageRoll.dropped}</span>{/if}
						{log[0].expr}{log[0].expr ? ' ' : ''}=
						<span class="res">{Number.isNaN(log[0].total) ? '' : log[0].total}</span>
					</div>{/if}
			</div>
		{:else if overlay.kind === 'temphp'}
			<div class="ph">
				<div class="pop-h" style="border: 0">Set temporary HP</div>
				<div class="field">
					<input type="number" bind:value={combat.tempHpInput} />
					<button class="set" onclick={setTempHp}>Set</button>
				</div>
				<p class="note">
					Separate pool — teal in the HP bar. Doesn't stack; takes the higher value.
				</p>
			</div>
		{:else if overlay.kind === 'levelup'}
			<div class="pop-h" style="border: 0">Level up · which class</div>
			{#each combat.levelUpClasses as cl (cl.index)}
				<button class="row" onclick={() => combat.levelUp(cl.index)}>
					<span class="main">{cl.name} <b class="gold">{cl.level} → {cl.level + 1}</b></span>
					<span class="meta">+1 level</span>
				</button>
			{/each}
			<p class="note">
				HP, proficiency, spell slots & features update automatically. Pick any new ASI / feat /
				spells in the builder.
			</p>
		{:else if overlay.kind === 'addeffect'}
			<div class="search"><span class="mag">🔍</span><input placeholder="Search effects…" /></div>
			<div class="sec">Catalog · presets</div>
			{#each EFFECT_PRESETS as p (p.label)}
				<button class="row" onclick={() => addEffect(p.label, p.tokens, !/bane/i.test(p.label))}>
					<span class="main"
						><span class="ic" class:neg={/bane/i.test(p.label)}>＋</span>{p.label}</span
					><span class="durpill">10 rds</span>
				</button>
			{/each}
			<div class="divlite"></div>
			<button
				class="row"
				onclick={() => combat.overlay && (combat.overlay = { ...overlay, kind: 'customeffect' })}
			>
				<span class="main"><span class="ic">✎</span><b>Custom effect…</b></span><span class="meta"
					>text + manual mod</span
				>
			</button>
		{:else if overlay.kind === 'customeffect'}
			<div class="ph">
				<div class="pop-h" style="border: 0">Custom modifier</div>
				<div class="modifier-row">
					<select class="modifier-target" bind:value={combat.cmTarget} aria-label="Modifier target">
						{#each MOD_TARGETS as g (g.group)}
							<optgroup label={g.group}>
								{#each g.opts as o (o.v)}<option value={o.v}>{o.l}</option>{/each}
							</optgroup>
						{/each}
					</select>
					<button
						class="modifier-sign"
						onclick={() => (combat.cmSign = combat.cmSign === '+' ? '-' : '+')}
						title="Toggle bonus / penalty">{combat.cmSign}</button
					>
					<input
						class="modifier-amount"
						type="number"
						min="1"
						bind:value={combat.cmAmount}
						aria-label="Amount"
					/>
				</div>
				<div class="field">
					<!-- svelte-ignore a11y_autofocus -->
					<input placeholder="Label (optional)…" bind:value={combat.customEffectLabel} autofocus />
					<button class="set" onclick={addCustomModifier}>Add</button>
				</div>
				<p class="note">
					Adds a <b>{combat.cmSign}{Math.abs(combat.cmAmount) || 1}</b> modifier — applied live to the
					chosen stat and listed in the effects panel.
				</p>
			</div>
		{:else if overlay.kind === 'log'}
			<div class="cardhead2"><span class="ttl">Roll log · history</span></div>
			<div class="logscroll">
				{#each log as l, i (i)}
					<div class="logrow">
						<div class="lr-top">
							<b>{l.label}</b><span class="lr-tot" class:res={!Number.isNaN(l.total)}
								>{Number.isNaN(l.total) ? '—' : l.total}</span
							>
						</div>
						{#if l.expr || l.advantageRoll}<div class="lr-sub">
								{#if l.advantageRoll}d20 <b>{l.advantageRoll.kept}</b>
									<span class="drop">{l.advantageRoll.dropped}</span>
								{/if}{l.expr}
							</div>{/if}
					</div>
				{:else}<p class="note" style="padding: 11px 13px">
						No rolls yet — tap a stat, skill, save, or attack.
					</p>{/each}
			</div>
		{:else if overlay.kind === 'showhide'}
			<div class="pop-h">
				Which actions appear<button class="ovx" onclick={() => (combat.overlay = null)}>✕</button>
			</div>
			{#each actions as a (a.id)}
				<button class="row" onclick={() => (hiddenActions[a.id] = !hiddenActions[a.id])}>
					<span class="eye" class:on={!hiddenActions[a.id]}></span><span class="main">{a.name}</span
					>{#if hiddenActions[a.id]}<span class="meta">hidden</span>{/if}
				</button>
			{/each}
		{:else if overlay.kind === 'pinskills'}
			<div class="pop-h">
				Passive senses · 👁 = shown<button class="ovx" onclick={() => (combat.overlay = null)}
					>✕</button
				>
			</div>
			<div class="pinwrap">
				{#each ABIL as ab (ab)}
					{@const list = (Object.keys(SKILL_ABILITY) as SkillId[]).filter(
						(k) => SKILL_ABILITY[k] === ab
					)}
					{#if list.length}
						<div class="catblock">
							<div class="sec">{ABILITY_NAME[ab]}</div>
							{#each list as skill (skill)}
								<button class="row" onclick={() => togglePassive(skill)}>
									<span class="eye" class:on={passiveSkills.includes(skill)}></span><span class="nm"
										>{titleCase(skill)}</span
									>
								</button>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		{:else if overlay.kind === 'manage'}
			<div class="pop-h">
				Spellbook<button class="ovx" onclick={() => (combat.overlay = null)}>✕</button>
			</div>
			<p class="note" style="padding: 11px 13px">
				Full spellbook manager arrives with the spell-manager view (d-spellmgr).
			</p>
		{:else if overlay.kind === 'condition'}
			<div class="pop-h">
				Conditions · multi-select<button class="ovx" onclick={() => (combat.overlay = null)}
					>✕</button
				>
			</div>
			{#each conditionList as cn (cn)}
				{@const added = character?.play.effects.some((e) => e.label === cn)}
				<button class="row" onclick={() => (added ? null : addEffect(cn, [], false))}>
					<span class="main">{cn}</span><span class="tg" class:on={added}></span>
				</button>
			{/each}
		{/if}
	</div>
{/if}

<style>
	/* overlays — d-menus popover language */
	/* transparent catcher: click outside the dropdown closes it */
	.ovbg {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: 50;
	}
	.pop {
		position: absolute;
		width: min(300px, calc(100vw - 1.5rem));
		max-height: 72vh;
		overflow: auto;
		z-index: 51;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		box-shadow: 0 18px 40px #000a;
		padding-bottom: 6px;
	}
	.pop-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 11px 13px;
		border-bottom: 1px solid var(--color-border);
	}
	.ovx {
		background: transparent;
		border: 0;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		background: transparent;
		border-radius: 8px;
		cursor: pointer;
		color: var(--color-text);
		text-align: left;
		font: inherit;
	}
	.row:hover {
		background: var(--color-surface-2);
	}
	.row .main {
		flex: 1;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.row .meta {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.row .ic {
		width: 18px;
		text-align: center;
		color: var(--color-good);
	}
	.row .ic.neg {
		color: var(--color-accent-bright);
	}
	/* visibility = open/closed eye, teal when shown */
	.eye {
		display: inline-block;
		width: 22px;
		height: 16px;
		flex: none;
		background-repeat: no-repeat;
		background-position: center;
		opacity: 0.5;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23878f9d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 12s3.5-6 10-6c1.6 0 3 .3 4.2.9M22 12s-3.5 6-10 6c-1.6 0-3-.3-4.2-.9'/%3E%3Cline x1='2' y1='2' x2='22' y2='22'/%3E%3C/svg%3E");
	}
	.eye.on {
		opacity: 1;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%233bb8a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='2.5'/%3E%3C/svg%3E");
	}
	.tg {
		width: 34px;
		height: 20px;
		border-radius: 999px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		position: relative;
		flex: none;
	}
	.tg::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-text-muted);
		transition: left 0.12s;
	}
	.tg.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
	}
	.tg.on::after {
		left: 16px;
		background: var(--color-good);
	}
	/* --- section label + search + divider (d-menus) --- */
	.sec {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 8px 13px 3px;
	}
	.divlite {
		height: 1px;
		background: var(--color-border);
		margin: 4px 0;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 13px;
		border-bottom: 1px solid var(--color-border);
		font-size: 14px;
	}
	.search input {
		all: unset;
		flex: 1;
		color: var(--color-text);
	}
	.search .mag {
		color: var(--color-text-muted);
	}
	/* --- dice tray / roll builder --- */
	.tray {
		padding: 12px;
	}
	.tray-src {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 8px 11px;
		margin-bottom: 9px;
	}
	.tray-src b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
	}
	.pool {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
		margin-bottom: 9px;
	}
	.poolchip {
		display: flex;
		align-items: center;
		gap: 5px;
		background: var(--color-resource-soft);
		border: 1px solid var(--color-resource);
		border-radius: 8px;
		padding: 4px 8px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-resource);
	}
	.poolchip button {
		all: unset;
		cursor: pointer;
		color: var(--color-resource);
		font-size: 14px;
		padding: 0 2px;
	}
	.poolchip b {
		font-family: var(--font-display);
		font-weight: 700;
	}
	.gridhint {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 0 0 7px;
	}
	.dice-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 7px;
		margin-bottom: 11px;
	}
	.die {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
		text-align: center;
		padding: 9px 0;
		border-radius: 9px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
	}
	.die:hover {
		border-color: var(--color-resource);
	}
	.advrow {
		display: flex;
		gap: 6px;
		margin-bottom: 11px;
	}
	.seg {
		flex: 1;
		text-align: center;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 7px 0;
		border-radius: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.seg.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.modrow {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mod {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 7px 9px;
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.mod button {
		all: unset;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 15px;
		padding: 0 4px;
	}
	.rollbtn {
		flex: 1;
		text-align: center;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
		color: #fff;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		border-radius: 9px;
		padding: 9px 12px;
		cursor: pointer;
	}
	.hist {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-border);
		margin-top: 10px;
		padding-top: 9px;
	}
	.hist .res {
		color: var(--color-good);
		font-weight: 700;
	}
	/* --- temp HP --- */
	.ph {
		padding: 12px 13px;
	}
	.field {
		display: flex;
		gap: 8px;
		margin: 6px 0 8px;
	}
	.field input {
		flex: 1;
		min-width: 0;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text);
		font: inherit;
		padding: 8px 10px;
	}
	.set {
		font-family: var(--font-display);
		font-weight: 700;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
		border-radius: 8px;
		padding: 8px 14px;
		cursor: pointer;
	}
	.note {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 0;
	}
	.note b {
		color: var(--color-resource);
	}
	.gold {
		color: var(--color-resource);
	}
	.modifier-row {
		display: flex;
		gap: 8px;
		margin: 8px 0;
	}
	.modifier-target {
		flex: 1;
		min-width: 0;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text);
		font: inherit;
		padding: 8px 10px;
	}
	.modifier-sign {
		width: 36px;
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 700;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text);
		cursor: pointer;
	}
	.modifier-amount {
		width: 58px;
		text-align: center;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text);
		font: inherit;
		padding: 8px 6px;
	}
	/* --- pin skills (two-column) --- */
	.pinwrap {
		column-count: 2;
		column-gap: 14px;
		column-rule: 1px solid var(--color-border);
		padding: 7px;
	}
	.pinwrap .catblock {
		break-inside: avoid;
	}
	.pinwrap .sec {
		padding: 6px 6px 2px;
	}
	.pinwrap .row .nm {
		font-size: 13px;
	}
	/* --- roll log --- */
	.cardhead2 {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 11px 13px 6px;
	}
	.cardhead2 .ttl {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.logscroll {
		padding: 0 6px 4px;
	}
	.logrow {
		padding: 7px 7px;
		border-top: 1px solid var(--color-border);
	}
	.logrow:first-child {
		border-top: 0;
	}
	.lr-top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.lr-top b {
		flex: 1;
		font-weight: 600;
	}
	.lr-tot {
		font-family: var(--font-display);
		font-weight: 700;
	}
	.lr-tot.res {
		color: var(--color-good);
	}
	.lr-sub {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 2px;
	}
	.lr-sub b {
		color: var(--color-good);
	}
	/* the dropped die of an advantage/disadvantage pair */
	/* the dropped adv/disadv d20 — shown but dimmed (de-emphasized, not struck through) */
	.drop {
		color: var(--color-text-muted);
		opacity: 0.45;
	}
</style>
