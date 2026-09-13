<script lang="ts">
	// The dice tray — the whole of what a roll looks like while you are building it, and the app's
	// dice tray. Three parts and no more: a header of dice buttons, a body of lines, and the action.
	//
	// The action is a TAB that hangs out of the bottom edge on the right, past the panel's outline.
	// That is deliberate: it costs no row inside the panel and no space in the header, and the
	// irregular silhouette it leaves is fine. An ad-hoc roll is this same tray with an empty body —
	// not a second screen, and not a mode.
	import RollerLine from './RollerLine.svelte';
	import { DICE } from '$lib/combat/helpers';
	import { _ } from '$lib/i18n';
	import type { RollLogEntry } from '$lib/combat/roll';
	import { ROLLER_ROLE } from '$lib/dice/roller';
	import type { DiceTray } from '$lib/dice/dice-tray.svelte';

	let {
		diceTray,
		onroll,
	}: {
		diceTray: DiceTray;
		/** The completed rolls — one per instance of a volley. What to DO with them (log, toast,
		 *  persist) belongs to the surface the dice tray is mounted on, never to the dice tray. */
		onroll: (entries: RollLogEntry[]) => void;
	} = $props();

	const hasDamage = $derived(diceTray.lines.some((l) => l.role === ROLLER_ROLE.damage));
	const blocking = $derived(diceTray.issues.filter((i) => i.blocking));
	/** The band says the FIRST thing wrong, blocking first. A warning gets it only when nothing is
	 *  blocking — otherwise the reason you can't roll would be pushed under a note about a type. */
	const issue = $derived(blocking[0] ?? diceTray.issues[0]);

	function fire(): void {
		const rolled = diceTray.roll();
		if (rolled.length) onroll(rolled);
	}
</script>

<!-- Ctrl+Enter has to fire from anywhere in the tray, including a die button in the header, and
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
				<button type="button" class="roller-die-btn" onclick={() => diceTray.addDie(sides)}
					>d{sides}</button
				>
			{/each}
			<button
				type="button"
				class="roller-die-btn ghost"
				title={$_('roller.addModifier')}
				onclick={diceTray.addMod}>{$_('roller.modButton')}</button
			>
		</div>

		{#if diceTray.label}<div class="roller-label">{diceTray.label}</div>{/if}

		<div class="roller-body">
			{#each diceTray.lines as line, index (index)}
				<RollerLine {diceTray} {index} {line} roll={fire} />
			{/each}
			<!-- what belongs to the LINES rather than to the dice: a second line exists only when there
			     IS damage (§3). How a crit DOUBLES is not here — it is a table's house rule, set once in
			     Settings ▸ General, not something anyone clicks back and forth mid-roll. -->
			{#if !hasDamage}
				<div class="roller-extras">
					<button type="button" class="roller-extra" onclick={diceTray.addDamageLine}
						>{$_('roller.damageLine')}</button
					>
				</div>
			{/if}
		</div>

		<!-- what the line can't answer for, as a band rather than a tooltip: the Roll button going muted
		     says "you can't", and this says why (§10). A missing damage type reads the same way — the
		     wavy underline says WHICH group, and a hover is no way to learn what an underline means —
		     but muted and without the badge, because it stops nothing. -->
		{#if issue}
			<div class="roller-blocked" class:warn={!issue.blocking}>
				{#if issue.blocking}<span class="roller-blocked-badge">!</span>{/if}
				<span
					>{$_(issue.key, { ...(issue.values ? { values: issue.values } : {}) })} — {$_(
						issue.blocking ? 'roller.issue.blockingWhy' : 'roller.issue.warnWhy',
					)}.</span
				>
			</div>
		{/if}

		<!-- muted, never `disabled`: `roll()` commits the half-typed token first, and a disabled button
		     takes no pointer events and moves no focus — so the blur that would have committed `2d6`
		     never fired and no number of clicks could ever roll it. The band above says why when the
		     click genuinely cannot, which is a message a keyboard can reach; a `title` on a dead
		     control is not. -->
		<button
			type="button"
			class="roller-roll"
			class:muted={!diceTray.rollable}
			title={$_(diceTray.rollable ? 'roller.rollHint' : 'roller.notAccounted')}
			onclick={fire}>{$_('roller.roll')}</button
		>
	</div>
</div>

<style>
	/* the tab hangs below the panel, so the tray reserves the room for it rather than overlapping
	   whatever comes next */
	.roller {
		margin-bottom: 42px;
	}
	/* the tray is its OWN card, and the surface it is mounted on draws nothing: two frames around one
	   set of dice is one line too many, and of the two this is the one that has to stay — the Roll tab
	   hangs off its bottom edge, and with no edge to hang from the button floats. */
	.roller-panel {
		position: relative;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: 0 6px 18px var(--color-overlay);
	}
	.roller-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
		padding: var(--space-2-5) var(--space-3);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
	}
	.roller-die-btn {
		flex: none;
		min-width: 34px;
		height: 28px;
		padding: 0 var(--space-2);
		border-radius: var(--radius);
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
		gap: var(--space-1-5);
		padding-inline-start: var(--space-2-5);
	}
	.roller-extra {
		padding: var(--space-1) var(--space-2);
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
		padding: var(--space-2) 14px 0;
		font-family: var(--font-display);
		font-size: var(--font-size-body);
		font-weight: 700;
		color: var(--color-text);
	}
	.roller-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-3);
	}
	.roller-blocked {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin: 0 var(--space-3) var(--space-3);
		padding: var(--space-2) var(--space-2-5);
		background: var(--color-resource-soft);
		border: 1px solid var(--color-resource-line);
		border-radius: var(--radius);
		font-size: var(--font-size-xs);
		color: var(--color-text);
	}
	/* a warning is the same band, drawn as quietly as the underline it explains: no fill, no badge —
	   it must not read as "something is wrong", because nothing is */
	.roller-blocked.warn {
		padding: 0 var(--space-2-5);
		background: transparent;
		border-color: transparent;
		color: var(--color-text-muted);
		font-size: var(--font-size-micro);
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
		inset-inline-end: 20px;
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
	.roller-roll:hover:not(.muted) {
		background: var(--color-accent);
	}
	/* muted rather than disabled: "the lines do not add up yet" has to be visible BEFORE the press —
	   but the press still commits what is being typed, which is often the very thing that fixes it */
	.roller-roll.muted {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		box-shadow: none;
	}
</style>
