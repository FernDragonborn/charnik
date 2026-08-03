<script lang="ts">
	// Anchored dropdown menus dispatcher (temp HP, level-up, add-effect, custom-effect, show/hide,
	// pin-skills, spellbook, condition). The heavier dice-tray + roll-log bodies are their own
	// components under menus/. Reads the shared `combat` view-model.
	import { combat } from './state.svelte';
	import EyeIcon from '$lib/components/EyeIcon.svelte';
	import DiceTray from './menus/DiceTray.svelte';
	import RollLog from './menus/RollLog.svelte';
	import { SKILL_ABILITY, type SkillId } from '$lib/character/derive';
	import { titleCase, ABIL, ABILITY_NAME, MOD_TARGETS } from '$lib/combat/helpers';

	const overlay = $derived(combat.overlay);
	const actions = $derived(combat.actions);
	const hiddenActions = $derived(combat.hiddenActions);
	const passiveSkills = $derived(combat.passiveSkills);
	const conditionList = $derived(combat.conditionList);
	const character = $derived(combat.character);
	const { setTempHp, addEffect, addCustomModifier, togglePassive } = combat;

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
		class="overlay-backdrop"
		onclick={() => (combat.overlay = null)}
		onwheel={() => (combat.overlay = null)}
	></div>
	<div
		bind:this={popEl}
		class="popup"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		style="top:{overlay.top}px; {overlay.left != null
			? `left:${overlay.left}px`
			: `right:${overlay.right}px`}"
	>
		{#if overlay.kind === 'dice'}
			<DiceTray />
		{:else if overlay.kind === 'temphp'}
			<div class="menu-panel">
				<div class="popup-h eyebrow" style="border: 0">Set temporary HP</div>
				<div class="field">
					<input type="number" bind:value={combat.tempHpInput} />
					<button class="submit-btn" onclick={setTempHp}>Set</button>
				</div>
				<p class="note">
					Separate pool — teal in the HP bar. Doesn't stack; takes the higher value.
				</p>
			</div>
		{:else if overlay.kind === 'levelup'}
			<div class="popup-h eyebrow" style="border: 0">Level up · which class</div>
			{#each combat.levelUpClasses as cl (cl.index)}
				<button class="menu-row" onclick={() => combat.levelUp(cl.index)}>
					<span class="main">{cl.name} <b class="gold">{cl.level} → {cl.level + 1}</b></span>
					<span class="meta">+1 level</span>
				</button>
			{/each}
			<p class="note">
				HP, proficiency, spell slots & features update automatically. Pick any new ASI / feat /
				spells in the builder.
			</p>
		{:else if overlay.kind === 'addeffect'}
			<div class="search">
				<span class="search-icon">🔍</span><input placeholder="Search effects…" />
			</div>
			<div class="section eyebrow">Duration · applied to what you add</div>
			<div class="dur-picker">
				<button
					class="pill-btn"
					onclick={() => (combat.newEffectDuration = Math.max(0, combat.newEffectDuration - 1))}
					>−</button
				>
				<input
					class="modifier-amount"
					type="number"
					min="0"
					placeholder="∞"
					aria-label="Duration in rounds"
					bind:value={combat.newEffectDuration}
				/>
				<span class="dur-val">{combat.newEffectDuration > 0 ? 'rds' : 'until removed (∞)'}</span>
				<button class="pill-btn" onclick={() => (combat.newEffectDuration += 1)}>＋</button>
				<button
					class="pill-btn"
					class:on={combat.newEffectDuration === 0}
					title="Lasts until you remove it"
					onclick={() => (combat.newEffectDuration = 0)}>∞</button
				>
			</div>
			<div class="section eyebrow">Catalog</div>
			{#each combat.effectCatalog as p (p.label)}
				{@const dur = p.durationRounds ?? combat.newEffectDuration}
				<button
					class="menu-row"
					onclick={() =>
						addEffect({
							label: p.label,
							tokens: p.tokens,
							positive: !p.negative,
							durationRounds: dur,
							ref: p.ref
						})}
				>
					<span class="main"
						><span class="effect-icon" class:negative={p.negative}>＋</span>{p.label}</span
					><span class="durpill">{dur > 0 ? `${dur} rds` : '∞'}</span>
				</button>
			{/each}
			<div class="divlite"></div>
			<button
				class="menu-row"
				onclick={() => combat.overlay && (combat.overlay = { ...overlay, kind: 'customeffect' })}
			>
				<span class="main"><span class="effect-icon">✎</span><b>Custom effect…</b></span><span
					class="meta">text + manual mod</span
				>
			</button>
		{:else if overlay.kind === 'customeffect'}
			<div class="menu-panel">
				<div class="popup-h eyebrow" style="border: 0">Custom modifier</div>
				<div class="modifier-row">
					<select
						class="modifier-target"
						bind:value={combat.customModTarget}
						aria-label="Modifier target"
					>
						{#each MOD_TARGETS as g (g.group)}
							<optgroup label={g.group}>
								{#each g.opts as o (o.v)}<option value={o.v}>{o.l}</option>{/each}
							</optgroup>
						{/each}
					</select>
					<button
						class="modifier-sign"
						onclick={() => (combat.customModSign = combat.customModSign === '+' ? '-' : '+')}
						title="Toggle bonus / penalty">{combat.customModSign}</button
					>
					<input
						class="modifier-amount"
						type="number"
						min="1"
						bind:value={combat.customModAmount}
						aria-label="Amount"
					/>
				</div>
				<div class="section eyebrow" style="padding-left: 0">Duration</div>
				<div class="dur-picker">
					<button
						class="dur-step"
						onclick={() => (combat.newEffectDuration = Math.max(0, combat.newEffectDuration - 1))}
						>−</button
					>
					<span class="dur-picker-val"
						>{combat.newEffectDuration > 0
							? `${combat.newEffectDuration} rds`
							: '∞ until removed'}</span
					>
					<button class="dur-step" onclick={() => (combat.newEffectDuration += 1)}>＋</button>
					<button
						class="dur-inf"
						class:on={combat.newEffectDuration === 0}
						title="Lasts until you remove it"
						onclick={() => (combat.newEffectDuration = 0)}>∞</button
					>
				</div>
				<div class="field">
					<!-- svelte-ignore a11y_autofocus -->
					<input placeholder="Label (optional)…" bind:value={combat.customEffectLabel} autofocus />
					<button class="submit-btn" onclick={addCustomModifier}>Add</button>
				</div>
				<p class="note">
					Adds a <b>{combat.customModSign}{Math.abs(combat.customModAmount) || 1}</b> modifier — applied
					live to the chosen stat and listed in the effects panel.
				</p>
			</div>
		{:else if overlay.kind === 'log'}
			<RollLog />
		{:else if overlay.kind === 'showhide'}
			<div class="popup-h eyebrow">
				Which actions appear<button class="icon-button" onclick={() => (combat.overlay = null)}
					>✕</button
				>
			</div>
			{#each actions as a (a.id)}
				<button class="menu-row" onclick={() => (hiddenActions[a.id] = !hiddenActions[a.id])}>
					<span class="passive-eye" class:on={!hiddenActions[a.id]}
						><EyeIcon on={!hiddenActions[a.id]} /></span
					><span class="main">{a.name}</span>{#if hiddenActions[a.id]}<span class="meta"
							>hidden</span
						>{/if}
				</button>
			{/each}
		{:else if overlay.kind === 'pinskills'}
			<div class="popup-h eyebrow">
				Passive senses · 👁 = shown<button
					class="icon-button"
					onclick={() => (combat.overlay = null)}>✕</button
				>
			</div>
			<div class="pinwrap">
				{#each ABIL as ab (ab)}
					{@const list = (Object.keys(SKILL_ABILITY) as SkillId[]).filter(
						(k) => SKILL_ABILITY[k] === ab
					)}
					{#if list.length}
						<div class="category-block">
							<div class="section eyebrow">{ABILITY_NAME[ab]}</div>
							{#each list as skill (skill)}
								<button class="menu-row" onclick={() => togglePassive(skill)}>
									<span class="passive-eye" class:on={passiveSkills.includes(skill)}
										><EyeIcon on={passiveSkills.includes(skill)} /></span
									><span class="skill-name">{titleCase(skill)}</span>
								</button>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		{:else if overlay.kind === 'upcast'}
			{@const r = combat.upcastSpell}
			{#if r}
				<div class="popup-h eyebrow" style="border: 0">Cast {r.name} · at which slot</div>
				{#each combat.castableSlots(r) as lvl (lvl)}
					{@const preview = combat.castPreview(r, lvl)}
					<button class="menu-row" onclick={(e) => combat.castAtSlot(lvl, e)}>
						<span class="main">Level {lvl}{lvl === r.level ? ' · base' : ''}</span>
						{#if preview}<span class="meta">{preview}</span>{/if}
					</button>
				{/each}
				<p class="note" style="padding: 6px 13px 2px">Upcasting spends the higher-level slot.</p>
			{/if}
		{:else if overlay.kind === 'restshort'}
			<div class="popup-h eyebrow" style="border: 0">Short rest · spend Hit Dice</div>
			{#if combat.hitDice.length}
				{#each combat.hitDice as h (h.die)}
					<div class="hd-row">
						<span class="hd-name">{h.die} <small>{h.left}/{h.max}</small></span>
						<div class="hd-steppers">
							<button
								class="pill-btn"
								disabled={(combat.hdPick[h.die] ?? 0) <= 0}
								onclick={() => combat.hdPickInc(h.die, -1)}>−</button
							>
							<span class="hd-pick">{combat.hdPick[h.die] ?? 0}</span>
							<button
								class="pill-btn"
								disabled={(combat.hdPick[h.die] ?? 0) >= h.left}
								onclick={() => combat.hdPickInc(h.die, 1)}>＋</button
							>
						</div>
					</div>
				{/each}
				<p class="note" style="padding: 4px 13px">
					Each die heals its roll <b>+ CON</b> (min 1). Rolls show in the log.
				</p>
				<div class="field" style="padding: 0 13px 4px">
					<button class="submit-btn" onclick={() => combat.commitShortRest()}>
						Take short rest{combat.hdPickCount ? ` · spend ${combat.hdPickCount}` : ''}
					</button>
				</div>
			{:else}
				<p class="note" style="padding: 8px 13px">
					No Hit Dice — a short rest still refreshes pools.
				</p>
				<div class="field" style="padding: 0 13px 4px">
					<button class="submit-btn" onclick={() => combat.commitShortRest()}
						>Take short rest</button
					>
				</div>
			{/if}
		{:else if overlay.kind === 'manage'}
			<div class="popup-h eyebrow">
				Spellbook<button class="icon-button" onclick={() => (combat.overlay = null)}>✕</button>
			</div>
			<p class="note" style="padding: 11px 13px">
				Full spellbook manager arrives with the spell-manager view (d-spellmgr).
			</p>
		{:else if overlay.kind === 'condition'}
			<div class="popup-h eyebrow">
				Conditions · multi-select<button class="icon-button" onclick={() => (combat.overlay = null)}
					>✕</button
				>
			</div>
			{#each conditionList as cn (cn.id)}
				{@const added = character?.play.effects.some((e) => e.label === cn.label)}
				<button
					class="menu-row"
					onclick={() =>
						added
							? null
							: addEffect({
									label: cn.label,
									tokens: [`apply_condition:${cn.id}`],
									positive: false
								})}
				>
					<span class="main">{cn.label}</span><span class="toggle-track" class:on={added}></span>
				</button>
			{/each}
		{/if}
	</div>
{/if}

<style>
	/* overlays — d-menus popover language */
	/* transparent catcher: click outside the dropdown closes it */
	.overlay-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: 50;
	}
	.popup {
		position: absolute;
		width: min(300px, calc(100vw - 1.5rem));
		max-height: 72vh;
		overflow: auto;
		z-index: 51;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		box-shadow: 0 18px 40px var(--color-overlay);
		padding-bottom: 6px;
	}
	.popup-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-size-micro);
		padding: 11px 13px;
		border-bottom: 1px solid var(--color-border);
	}
	.menu-row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		color: var(--color-text);
		text-align: left;
		font: inherit;
	}
	.menu-row:hover {
		background: var(--color-surface-2);
	}
	.menu-row .main {
		flex: 1;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: var(--font-size-sm);
	}
	.menu-row .meta {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
	}
	.menu-row .effect-icon {
		width: 18px;
		text-align: center;
		color: var(--color-good);
	}
	.menu-row .effect-icon.negative {
		color: var(--color-accent-bright);
	}
	/* visibility = open/closed eye (shared EyeIcon glyph in currentColor), teal when shown */
	.passive-eye {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 16px;
		flex: none;
		color: var(--color-text-muted);
		opacity: 0.55;
	}
	.passive-eye.on {
		color: var(--color-good);
		opacity: 1;
	}
	/* --- section label + search + divider (d-menus) --- */
	.section {
		font-size: var(--font-size-micro);
		padding: 8px 13px 3px;
	}
	.divlite {
		height: 1px;
		background: var(--color-border);
		margin: 4px 0;
	}
	/* duration picker (add-effect + custom-effect) — buttons reuse global .pill-btn; only the row
	   layout, the value text, and the ∞-active tint are picker-specific */
	.dur-picker {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 13px 8px;
	}
	.dur-picker .dur-val {
		flex: 1;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-resource);
	}
	.dur-picker .pill-btn.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 13px;
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-body);
	}
	.search input {
		all: unset;
		flex: 1;
		color: var(--color-text);
	}
	.search .search-icon {
		color: var(--color-text-muted);
	}
	/* --- temp HP / custom modifier panel --- */
	.menu-panel {
		padding: 12px 13px;
	}
	.field {
		display: flex;
		gap: 8px;
		margin: 6px 0 8px;
	}
	/* menu text inputs: the roll-builder field and the custom-modifier target share one style */
	.field input,
	.modifier-target {
		flex: 1;
		min-width: 0;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
		font: inherit;
		padding: 8px 10px;
	}
	.submit-btn {
		font-family: var(--font-display);
		font-weight: 700;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
		border-radius: var(--radius);
		padding: 8px 14px;
		cursor: pointer;
	}
	.note {
		font-size: var(--font-size-xs);
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
		align-items: center;
		gap: 8px;
	}
	.modifier-sign {
		width: 36px;
		font-family: var(--font-mono);
		font-size: var(--font-size-md);
		font-weight: 700;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
		cursor: pointer;
	}
	.modifier-amount {
		width: 58px;
		text-align: center;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
		font: inherit;
		padding: 8px 6px;
	}
	/* --- short-rest Hit-Dice picker --- */
	.hd-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 9px;
		padding: 5px 13px;
	}
	.hd-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.hd-name small {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		margin-left: 4px;
	}
	.hd-steppers {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.hd-pick {
		min-width: 18px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-good);
	}
	/* --- pin skills (two-column) --- */
	.pinwrap {
		column-count: 2;
		column-gap: 14px;
		column-rule: 1px solid var(--color-border);
		padding: 7px;
	}
	.pinwrap .category-block {
		break-inside: avoid;
	}
	.pinwrap .section {
		padding: 6px 6px 2px;
	}
	.pinwrap .menu-row .skill-name {
		font-size: var(--font-size-sm);
	}
</style>
