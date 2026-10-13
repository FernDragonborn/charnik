<script lang="ts">
	// The hit-point block. Two faces of one height: on its feet (`HpStanding`) and at 0 hit points or
	// dead (`HpDown`). Around them, what belongs to the block and not to a face: the pencil that
	// picks the motion played at 0 hit points, the list it opens, and the light a block two failures
	// deep stands in.
	//
	// Reads the `combat` view-model singleton; the character and its sheet come in as props.
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { _ } from '$lib/i18n';
	import { motion } from '$lib/stores/motion.svelte';
	import { downMotionOf, type Character, type DownMotion } from '$lib/character/schema';
	import type { CharacterSheet } from '$lib/character/derive';
	import { DEATH_SAVE_TRACK, isStable } from '$lib/play/hit-points';
	import HpStanding from './HpStanding.svelte';
	import HpDown from './HpDown.svelte';
	import DownSide from './DownSide.svelte';
	import MotionMenu from './MotionMenu.svelte';
	import { PREVIEW_FIGHT, type DownShown } from './down-motions';

	let { c, s }: { c: Character; s: CharacterSheet } = $props();

	const down = $derived(c.play.hp.current <= 0 || !!c.play.death);
	const chosen = $derived(downMotionOf(c.ui.downMotion));
	/** Reduce motion stands over the choice without changing it. */
	const playing = $derived<DownMotion>(motion.reduced ? 'none' : chosen);
	/** One roll from death: the block is lit, and the light drifts. */
	const tense = $derived(
		down &&
			!c.play.death &&
			!isStable(c.play) &&
			c.play.deathSaves.failures === DEATH_SAVE_TRACK - 1,
	);

	/**
	 * Has this block shown the character ALIVE? A death it watched happen is played — the ground
	 * crosses the block before the verdict stands — and a character already dead when the sheet opens
	 * is simply shown dead.
	 */
	let seenAlive = $state(false);
	$effect(() => {
		if (!c.play.death) seenAlive = true;
	});

	/**
	 * Getting back up is played too — a natural 20, a heal and a revival are one way back, and a
	 * face that simply swapped would say nothing had been at stake. The face the character just left
	 * (the fight, `Stabilized`, `Dead` on black) is held still and WIPED away from rescue's edge by
	 * a band of rescue's own colour, and the block on its feet is what the wipe uncovers.
	 */
	const RISE_MS = 900;
	/** The 0 hit points face as it last stood — kept for as long as a rise takes to wipe it away. */
	let stood = $state<DownShown | null>(null);
	/**
	 * DERIVED, never set: the wipe has to begin in the very update the character gets up in. Set a
	 * tick later, the face would be taken down and put back for one frame between — and with it the
	 * motion it was playing, which is the break this exists to avoid.
	 */
	const rising = $derived(!down && !motion.reduced ? stood : null);
	$effect(() => {
		if (down) {
			stood = {
				successes: c.play.deathSaves.successes,
				failures: c.play.deathSaves.failures,
				ending: c.play.death ? 'dead' : isStable(c.play) ? 'stable' : null,
				cause: c.play.death?.cause ?? null,
				hitPoints: c.play.hp.current,
			};
			return;
		}
		if (!untrack(() => stood)) return;
		const done = setTimeout(() => (stood = null), motion.reduced ? 0 : RISE_MS);
		return () => clearTimeout(done);
	});

	/**
	 * What the block's leading edge is made of right now — the tab the pencil stands in is the
	 * block's own frame carried round it, so it wears that and not one colour for every face:
	 * rescue's ground once rescue has a save, black under `Dead`.
	 */
	const edge = $derived.by(() => {
		if (!down && !choosing) return 'standing';
		if (down && c.play.death) return 'dead';
		if (down && isStable(c.play)) return 'stable';
		const successes = down ? c.play.deathSaves.successes : PREVIEW_FIGHT.successes;
		return successes > 0 ? 'rescued' : 'fight';
	});

	let block: HTMLElement | undefined = $state();
	let choosing = $state(false);
	/** The list opens beside the block, past the pencil — unless the window has no such room. */
	const LIST_ROOM_PX = 260;
	let listUnder = $state(false);
	/** The pencil that opened the list, so the keyboard goes back to it. */
	let opener: HTMLElement | null = null;
	function toggleChoosing(event: Event) {
		opener = event.currentTarget as HTMLElement;
		const box = block?.getBoundingClientRect();
		const roomBeside = box
			? getComputedStyle(opener).direction === 'rtl'
				? window.innerWidth - box.right
				: box.left
			: 0;
		// the side pencil is gone on a narrow block, and with it any claim to the room beside it
		listUnder = roomBeside < LIST_ROOM_PX || opener.classList.contains('inside');
		choosing = !choosing;
	}
	function stopChoosing() {
		choosing = false;
		opener?.focus();
	}
	/** A press outside the block and its list closes the list. */
	function pressedElsewhere(event: PointerEvent) {
		if (choosing && !block?.contains(event.target as Node)) choosing = false;
	}
</script>

<svelte:window onpointerdown={pressedElsewhere} />

{#snippet pencilButton(place: 'side' | 'inside')}
	<button
		type="button"
		class="hp-pencil {place} {edge}"
		aria-label={$_('combat.hp.options')}
		aria-haspopup="true"
		aria-expanded={choosing}
		onclick={toggleChoosing}><Icon name="pencil" size={12} /></button
	>
{/snippet}
<!-- beside the label, for a block with no room beside itself -->
{#snippet pencil()}{@render pencilButton('inside')}{/snippet}

<div class="hp-block" class:tense class:still={playing === 'none'} class:choosing bind:this={block}>
	{#if !down && !choosing}
		<HpStanding {c} {s} {pencil} />
	{/if}
	{#if down || choosing || rising}
		<!-- ONE 0 hit points face for as long as it is on screen, down or being wiped away: the wipe
		     is put on around it rather than drawn over a second copy, so the motion it was playing is
		     the motion that leaves, without a frame's break. What moves is the mover; what it holds is
		     moved back by as much, so the face stays where it stood and only the wipe's edge travels. -->
		<div class="hp-rise" class:wiping={!!rising} aria-hidden={rising ? true : undefined}>
			<div class="rise-mover">
				{#if rising}
					<!-- rescue's own ground, seen through the band that leads the wipe -->
					<div class="rise-band">
						<div class="rise-band-still">
							<DownSide tone="good" earned={DEATH_SAVE_TRACK} motion={playing} />
						</div>
					</div>
				{/if}
				<div class="rise-clip">
					<div class="rise-still">
						<div class="rise-face">
							<HpDown
								{c}
								motion={playing}
								shown={rising ?? (down ? null : PREVIEW_FIGHT)}
								played={seenAlive}
								{pencil}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
	{@render pencilButton('side')}
	{#if choosing}
		<MotionMenu
			{chosen}
			reduced={motion.reduced}
			under={listUnder}
			onchoose={(picked) => (c.ui.downMotion = picked)}
			onclose={stopChoosing}
		/>
	{/if}
</div>

<style>
	.hp-block {
		position: relative;
		flex: 1;
		/* a query container has no width of its own to insist on, so this is what makes the block
		   beside it wrap under rather than squeeze this one to a sliver */
		min-width: min(100%, 20rem);
		container: hp-block / inline-size;
	}
	/* every face is one height: nothing the block shows may move what stands under it */
	.hp-block :global(.hp-face) {
		box-sizing: border-box;
		height: 7.3125rem;
	}

	/* ---- the way back up: the face just left, wiped away from rescue's edge. At rest these
	   wrappers are plain boxes around the face; the wipe is put on them. Every moving layer is then
	   the block's own width, so a percentage means the same travel on each: the block's width plus
	   the band and its lean, and what is held is moved back by exactly that ---- */
	.hp-rise {
		--lean: 16px;
		--band: 4.5rem;
		--travel: calc(100% + var(--band) + var(--lean));
		--wipe: 0.9s cubic-bezier(0.5, 0, 0.3, 1) both;
	}
	.hp-rise.wiping {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: hidden;
		border-radius: var(--radius-lg);
		pointer-events: none;
	}
	/* a right-to-left locale has rescue on the other edge: the wipe turns over whole, and the face it
	   holds is turned back so its words still read */
	:global([dir='rtl']) .hp-rise.wiping,
	:global([dir='rtl']) .wiping .rise-face {
		scale: -1 1;
	}
	.wiping .rise-mover,
	.wiping .rise-clip,
	.wiping .rise-still {
		position: absolute;
		inset: 0;
	}
	.wiping .rise-mover {
		animation: rise-wipe var(--wipe);
	}
	.wiping .rise-still,
	.rise-band-still {
		animation: rise-hold var(--wipe);
	}
	@keyframes rise-wipe {
		to {
			transform: translateX(var(--travel));
		}
	}
	@keyframes rise-hold {
		to {
			transform: translateX(calc(-1 * var(--travel)));
		}
	}
	/* the held face ends on the lean the grounds are cut with */
	.wiping .rise-clip {
		clip-path: polygon(var(--lean) 0, 100% 0, 100% 100%, 0 100%);
	}
	/* rescue's ground leads the wipe: a slit on that same lean just behind the edge, over a ground
	   that stands still behind it and moves as the character's motion */
	.rise-band {
		position: absolute;
		inset-block: 0;
		left: calc(-1 * var(--band));
		right: 0;
		clip-path: polygon(var(--lean) 0, calc(var(--band) + var(--lean)) 0, var(--band) 100%, 0 100%);
	}
	.rise-band-still {
		position: absolute;
		inset-block: 0;
		left: var(--band);
		right: 0;
	}

	/* ---- the pencil: a tab on the block's own side, the block's frame carried round it. There
	   only while the pointer or the focus is on the block, and always where there is no pointer to
	   rest — a touch screen has no other way to find it ---- */
	.hp-pencil {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.hp-pencil:hover,
	.hp-pencil:focus-visible,
	.choosing .hp-pencil {
		color: var(--color-text);
	}
	.hp-pencil.side {
		position: absolute;
		top: var(--space-3);
		inset-inline-end: 100%;
		margin-inline-end: -1px;
		padding: var(--space-1) var(--space-1-5);
		border-inline-end: 0;
		border-start-start-radius: var(--radius);
		border-end-start-radius: var(--radius);
		opacity: 0;
		transition:
			opacity 120ms ease,
			background-color 0.4s,
			border-color 0.4s,
			color 0.4s;
	}
	/* the tab is the block's frame carried round the pencil, so it is made of what the block's
	   leading edge is made of */
	.hp-pencil.side.fight,
	.hp-pencil.side.rescued {
		border-color: var(--color-accent);
	}
	.hp-pencil.side.rescued,
	.hp-pencil.side.stable {
		background: var(--color-good);
		color: var(--color-bg);
	}
	.hp-pencil.side.stable {
		border-color: var(--color-good);
	}
	/* black arrives with the verdict, once death's ground has crossed the block */
	.hp-pencil.side.dead {
		border-color: var(--color-border-strong);
		background: var(--color-death);
		color: var(--color-death-text);
		transition-delay: 0s, 0.9s, 0.9s, 0.9s;
	}
	.hp-pencil.side:not(.standing, .fight):hover {
		filter: brightness(1.15);
	}
	.hp-block:hover .hp-pencil.side,
	.hp-block:focus-within .hp-pencil.side,
	.choosing .hp-pencil.side {
		opacity: 1;
	}
	@media (hover: none) {
		.hp-pencil.side {
			opacity: 1;
		}
	}
	.hp-pencil.inside {
		position: relative;
		display: none;
		margin-inline-start: var(--space-1-5);
		padding: var(--space-1);
		border-color: transparent;
		border-radius: var(--radius-sm);
		background: none;
	}

	/* ---- two failures: the block is lit, and the light DRIFTS — two glows drawn once and traded
	   by opacity, so the whole shifts like something alive and never goes dark. It does not blink ---- */
	.hp-block::before,
	.hp-block::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--radius-lg);
		pointer-events: none;
		opacity: 0;
	}
	.hp-block::before {
		box-shadow:
			-7px 0 26px color-mix(in srgb, var(--color-accent) 75%, transparent),
			7px 0 22px color-mix(in srgb, var(--color-accent) 45%, transparent);
	}
	.hp-block::after {
		box-shadow:
			-7px 0 22px color-mix(in srgb, var(--color-accent) 45%, transparent),
			7px 0 26px color-mix(in srgb, var(--color-accent) 75%, transparent);
	}
	.tense::before {
		opacity: 1;
		animation: glow-drift 7.15s ease-in-out infinite alternate;
	}
	.tense::after {
		opacity: 0;
		animation: glow-drift 7.15s ease-in-out infinite alternate-reverse;
	}
	@keyframes glow-drift {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}
	/* `No animation` means the light too: the block is lit, and the light stands still */
	.tense.still::before,
	.tense.still::after {
		animation: none;
		opacity: 0.6;
	}

	/* ---- a narrow block: taller, every press 44px, and the pencil inside by the label ---- */
	@container hp-block (max-width: 26rem) {
		.hp-block :global(.hp-face) {
			height: 9.8125rem;
		}
		.hp-pencil.side {
			display: none;
		}
		.hp-pencil.inside {
			display: inline-flex;
		}
		/* a 12px glyph is no target for a thumb: the press reaches well past what is drawn */
		.hp-pencil.inside::before {
			content: '';
			position: absolute;
			inset: -0.6875rem;
		}
	}
</style>
