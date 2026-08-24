<script lang="ts">
	// The roller ORGAN — the whole of what a roll looks like while you are building it, and the app's
	// dice tray. Three parts and no more: a header of dice buttons, a body of lines, and the action.
	//
	// The action is a TAB that hangs out of the bottom edge on the right, past the panel's outline.
	// That is deliberate: it costs no row inside the panel and no space in the header, and the
	// irregular silhouette it leaves is fine. An ad-hoc roll is this same organ with an empty body —
	// not a second screen, and not a mode.
	import RollerLine from './RollerLine.svelte';
	import { DICE } from '$lib/combat/helpers';
	import type { RollLogEntry } from '$lib/combat/roll';
	import { ROLLER_ROLE } from '$lib/dice/roller';
	import type { RollerOrgan } from '$lib/dice/roller.svelte';
	import { CRIT_METHOD } from '$lib/rules/dice';

	let {
		organ,
		onroll,
	}: {
		organ: RollerOrgan;
		/** The completed rolls — one per instance of a volley. What to DO with them (log, toast,
		 *  persist) belongs to the surface the organ is mounted on, never to the organ. */
		onroll: (entries: RollLogEntry[]) => void;
	} = $props();

	const hasDamage = $derived(organ.lines.some((l) => l.role === ROLLER_ROLE.damage));
	const critLine = $derived(organ.lines.some((l) => l.crit));
	const blocking = $derived(organ.issues.filter((i) => i.blocking));

	function fire(): void {
		const rolled = organ.roll();
		if (rolled.length) onroll(rolled);
	}
</script>

<!-- Ctrl+Enter has to fire from anywhere in the organ, including a die button in the header, and
     the panel is the only element that sees all of it. The rule below is about a div STANDING IN for
     a control; this is a shortcut over a container, and everything inside it is already focusable. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="roller" onkeydown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && fire()}>
	<div class="roller-panel">
		<!-- the header carries dice and a modifier and NO role of its own: a die lands in the line the
		     caret is in, which is why it never has to ask which half you meant. Effects are not here —
		     there are always more of them than would fit. -->
		<div class="roller-header">
			{#each DICE as sides (sides)}
				<button type="button" class="roller-die-btn" onclick={() => organ.addDie(sides)}
					>d{sides}</button
				>
			{/each}
			<button
				type="button"
				class="roller-die-btn ghost"
				title="add a modifier to the line the caret is in"
				onclick={organ.addMod}>±mod</button
			>
		</div>

		{#if organ.label}<div class="roller-label">{organ.label}</div>{/if}

		<div class="roller-body">
			{#each organ.lines as line, index (index)}
				<RollerLine {organ} {index} {line} roll={fire} />
			{/each}
			<!-- what belongs to the LINES rather than to the dice: a second line exists only when there
			     IS damage (§3), and the crit method is a rule option a table rules on mid-session as
			     often as it sets it once (PLAN §9), so it is reachable where the crit toggle is. -->
			{#if !hasDamage || critLine}
				<div class="roller-extras">
					{#if !hasDamage}
						<button type="button" class="roller-extra" onclick={organ.addDamageLine}
							>+ damage line</button
						>
					{/if}
					{#if critLine}
						<button
							type="button"
							class="roller-extra"
							title="how a crit doubles: classic rolls the dice twice, loyal maxes one set"
							onclick={organ.cycleCritMethod}
							>crit: {organ.critMethod === CRIT_METHOD.classic ? 'classic' : 'loyal'}</button
						>
					{/if}
				</div>
			{/if}
		</div>

		<!-- the ONE thing that stops a roll. Shown as a band rather than a tooltip because the Roll
		     button going muted says "you can't", and this says why (§10). A missing damage type is not
		     here: it underlines and rolls. -->
		{#if blocking.length}
			<div class="roller-blocked">
				<span class="roller-blocked-badge">!</span>
				<span
					>{blocking[0]?.text} — rolling the part I did understand would just be a quietly smaller number.</span
				>
			</div>
		{/if}

		<button
			type="button"
			class="roller-roll"
			class:muted={!organ.rollable}
			disabled={!organ.rollable}
			title={organ.rollable ? 'roll · Ctrl+Enter' : 'the formula is not fully accounted for'}
			onclick={fire}>Roll</button
		>
	</div>
</div>

<style>
	/* the tab hangs below the panel, so the organ reserves the room for it rather than overlapping
	   whatever comes next */
	.roller {
		margin-bottom: 42px;
	}
	.roller-panel {
		position: relative;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
	}
	.roller-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding: 10px 13px;
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
	}
	.roller-die-btn {
		flex: none;
		min-width: 34px;
		height: 28px;
		padding: 0 8px;
		border-radius: 7px;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text);
		font-family: var(--font-body);
		font-size: var(--font-size-xs);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.roller-die-btn:hover {
		border-color: var(--color-text-muted);
	}
	/* dashed + hollow: these add something to the line rather than being dice themselves */
	.roller-die-btn.ghost {
		border-style: dashed;
		background: transparent;
		color: var(--color-text-muted);
	}
	/* subordinate to the dice: these change the SHAPE of the roll, not its contents */
	.roller-extras {
		display: flex;
		gap: 6px;
		padding-left: 11px;
	}
	.roller-extra {
		padding: 3px 8px;
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: var(--font-size-micro);
		cursor: pointer;
	}
	.roller-extra:hover {
		border-color: var(--color-text-muted);
		color: var(--color-text);
	}
	.roller-label {
		padding: 9px 14px 0;
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 700;
		color: var(--color-text);
	}
	.roller-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: 12px 13px;
	}
	.roller-blocked {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		margin: 0 13px 12px;
		padding: 9px 11px;
		background: var(--color-resource-soft);
		border: 1px solid var(--color-resource-line);
		border-radius: 9px;
		font-size: var(--font-size-xs);
		color: var(--color-text);
	}
	.roller-blocked-badge {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-full);
		background: var(--color-warning);
		color: var(--color-warning-text);
		font-weight: 700;
	}
	/* the action, as a tab out of the bottom edge: no footer row, no header slot spent on it */
	.roller-roll {
		position: absolute;
		top: 100%;
		right: 20px;
		height: 36px;
		padding: 0 18px;
		border: 1px solid var(--color-border-strong);
		border-top: 0;
		border-radius: 0 0 var(--radius-md) var(--radius-md);
		background: var(--color-accent-deep);
		color: var(--color-accent-text);
		font-family: var(--font-display);
		font-size: var(--font-size-sm);
		font-weight: 600;
		cursor: pointer;
		box-shadow: var(--shadow-1);
	}
	.roller-roll:hover:not(:disabled) {
		background: var(--color-accent);
	}
	/* muted rather than disabled-looking-normal: "you can't press this" has to be visible BEFORE the
	   press, not discovered by it */
	.roller-roll.muted {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		cursor: not-allowed;
		box-shadow: none;
	}
</style>
