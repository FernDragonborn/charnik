<script lang="ts">
	// Anchored dropdown menus dispatcher (temp HP, level-up, add-effect, custom-effect, show/hide,
	// pin-skills, spellbook, condition). The heavier dice-tray + roll-log bodies are their own
	// components under menus/. Reads the shared `combat` view-model.
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { dismissOnEscape } from '$lib/actions/dismissOnEscape';
	import { combat } from './combat-view-model.svelte';
	import EyeIcon from '$lib/components/EyeIcon.svelte';
	import DiceTray from './menus/DiceTray.svelte';
	import RollLog from './menus/RollLog.svelte';
	import { SKILL_ABILITY, type SkillId } from '$lib/character/derive';
	import { titleCase, ABIL, MOD_TARGETS, modTargetKey, conditionIdOf } from '$lib/combat/helpers';
	import { sanitizeHtml } from '$lib/content/markdown';
	import Switch from '$lib/components/Switch.svelte';
	import { COINS } from '$lib/rules/currency';

	const overlay = $derived(combat.overlay);
	const actions = $derived(combat.actions);
	const hiddenActions = $derived(combat.hiddenActions);
	const passiveSkills = $derived(combat.passiveSkills);
	const conditionList = $derived(combat.effects.conditionList);
	const character = $derived(combat.character);
	const { setTempHp, addCustomModifier, togglePassive } = combat;
	const { addEffect } = combat.effects;

	/** The add-effect menu's own filter. The catalog is user-extendable content, so the box beside it
	 *  is the only way the list stays navigable at size — it used to search nothing at all. */
	let effectQuery = $state('');
	const matchingEffects = $derived.by(() => {
		const q = effectQuery.trim().toLowerCase();
		return q
			? combat.effects.effectCatalog.filter((p) => p.label.toLowerCase().includes(q))
			: combat.effects.effectCatalog;
	});

	let popEl = $state<HTMLDivElement>();
	let pos = $state<{ top: number; left: number | null; right: number | null }>({
		top: 0,
		left: 0,
		right: null,
	});

	/**
	 * Where the dropdown sits, in viewport coordinates: under its button, re-measured from it. A menu
	 * opened with NO button (the tray seam's centered one) keeps the placement it was given.
	 *
	 * `clamp` is for PLACING it — a menu opened near the bottom edge is pulled up so it fits. It is
	 * deliberately off while following a scroll: clamping there would pin the menu to the top of the
	 * screen while the button it belongs to scrolled away underneath, which is a menu pointing at
	 * nothing. It scrolls off with its button instead.
	 */
	function place(clamp: boolean): void {
		if (!overlay || !popEl) return;
		const margin = 8;
		const viewportWidth = document.documentElement.clientWidth;
		const r = overlay.anchor?.getBoundingClientRect();
		// which EDGE it hangs from was decided when it opened; only the measurement is redone
		let left = r && overlay.left != null ? r.left : overlay.left;
		let right = r && overlay.right != null ? viewportWidth - r.right : overlay.right;
		let top = r ? r.bottom + 6 : overlay.top;
		if (clamp) {
			// the same reasoning on the other axis: the menu is 300px wide, so a button anywhere near an
			// edge hangs it off the screen — which a phone viewport hits with almost every button
			const furthest = viewportWidth - margin - popEl.offsetWidth;
			if (left != null) left = Math.max(margin, Math.min(left, furthest));
			if (right != null) right = Math.max(margin, Math.min(right, furthest));
			if (top + popEl.offsetHeight > window.innerHeight - margin)
				top = window.innerHeight - margin - popEl.offsetHeight;
			if (top < margin) top = margin;
		}
		pos = { top, left, right };
	}

	/**
	 * The two things an open dropdown listens for.
	 *
	 * It TRAVELS with its button: re-placed on scroll (capture phase — `main` is the scroll region,
	 * not the window, so a bubbling listener would never hear it) rather than closed by one, because a
	 * menu that vanishes the moment you scroll to look at what it is about is a menu you open twice.
	 *
	 * And it CLOSES on a pointer outside it. That used to be a full-screen transparent catcher, which
	 * quietly ate the wheel: a fixed element's scroll parent is the viewport, and the viewport does not
	 * scroll in this app — so the page froze under every open menu, and the old fix for THAT was to
	 * close on wheel. A listener blocks nothing.
	 */
	$effect(() => {
		if (!overlay || !popEl) return;
		place(true);
		const follow = () => place(false);
		const reflow = () => place(true);
		const closeOnOutside = (e: PointerEvent) => {
			const t = e.target as Node;
			if (popEl?.contains(t) || overlay.anchor?.contains(t)) return;
			combat.overlay = null;
		};
		// The first place() measures a menu whose body has not laid out yet, so the clamp above ran
		// against a height of nothing and a tall menu still hung off the bottom. The same observer
		// covers a menu that RESIZES while open — the add-effect list shortens as its filter narrows.
		const refit = new ResizeObserver(reflow);
		refit.observe(popEl);
		window.addEventListener('scroll', follow, true);
		window.addEventListener('resize', reflow);
		window.addEventListener('pointerdown', closeOnOutside, true);
		return () => {
			refit.disconnect();
			window.removeEventListener('scroll', follow, true);
			window.removeEventListener('resize', reflow);
			window.removeEventListener('pointerdown', closeOnOutside, true);
		};
	});
</script>

{#if overlay}
	<div
		bind:this={popEl}
		class="popup"
		class:wide={overlay.kind === 'log'}
		class:dice-tray={overlay.kind === 'dice'}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		style="top:{pos.top}px; {pos.left != null ? `left:${pos.left}px` : `right:${pos.right}px`}"
		use:dismissOnEscape={() => (combat.overlay = null)}
	>
		{#if overlay.kind === 'dice'}
			<DiceTray />
		{:else if overlay.kind === 'temphp'}
			<div class="menu-panel">
				<div class="popup-heading eyebrow" style="border: 0">{$_('combat.menu.tempHpTitle')}</div>
				<div class="field">
					<input type="number" bind:value={combat.tempHpInput} />
					<button class="submit-btn" onclick={setTempHp}>{$_('combat.menu.set')}</button>
				</div>
				<p class="note">{$_('combat.menu.tempHpNote')}</p>
			</div>
		{:else if overlay.kind === 'addeffect'}
			<div class="search">
				<span class="search-icon"><Icon name="search" size={13} /></span><input
					placeholder={$_('combat.menu.searchEffects')}
					bind:value={effectQuery}
				/>
			</div>
			<div class="section eyebrow">{$_('combat.menu.durationApplied')}</div>
			<div class="dur-picker">
				<button
					class="pill-btn"
					onclick={() =>
						(combat.effects.newEffectDuration = Math.max(0, combat.effects.newEffectDuration - 1))}
					><Icon name="minus" size={12} label={$_('combat.menu.roundsFewer')} /></button
				>
				<input
					class="modifier-amount"
					type="number"
					min="0"
					placeholder="∞"
					aria-label={$_('combat.menu.durationRounds')}
					bind:value={combat.effects.newEffectDuration}
				/>
				<span class="dur-val"
					>{combat.effects.newEffectDuration > 0
						? $_('combat.menu.roundsShort')
						: $_('combat.menu.untilRemovedValue')}</span
				>
				<button class="pill-btn" onclick={() => (combat.effects.newEffectDuration += 1)}
					><Icon name="plus" size={12} label={$_('combat.menu.roundsMore')} /></button
				>
				<button
					class="pill-btn"
					class:on={combat.effects.newEffectDuration === 0}
					title={$_('combat.menu.untilRemovedTitle')}
					onclick={() => (combat.effects.newEffectDuration = 0)}
					><Icon name="infinity" size={13} label={$_('combat.menu.untilRemoved')} /></button
				>
			</div>
			<div class="section eyebrow">{$_('combat.menu.catalog')}</div>
			{#each matchingEffects as p (p.label)}
				{@const dur = p.durationRounds ?? combat.effects.newEffectDuration}
				<button
					class="menu-row"
					onclick={() =>
						addEffect({
							label: p.label,
							tokens: p.tokens,
							positive: !p.negative,
							durationRounds: dur,
							ref: p.ref,
						})}
				>
					<span class="main"
						><span class="effect-icon" class:negative={p.negative}
							><Icon name="plus" size={11} /></span
						>{p.label}</span
					><span class="durpill">{dur > 0 ? `${dur} ${$_('combat.menu.roundsShort')}` : '∞'}</span>
				</button>
			{/each}
			<div class="divider-light"></div>
			<button
				class="menu-row"
				onclick={() => combat.overlay && (combat.overlay = { ...overlay, kind: 'customeffect' })}
			>
				<span class="main"
					><span class="effect-icon"><Icon name="pencil" size={11} /></span><b
						>{$_('combat.menu.customEffect')}</b
					></span
				><span class="meta">{$_('combat.menu.customEffectMeta')}</span>
			</button>
		{:else if overlay.kind === 'customeffect'}
			<div class="menu-panel">
				<div class="popup-heading eyebrow" style="border: 0">
					{$_('combat.menu.customModifier')}
				</div>
				<div class="modifier-row">
					<select
						class="modifier-target"
						bind:value={combat.customModTarget}
						aria-label={$_('combat.menu.modifierTarget')}
					>
						{#each MOD_TARGETS as g (g.groupKey)}
							<optgroup label={$_(g.groupKey)}>
								{#each g.targets as target (target)}<option value={target}
										>{$_(modTargetKey(target))}</option
									>{/each}
							</optgroup>
						{/each}
					</select>
					<button
						class="modifier-sign"
						onclick={() => (combat.customModSign = combat.customModSign === '+' ? '-' : '+')}
						title={$_('combat.menu.toggleSign')}>{combat.customModSign}</button
					>
					<input
						class="modifier-amount"
						type="number"
						min="1"
						bind:value={combat.customModAmount}
						aria-label={$_('combat.menu.amount')}
					/>
				</div>
				<div class="section eyebrow" style="padding-inline-start: 0">
					{$_('combat.menu.duration')}
				</div>
				<div class="dur-picker">
					<button
						class="dur-step"
						onclick={() =>
							(combat.effects.newEffectDuration = Math.max(
								0,
								combat.effects.newEffectDuration - 1,
							))}><Icon name="minus" size={12} label={$_('combat.menu.roundsFewer')} /></button
					>
					<span class="dur-picker-val"
						>{combat.effects.newEffectDuration > 0
							? `${combat.effects.newEffectDuration} ${$_('combat.menu.roundsShort')}`
							: $_('combat.menu.untilRemovedLong')}</span
					>
					<button class="dur-step" onclick={() => (combat.effects.newEffectDuration += 1)}
						><Icon name="plus" size={12} label={$_('combat.menu.roundsMore')} /></button
					>
					<button
						class="dur-inf"
						class:on={combat.effects.newEffectDuration === 0}
						title={$_('combat.menu.untilRemovedTitle')}
						onclick={() => (combat.effects.newEffectDuration = 0)}
						><Icon name="infinity" size={13} label={$_('combat.menu.untilRemoved')} /></button
					>
				</div>
				<div class="field">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						placeholder={$_('combat.menu.labelOptional')}
						bind:value={combat.customEffectLabel}
						autofocus
					/>
					<button class="submit-btn" onclick={addCustomModifier}>{$_('combat.menu.add')}</button>
				</div>
				<p class="note">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitizeHtml on the same value -->
					{@html sanitizeHtml(
						$_('combat.menu.customModNote', {
							values: {
								mod: `${combat.customModSign}${Math.abs(combat.customModAmount) || 1}`,
							},
						}),
					)}
				</p>
			</div>
		{:else if overlay.kind === 'log'}
			<RollLog />
		{:else if overlay.kind === 'showhide'}
			<div class="popup-heading eyebrow">
				{$_('combat.menu.whichActions')}<button
					class="icon-button"
					onclick={() => (combat.overlay = null)}
					><Icon name="x" size={13} label={$_('combat.menu.close')} /></button
				>
			</div>
			{#each actions as a (a.id)}
				<button class="menu-row" onclick={() => (hiddenActions[a.id] = !hiddenActions[a.id])}>
					<span class="passive-eye" class:on={!hiddenActions[a.id]}
						><EyeIcon on={!hiddenActions[a.id]} /></span
					><span class="main">{$_(a.nameKey)}</span>{#if hiddenActions[a.id]}<span class="meta"
							>{$_('combat.menu.hidden')}</span
						>{/if}
				</button>
			{/each}
		{:else if overlay.kind === 'pinskills'}
			<div class="popup-heading eyebrow">
				{$_('combat.menu.passiveSenses')}<EyeIcon on={true} />{$_('combat.menu.legendShown')}<button
					class="icon-button"
					onclick={() => (combat.overlay = null)}
					><Icon name="x" size={13} label={$_('combat.menu.close')} /></button
				>
			</div>
			<div class="pin-wrap">
				{#each ABIL as ab (ab)}
					{@const list = (Object.keys(SKILL_ABILITY) as SkillId[]).filter(
						(k) => SKILL_ABILITY[k] === ab,
					)}
					{#if list.length}
						<div class="category-block">
							<div class="section eyebrow">{$_(`abilityName.${ab}`)}</div>
							{#each list as skill (skill)}
								<button class="menu-row" onclick={() => togglePassive(skill)}>
									<span class="passive-eye" class:on={passiveSkills.includes(skill)}
										><EyeIcon on={passiveSkills.includes(skill)} /></span
									><span class="skill-name"
										>{$_(`skillName.${skill}`, { default: titleCase(skill) })}</span
									>
								</button>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		{:else if overlay.kind === 'upcast'}
			{@const r = combat.upcastSpell}
			{#if r}
				<div class="popup-heading eyebrow" style="border: 0">
					{$_('combat.menu.upcastTitle', { values: { name: r.name } })}
				</div>
				{#each combat.castableSlots(r) as lvl (lvl)}
					{@const preview = combat.castPreview(r, lvl)}
					<button class="menu-row" onclick={(e) => combat.castAtSlot(lvl, e)}>
						<span class="main"
							>{$_(lvl === r.level ? 'combat.menu.slotLevelBase' : 'combat.menu.slotLevel', {
								values: { level: lvl },
							})}</span
						>
						{#if preview}<span class="meta">{preview}</span>{/if}
					</button>
				{/each}
				<p class="note" style="padding: 6px 13px 2px">{$_('combat.menu.upcastNote')}</p>
			{/if}
		{:else if overlay.kind === 'coins'}
			<div class="popup-heading eyebrow" style="border: 0">{$_('combat.menu.coinsTitle')}</div>
			{#each COINS as coin (coin.id)}
				<button class="menu-row" onclick={() => combat.inventory.toggleCoin(coin.id)}>
					<span class="passive-eye" class:on={combat.inventory.isCoinShown(coin.id)}
						><EyeIcon on={combat.inventory.isCoinShown(coin.id)} /></span
					><span class="main">{$_(`coinNameLong.${coin.id}`)}</span>
					<span class="meta">{$_(`coinName.${coin.id}`)}</span>
				</button>
			{/each}
			<div class="coin-weight">
				<Switch
					on={combat.inventory.weighsCoins}
					title={$_('combat.menu.coinWeight')}
					onclick={combat.inventory.toggleCoinWeight}
				/>
				<span class="main">{$_('combat.menu.coinWeight')}</span>
			</div>
			<p class="note" style="padding: 2px 13px 6px">{$_('combat.menu.coinWeightNote')}</p>
		{:else if overlay.kind === 'restshort'}
			<div class="popup-heading eyebrow" style="border: 0">{$_('combat.menu.shortRestTitle')}</div>
			{#if combat.hitDice.length}
				{#each combat.hitDice as h (h.die)}
					<div class="hitdice-row">
						<span class="hitdice-name">{h.die} <small>{h.left}/{h.max}</small></span>
						<div class="hitdice-steppers">
							<button
								class="pill-btn"
								disabled={(combat.hdPick[h.die] ?? 0) <= 0}
								onclick={() => combat.hdPickInc(h.die, -1)}
								><Icon name="minus" size={12} label={$_('combat.menu.dieFewer')} /></button
							>
							<span class="hitdice-pick">{combat.hdPick[h.die] ?? 0}</span>
							<button
								class="pill-btn"
								disabled={(combat.hdPick[h.die] ?? 0) >= h.left}
								onclick={() => combat.hdPickInc(h.die, 1)}
								><Icon name="plus" size={12} label={$_('combat.menu.dieMore')} /></button
							>
						</div>
					</div>
				{/each}
				<p class="note" style="padding: 4px 13px">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitizeHtml on the same value -->
					{@html sanitizeHtml($_('combat.menu.hitDiceNote'))}
				</p>
				<div class="field" style="padding: 0 13px 4px">
					<button class="submit-btn" onclick={() => combat.commitShortRest()}>
						{combat.hdPickCount
							? $_('combat.menu.takeShortRestSpend', { values: { count: combat.hdPickCount } })
							: $_('combat.menu.takeShortRest')}
					</button>
				</div>
			{:else}
				<p class="note" style="padding: 8px 13px">{$_('combat.menu.noHitDiceNote')}</p>
				<div class="field" style="padding: 0 13px 4px">
					<button class="submit-btn" onclick={() => combat.commitShortRest()}
						>{$_('combat.menu.takeShortRest')}</button
					>
				</div>
			{/if}
		{:else if overlay.kind === 'condition'}
			<div class="popup-heading eyebrow">
				{$_('combat.menu.conditionsTitle')}<button
					class="icon-button"
					onclick={() => (combat.overlay = null)}
					><Icon name="x" size={13} label={$_('combat.menu.close')} /></button
				>
			</div>
			{#each conditionList as cn (cn.id)}
				<!-- matched by the TOKEN it carries, not by its label: the label is content and a
				     translated pack would stop the switch recognising its own condition -->
				{@const applied = character?.play.effects.find((e) => conditionIdOf(e) === cn.id)}
				<button
					class="menu-row"
					aria-pressed={!!applied}
					onclick={() =>
						applied
							? combat.effects.removeEffect(applied.iid)
							: addEffect({
									label: cn.label,
									tokens: [`apply_condition:${cn.id}`],
									positive: false,
								})}
				>
					<span class="main">{cn.label}</span><span class="toggle-track" class:on={!!applied}
					></span>
				</button>
			{/each}
		{/if}
	</div>
{/if}

<style>
	/* overlays — d-menus popover language */
	.popup {
		position: fixed;
		width: min(300px, calc(100vw - 1.5rem));
		max-height: 72vh;
		overflow: auto;
		z-index: 51;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		box-shadow: 0 18px 40px var(--color-overlay);
		padding-bottom: var(--space-1-5);
	}
	/* the roll log's row does not fit the menu width — at 300px the d20 pair wrapped, which drew as a
	   two-line blob. The row is the fixed thing here (it is the same RollRow everywhere); the menu is
	   what gives, and it gives more since a roll became two labelled boxes: at 360px a crit's pool
	   started folding into a four-wide column of dice. */
	.popup.wide {
		width: min(440px, calc(100vw - 1.5rem));
	}
	/* the roller is a two-line tray with a header of dice buttons — at 300px the header wrapped onto
	   three rows and a damage line with two types had nowhere to go. Same reasoning as the log above:
	   the content is the fixed thing, the menu is what gives. */
	.popup.dice-tray {
		width: min(560px, calc(100vw - 1.5rem));
		/* the tray is two CARDS with a gap between them, each carrying its own edge and shadow — so the
		   dropdown behind them draws nothing, or the gap would show a third surface through it. It keeps
		   its padding, though: this box still scrolls, so a shadow cast outside it is a shadow clipped
		   flat against its edge — the room has to be INSIDE. */
		background: transparent;
		border: 0;
		box-shadow: none;
		padding: var(--space-1) var(--space-4) 20px;
	}
	.popup-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-size-micro);
		padding: var(--space-2-5) var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}
	.menu-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-2-5);
		border: 0;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		color: var(--color-text);
		text-align: start;
		font: inherit;
	}
	.menu-row:hover {
		background: var(--color-surface-2);
	}
	.menu-row .main {
		flex: 1;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
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
	/* the coin-weight switch sits in the same row shape the menu's buttons use, minus the button */
	.coin-weight {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1-5) var(--space-3);
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
		padding: var(--space-2) var(--space-3) var(--space-1);
	}
	.divider-light {
		height: 1px;
		background: var(--color-border);
		margin: var(--space-1) 0;
	}
	/* duration picker (add-effect + custom-effect) — buttons reuse global .pill-btn; only the row
	   layout, the value text, and the ∞-active tint are picker-specific */
	.dur-picker {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3) var(--space-2);
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
		gap: var(--space-2-5);
		padding: var(--space-3) var(--space-3);
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
		padding: var(--space-3) var(--space-3);
	}
	.field {
		display: flex;
		gap: var(--space-2);
		margin: var(--space-1-5) 0 var(--space-2);
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
		padding: var(--space-2) var(--space-2-5);
	}
	.submit-btn {
		font-family: var(--font-display);
		font-weight: 700;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
		border-radius: var(--radius);
		padding: var(--space-2) 14px;
		cursor: pointer;
	}
	.note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
	}
	/* `:global` because the two notes carrying a <b> arrive through `{@html}` — a translated sentence
	   keeps its emphasis inside the string, where a translator can move it, and scoped styles do not
	   reach markup Svelte never compiled. */
	.note :global(b) {
		color: var(--color-resource);
	}
	.modifier-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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
		padding: var(--space-2) var(--space-1-5);
	}
	/* --- short-rest Hit-Dice picker --- */
	.hitdice-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
	}
	.hitdice-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.hitdice-name small {
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		margin-inline-start: var(--space-1);
	}
	.hitdice-steppers {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.hitdice-pick {
		min-width: 18px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--color-good);
	}
	/* --- pin skills (two-column) --- */
	.pin-wrap {
		column-count: 2;
		column-gap: 14px;
		column-rule: 1px solid var(--color-border);
		padding: var(--space-1-5);
	}
	.pin-wrap .category-block {
		break-inside: avoid;
	}
	.pin-wrap .section {
		padding: var(--space-1-5) var(--space-1-5) 2px;
	}
	.pin-wrap .menu-row .skill-name {
		font-size: var(--font-size-sm);
	}
</style>
