<script lang="ts">
	// The hit-point block at 0 hit points: an emergency that looks like one. Rescue pulls from one
	// edge and death from the other, each ground a third further per save; a save is a glyph the
	// player may also press; and the third of either ends it on one face — `Stabilized` on rescue's
	// own ground, `Dead` on a block gone black — whatever motion led there.
	//
	// There is no amount and no minus here: a hit taken while down is a failure the player presses,
	// two for a critical. The healing control stays as the way back up.
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import DiceIcon from '$lib/components/DiceIcon.svelte';
	import { _ } from '$lib/i18n';
	import { provenance } from '$lib/actions/provenance';
	import { DEATH_CAUSE_LABEL } from '$lib/combat/helpers';
	import type { Character, DownMotion } from '$lib/character/schema';
	import { DEATH_SAVE_TRACK, isStable } from '$lib/play/hit-points';
	import { combat } from '../../combat-view-model.svelte';
	import DownSide from './DownSide.svelte';
	import { SKULL_GLYPH, WINGS_GLYPH } from './save-glyphs';

	let {
		c,
		motion,
		preview = null,
		played,
		pencil,
	}: {
		c: Character;
		motion: DownMotion;
		/** The saves to DRAW instead of the character's own, while the motion is being chosen on a
		 *  character who is not down. A preview is looked at, never pressed. */
		preview?: { successes: number; failures: number } | null;
		/** Was the ending watched? Then the winning ground is seen to cross the block first. */
		played: boolean;
		pencil: Snippet;
	} = $props();

	const { openMenu } = combat;
	const PIPS = Array.from({ length: DEATH_SAVE_TRACK }, (_unused, index) => index);
	/** How long the winning ground takes to cross the block, the verdict to stand on it — and the
	 *  motion under a dead block to be let go. The stylesheet's `--cross` is the first of the three. */
	const VERDICT_SETTLES_MS = 1900;

	const saves = $derived(preview ?? c.play.deathSaves);
	const dead = $derived(!preview && !!c.play.death);
	const stable = $derived(!preview && isStable(c.play));
	const over = $derived(dead ? 'dead' : stable ? 'stable' : null);
	/**
	 * The ending is drawn in two steps: first the face as it stood, then the winning ground at its
	 * full width — so a death the track did not cause (massive damage, exhaustion) is SEEN to cross
	 * the block from death's edge, as the third failure's does, and the verdict waits for it. A face
	 * that opens on an ending nobody watched starts covered.
	 */
	let covered = $state(false);
	$effect(() => {
		if (!over) {
			covered = false;
			return;
		}
		if (!played) {
			covered = true;
			return;
		}
		// two frames: the first paints the ground where it stood, the second lets it travel
		let frame = requestAnimationFrame(
			() => (frame = requestAnimationFrame(() => (covered = true))),
		);
		return () => cancelAnimationFrame(frame);
	});
	const earned = $derived({
		good: stable && covered ? DEATH_SAVE_TRACK : dead ? 0 : Math.min(saves.successes, 2),
		bad: dead && covered ? DEATH_SAVE_TRACK : dead ? Math.min(saves.failures, 2) : saves.failures,
	});
	/** Only the save that ended it can be taken back, and only when a save did. */
	const canTakeBack = $derived(stable || c.play.death?.cause === 'death_saves');

	// Under the black nothing is seen, so nothing keeps moving there: the motion goes once the
	// verdict stands. A character already dead when the sheet opens starts that way.
	let settled = $state(false);
	$effect(() => {
		if (!dead) {
			settled = false;
			return;
		}
		const timer = setTimeout(() => (settled = true), VERDICT_SETTLES_MS);
		return () => clearTimeout(timer);
	});
	const playing = $derived(settled ? 'none' : motion);
</script>

{#snippet glyph(paths: readonly string[], size: number)}
	<svg
		class="hand-drawn"
		viewBox="0 0 24 24"
		width={size}
		height={size}
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#each paths as d (d)}<path {d} />{/each}
	</svg>
{/snippet}

{#snippet track(kind: 'successes' | 'failures')}
	{@const good = kind === 'successes'}
	<div
		class="saves"
		class:good
		class:bad={!good}
		role="group"
		aria-label={$_(good ? 'combat.hp.deathSuccesses' : 'combat.hp.deathFailures')}
	>
		{#each PIPS as index (index)}
			<button
				type="button"
				class="save"
				class:earned={saves[kind] > index}
				aria-pressed={saves[kind] > index}
				aria-label={$_(good ? 'combat.hp.successN' : 'combat.hp.failureN', {
					values: { n: index + 1 },
				})}
				onclick={() => combat.toggleDeathSave(kind, index)}
			>
				{@render glyph(good ? WINGS_GLYPH : SKULL_GLYPH, 28)}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet heal()}
	<button type="button" class="hp-heal" onclick={(event) => openMenu('restore', event)}>
		<Icon name="plus" size={13} /><span class="hp-heal-words">{$_('combat.hp.healOrTemp')}</span>
	</button>
{/snippet}

<div class="hp-face down {over ?? ''}" class:over={!!over} inert={preview ? true : undefined}>
	<div class="grounds">
		<DownSide tone="good" earned={earned.good} motion={playing} />
		<DownSide tone="bad" earned={earned.bad} motion={playing} />
	</div>
	<div class="line" inert={over ? true : undefined}>
		{@render track('successes')}
		<div class="middle">
			<span class="eyebrow at"
				>{$_('combat.hp.hitPointsAt', {
					values: { current: c.play.hp.current, max: combat.hpMax },
				})}{@render pencil()}</span
			>
			<div class="acts">
				<button
					type="button"
					class="roll"
					onclick={() => combat.deathSave()}
					use:provenance={$_('combat.hp.rollDeathSave')}
				>
					<DiceIcon size={18} /><span class="roll-words">{$_('combat.hp.deathSave')}</span>
				</button>
				{@render heal()}
			</div>
		</div>
		{@render track('failures')}
	</div>
	{#if over && covered}
		<div class="verdict {over}" class:played role="status">
			<b>{$_(dead ? 'combat.hp.dead' : 'combat.hp.stable')}</b>
			{#if dead && c.play.death}
				<small>{$_(DEATH_CAUSE_LABEL[c.play.death.cause])}</small>
				<!-- healing does not raise the dead; a revival does, and it is the player's to say -->
				<button type="button" class="revive" onclick={combat.revive}
					>{$_('combat.death.revived')}</button
				>
			{:else}
				{@render heal()}
			{/if}
			{#if canTakeBack}
				<button
					type="button"
					class="take-back"
					onclick={combat.hp.takeBackLastSave}
					aria-label={$_('combat.hp.takeBackSave')}
					use:provenance={$_('combat.hp.takeBackSave')}><Icon name="rotate-ccw" size={14} /></button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.hp-face.down {
		position: relative;
		overflow: hidden;
		background: var(--color-surface);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-lg);
		padding: var(--space-3) var(--space-4);
	}
	.hp-face.down.stable {
		border-color: var(--color-good);
	}
	.hp-face.down.dead {
		border-color: var(--color-border-strong);
		transition: border-color 0.7s 0.9s;
	}
	/* a right-to-left locale reads rescue from its own leading edge: the grounds turn over whole */
	.grounds {
		position: absolute;
		inset: 0;
	}
	:global([dir='rtl']) .grounds {
		transform: scaleX(-1);
	}
	.line {
		position: relative;
		display: grid;
		grid-template-columns: 32% 36% 32%;
		align-items: center;
		height: 100%;
		transition: opacity 0.35s;
	}
	.over .line {
		opacity: 0;
	}
	.saves {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		justify-items: center;
	}
	:global([dir='rtl']) .saves.bad {
		direction: ltr;
	}
	.saves.good {
		--tone: var(--color-good);
		--on: var(--color-bg);
		--idle: 0.62;
	}
	.saves.bad {
		--tone: var(--color-accent);
		--on: var(--color-accent-text);
		--idle: 0.5;
		/* death counts inward from its own edge: its first skull is the outermost */
		direction: rtl;
	}
	.save {
		display: inline-flex;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: none;
		cursor: pointer;
		color: var(--tone);
		opacity: var(--idle);
		transition:
			color 0.35s,
			opacity 0.35s,
			transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
	}
	.save.earned {
		color: var(--on);
		opacity: 1;
		transform: scale(1.08);
	}
	.save:hover {
		opacity: 1;
	}
	.middle {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
	}
	.at {
		white-space: nowrap;
	}
	.acts {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
	}
	.roll {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		padding: var(--space-1-5) var(--space-2-5);
		border-radius: var(--radius);
		border: 2px solid var(--color-text);
		background: var(--color-bg);
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
		white-space: nowrap;
		cursor: pointer;
	}
	/* the dice glyph fills its small die with the ground it stands on, so the two do not cross */
	.roll :global(path:last-child) {
		fill: var(--color-bg);
	}
	.hp-heal {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		border: 1px solid var(--color-good);
		background: var(--color-good-soft);
		color: var(--color-good);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		white-space: nowrap;
		cursor: pointer;
	}
	.roll:hover,
	.hp-heal:hover,
	.revive:hover {
		filter: brightness(1.14);
	}

	/* ---- the third save: one face, whatever motion led to it ---- */
	.verdict {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1-5);
	}
	/* it stands only once the winning ground has crossed the block */
	.verdict.played {
		animation: verdict-in 0.7s 0.9s both;
	}
	@keyframes verdict-in {
		from {
			opacity: 0;
		}
	}
	.verdict b {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: var(--font-size-xl);
		line-height: 1;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.verdict small {
		font-size: var(--font-size-xs);
		text-align: center;
		opacity: 0.7;
	}
	.verdict.stable {
		color: var(--color-bg);
	}
	.verdict.dead {
		background: var(--color-death);
		color: var(--color-death-text);
	}
	.revive {
		padding: var(--space-1) var(--space-2-5);
		border-radius: var(--radius);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		cursor: pointer;
	}
	.take-back {
		position: absolute;
		top: var(--space-2);
		inset-inline-end: var(--space-2);
		display: inline-flex;
		padding: var(--space-1);
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: inherit;
		opacity: 0.6;
		cursor: pointer;
	}
	.take-back:hover,
	.take-back:focus-visible {
		opacity: 1;
	}

	/* ---- a narrow block: the saves, and between them the roll and healing as icons ---- */
	@container hp-block (max-width: 26rem) {
		/* the label is wider than the gap between the saves here, and it is said by the face anyway */
		.at {
			font-size: var(--font-size-micro);
			letter-spacing: 0;
		}
		.acts {
			flex-direction: row;
			gap: var(--space-2);
		}
		.roll,
		.hp-heal {
			justify-content: center;
			min-width: 2.75rem;
			min-height: 2.75rem;
			padding: 0;
			border-radius: var(--radius);
		}
		.roll-words,
		.hp-heal-words {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.verdict .hp-heal {
			padding-inline: var(--space-2-5);
		}
		.verdict .hp-heal-words {
			position: static;
			width: auto;
			height: auto;
			clip-path: none;
		}
	}
</style>
