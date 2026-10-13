<script lang="ts">
	// One side of the fight at 0 hit points: rescue's ground or death's, as wide as the saves it has
	// earned, moving as the character's chosen motion.
	//
	// A GROUND IS A WINDOW. Each side's scene — the flames, the shafts of light, the stripes — is laid
	// out once, in pixels from the block's own edge, and the ground is a window onto it: a wider
	// ground uncovers more of the scene and nothing in it stretches or moves. So the window is moved
	// by `transform` and the scene inside it by the opposite one, which leaves the scene where it was.
	// What travels WITH the front — sparks, a shadow reaching ahead — rides a third layer, the front.
	//
	// The side is authored once, growing toward the right. Death's side is that same side mirrored,
	// so a motion is written one way; the grounds are mirrored again as a whole under a right-to-left
	// locale (`HpDown`), which is why this file uses physical offsets and `direction: ltr`.
	//
	// What loops is `transform` and `opacity`, with one exception that says so: liquid keeps the
	// filter that makes it liquid, and the list marks it as the dear one.
	import type { DownMotion } from '$lib/character/schema';

	let { tone, earned, motion }: { tone: 'good' | 'bad'; earned: number; motion: DownMotion } =
		$props();

	/** How hard the side presses: every motion tightens with the saves it has. */
	const level = $derived(Math.min(2, Math.max(1, earned)));
	let width = $state(0);

	/** Each property cycles on a length of its own, so no two neighbours match and a row never
	 *  reads as a pattern. */
	const cycle = <T,>(values: readonly T[], index: number): T => values[index % values.length] as T;
	const across = (step: number) => Array.from({ length: Math.ceil(width / step) + 2 }, (_, i) => i);

	const flames = $derived(
		across(36).map((i) => ({
			x: i * 36 - 12 + cycle([0, 7, -5, 4, -8], i),
			w: cycle([34, 30, 36, 32, 38, 30], i),
			h: cycle([78, 96, 70, 100, 82, 64, 90], i),
			t: cycle([1.3, 1.7, 1.1, 1.5, 1.9], i),
			wait: cycle([0, 0.4, 0.9, 0.2, 0.7, 1.1, 0.5], i),
		})),
	);
	const embers = $derived(
		across(58).map((i) => ({
			x: i * 58 + cycle([10, 32, 4, 44, 20], i),
			d: cycle([3, 2, 3, 2, 3], i),
			t: cycle([2.6, 3.4, 2.9, 3.8, 3.1, 2.3], i),
			wait: cycle([0, 1.2, 0.6, 2, 1.6, 0.3, 2.4], i),
			sway: cycle([8, -6, 5, -9, 6], i),
		})),
	);
	const shafts = $derived(
		across(46).map((i) => ({
			x: i * 46 - 24 + cycle([0, 12, -8, 6], i),
			w: cycle([26, 12, 34, 16, 28, 12], i),
			lean: cycle([-22, -19, -17, -20, -15], i),
			t: cycle([9, 13, 11, 8, 12, 10], i),
			wait: cycle([0, 4, 7.5, 2.5, 9, 5.5, 1.5], i),
			peak: cycle([0.8, 0.55, 0.7, 0.6, 0.75], i),
		})),
	);
	/** [height along the front %, size px, reach px, pace s, wait s, rise px] */
	const SPARKS = [
		[12, 3, 34, 1.9, 0, -8],
		[34, 4, 52, 2.6, 0.7, 6],
		[55, 3, 40, 2.2, 1.3, -5],
		[72, 4, 58, 3.1, 0.3, 9],
		[90, 3, 36, 2.4, 1.9, -7],
	] as const;
	/** [height %, size px, reach px, pace s, wait s, sway px] */
	const DROPS = [
		[22, 20, 15, 3.1, 0, -4],
		[52, 26, 19, 4.3, 0.8, 5],
		[80, 18, 13, 2.7, 1.5, -3],
		[38, 14, 21, 3.7, 2.1, 4],
	] as const;
	/** [height %, size px, pace s, wait s, sway px] */
	const BUBBLES = [
		[18, 5, 3.4, 0, -6],
		[44, 8, 4.6, 1.1, 5],
		[70, 4, 2.9, 0.5, -3],
		[30, 6, 5.2, 2.3, 7],
		[84, 7, 3.9, 1.7, -5],
		[58, 4, 3.1, 2.9, 4],
	] as const;
	const WAVES = [0, 1, 2];
	const shown = $derived(earned > 0);
	const death = $derived(tone === 'bad');
</script>

{#snippet sparks()}
	{#each SPARKS as [y, d, far, t, wait, rise] (y)}
		<i
			class="spark"
			style="--y:{y}%;--yf:{y /
				100};--d:{d}px;--far:{far}px;--t:{t}s;--wait:-{wait}s;--rise:{rise}px"
		></i>
	{/each}
{/snippet}

<div
	class="side {tone} {motion}"
	data-earned={earned}
	style:--earned={earned}
	style:--level={level}
	bind:clientWidth={width}
	aria-hidden="true"
>
	<div class="push">
		{#if motion === 'liquid'}
			<!-- the body, the swell and the drops are fused by one filter, so where they meet they neck
			     and merge the way a liquid does instead of overlapping like shapes -->
			<svg class="filter-holder" width="0" height="0">
				<filter id="hp-fuse-{tone}" x="-60%" y="-10%" width="220%" height="120%">
					<feGaussianBlur in="SourceGraphic" stdDeviation="5" />
					<feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
				</filter>
			</svg>
			<div class="front body" style:filter="url(#hp-fuse-{tone})">
				<i class="fill"></i>
				{#if shown}
					<i class="swell"></i><i class="swell second"></i>
					{#each DROPS as [y, d, far, t, wait, sway] (y)}
						<i
							class="drop"
							style="--y:{y}%;--d:{d}px;--far:{far}px;--t:{t}s;--wait:-{wait}s;--sway:{sway}px"
						></i>
					{/each}
				{/if}
			</div>
			{#if shown}
				<div class="front">
					{#each BUBBLES as [y, d, t, wait, sway] (y)}
						<i class="bubble" style="--y:{y}%;--d:{d}px;--t:{t}s;--wait:-{wait}s;--sway:{sway}px"
						></i>
					{/each}
				</div>
			{/if}
		{:else}
			<div class="window">
				<div class="scene">
					{#if shown}
						{#if motion === 'hatch'}
							<i class="stripes"></i>
						{:else if motion === 'arrows'}
							<i class="band"></i><i class="band lower"></i>
						{:else if motion === 'rays-hellfire' && death}
							{#each flames as flame, index (index)}
								<i
									class="flame"
									style="--x:{flame.x}px;--w:{flame.w}px;--h:{flame.h}%;--t:{flame.t}s;--wait:-{flame.wait}s"
								></i>
								<i
									class="flame core"
									style="--x:{flame.x + flame.w * 0.25}px;--w:{flame.w * 0.5}px;--h:{flame.h *
										0.6}%;--t:{flame.t * 0.8}s;--wait:-{flame.wait}s"
								></i>
							{/each}
							{#each embers as ember, index (index)}
								<i
									class="ember"
									style="--x:{ember.x}px;--d:{ember.d}px;--t:{ember.t}s;--wait:-{ember.wait}s;--sway:{ember.sway}px"
								></i>
							{/each}
						{:else if motion === 'rays-hellfire'}
							<i class="cloudbreak"></i>
							{#each shafts as shaft, index (index)}
								<i
									class="shaft"
									style="--x:{shaft.x}px;--w:{shaft.w}px;--tilt:{shaft.lean}deg;--t:{shaft.t}s;--wait:-{shaft.wait}s;--peak:{shaft.peak}"
								></i>
							{/each}
						{/if}
					{/if}
				</div>
			</div>
			{#if shown}
				<div class="front">
					{#if motion === 'arrows'}
						<i class="chevron-edge"></i>
					{:else if motion === 'rays-hellfire' && !death}
						<i class="glory"></i>
					{:else if death}
						{#if motion === 'pressure'}
							<i class="shade"></i>
						{:else if motion === 'waves'}
							{#each WAVES as turn (turn)}<i class="wave" style:--turn={turn}></i>{/each}
						{:else if motion === 'burning-edge'}
							<i class="edge"></i><i class="edge second"></i>
							{@render sparks()}
						{:else if motion === 'rays-hellfire'}
							{@render sparks()}
						{/if}
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	/* ---- the geometry every motion stands on ----
	   A side shows `--a + 0.32 × k × (the block's width)`: a third of its 32% of the line per save,
	   and a lean's worth past the last glyph once it has one. The window and the front are wider
	   than the block by that lean, so their own width is what a percentage in a transform means. */
	.side {
		position: absolute;
		inset: 0;
		direction: ltr;
		--pad: var(--space-4);
		--lean: 16px;
		--k: calc(var(--earned) / 3);
		--m: min(1, var(--earned));
		--a: calc(0.36 * var(--k) * var(--pad) + var(--lean) * var(--m));
		--shift: calc(var(--a) - 0.32 * var(--k) * var(--lean) + (0.32 * var(--k) - 1) * 100%);
		/* the same length for a child laid out INSIDE the window or the front, where a percentage is
		   that parent's width */
		--shown: calc(var(--a) + 0.32 * var(--k) * (100% - var(--lean)));
		/* the lean of the front: how far in its top and its bottom stand */
		--top-in: 0px;
		--bottom-in: var(--lean);
		--flow: 0.7s cubic-bezier(0.3, 1.35, 0.5, 1);
	}
	/* the third save takes the whole block, lean and all */
	.side[data-earned='3'] {
		--shift: 0px;
		--shown: 100%;
		--flow: 0.9s cubic-bezier(0.3, 1.1, 0.5, 1);
	}
	.side.good {
		color: var(--color-good);
	}
	/* death is the same side seen in a mirror — with the lean turned over, so the two fronts stay
	   parallel on screen rather than meeting in a point */
	.side.bad {
		color: var(--color-accent);
		transform: scaleX(-1);
		--top-in: var(--lean);
		--bottom-in: 0px;
	}
	.push,
	.scene {
		position: absolute;
		inset: 0;
	}
	.window,
	.front {
		position: absolute;
		inset-block: 0;
		left: 0;
		width: calc(100% + var(--lean));
		transform: translateX(var(--shift));
		transition: transform var(--flow);
	}
	.window {
		background: currentColor;
		clip-path: polygon(
			0 0,
			calc(100% - var(--top-in)) 0,
			calc(100% - var(--bottom-in)) 100%,
			0 100%
		);
	}
	.scene {
		transform: translateX(calc(-1 * var(--shift)));
		transition: transform var(--flow);
	}
	.front {
		pointer-events: none;
	}
	i {
		position: absolute;
		display: block;
	}
	/* a strip that lies along the front: as wide as `--strip`, leaning as the front leans */
	.wave,
	.edge {
		inset-block: 0;
		right: 0;
		width: calc(var(--lean) + var(--strip));
		clip-path: polygon(
			calc(var(--lean) - var(--top-in)) 0,
			calc(100% - var(--top-in)) 0,
			calc(100% - var(--bottom-in)) 100%,
			calc(var(--lean) - var(--bottom-in)) 100%
		);
	}

	/* ---- PRESSURE: death leans in slowly, slips back fast and leans in again, further each
	   failure; ahead of it a shadow reaches across the empty middle and breathes ---- */
	.pressure.bad .push {
		animation: press-in calc(6.2s - var(--level) * 1.7s) infinite;
	}
	@keyframes press-in {
		0% {
			transform: translateX(0);
			animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
		}
		82% {
			transform: translateX(calc(var(--level) * 5px));
			animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
		}
		100% {
			transform: translateX(0);
		}
	}
	.shade {
		inset-block: 0;
		left: calc(100% - var(--lean));
		width: calc(var(--level) * 70px);
		background: linear-gradient(
			to right,
			color-mix(in srgb, currentColor 50%, transparent),
			transparent
		);
		animation: breathe calc(6.2s - var(--level) * 1.7s) ease-in-out infinite alternate;
	}
	@keyframes breathe {
		from {
			opacity: 0.3;
		}
		to {
			opacity: 0.85;
		}
	}

	/* ---- WAVES: the front's own edge peels off it and travels toward the middle, fading; one
	   failure sends them slowly, two send them close together and further ---- */
	.wave {
		--strip: calc(2px + var(--level) * 2px);
		--pace: calc(5.4s - var(--level) * 1.8s);
		background: currentColor;
		opacity: 0;
		animation: wave-out var(--pace) cubic-bezier(0.2, 0.6, 0.4, 1)
			calc(var(--pace) * var(--turn) / -3) infinite;
	}
	@keyframes wave-out {
		0% {
			transform: translateX(0);
			opacity: 0.75;
		}
		100% {
			transform: translateX(calc(var(--level) * 60px));
			opacity: 0;
		}
	}

	/* ---- BURNING EDGE: the front is a blade of light that wavers and never goes out — two layers
	   on paces that do not divide each other — and sparks leave it for the middle ---- */
	.edge {
		--strip: calc(2px + var(--level) * 2px);
		background: color-mix(in srgb, currentColor 35%, var(--color-glint));
		animation: waver 1.3s ease-in-out infinite alternate;
	}
	.edge.second {
		right: -3px;
		animation-duration: 2.1s;
	}
	@keyframes waver {
		from {
			opacity: 0.25;
		}
		to {
			opacity: 1;
		}
	}
	.spark {
		top: var(--y);
		right: calc(var(--top-in) + (var(--bottom-in) - var(--top-in)) * var(--yf));
		width: var(--d);
		height: var(--d);
		background: color-mix(in srgb, currentColor 45%, var(--color-glint));
		opacity: 0;
		animation: spark-out calc(var(--t) / var(--level)) ease-out var(--wait) infinite;
	}
	@keyframes spark-out {
		0% {
			transform: translate(0, 0) rotate(45deg);
			opacity: 1;
		}
		100% {
			transform: translate(calc(var(--level) * var(--far)), var(--rise)) rotate(225deg);
			opacity: 0;
		}
	}

	/* ---- HATCH: stripes cut at the front's own lean march through the ground toward the middle;
	   one period of the pattern is one loop, so it never jumps ---- */
	.stripes {
		inset-block: 0;
		inset-inline: -40px;
		--angle: 97.8deg;
		background: repeating-linear-gradient(
			var(--angle),
			transparent 0 9px,
			color-mix(in srgb, var(--color-bg) 30%, transparent) 9px 16px
		);
		animation: hatch-march calc(3.6s - var(--level) * 1.1s) linear infinite;
	}
	.bad .stripes {
		--angle: 82.2deg;
	}
	.good .stripes {
		animation-duration: 3.6s;
		opacity: 0.6;
	}
	@keyframes hatch-march {
		to {
			transform: translateX(16.15px);
		}
	}

	/* ---- ARROWS: each side is a chevron driven at the other, and chevrons keep marching through
	   it toward the middle — slowly: it is pressure, not speed ---- */
	.side.arrows {
		--lean: 18px;
		/* the point stands in the gap between two glyphs — 3px past the line that divides their
		   thirds — so the earned glyph is wholly on its ground and the next is untouched */
		--a: calc((var(--pad) + 3px) * var(--m) - 0.64 * var(--k) * var(--pad));
	}
	.arrows .window {
		clip-path: polygon(
			0 0,
			calc(100% - var(--lean)) 0,
			100% 50%,
			calc(100% - var(--lean)) 100%,
			0 100%
		);
	}
	/* a marching chevron is two bands of stripes, one leaning each way, meeting on the midline */
	.band {
		top: 0;
		inset-inline: -60px;
		height: 50%;
		--tilt: 65deg;
		background-image: repeating-linear-gradient(
			var(--tilt),
			transparent 0 17px,
			color-mix(in srgb, var(--color-glint) 20%, transparent) 17px 26px
		);
		animation: band-march 2.4s linear infinite;
	}
	.band.lower {
		top: 50%;
		--tilt: 115deg;
	}
	@keyframes band-march {
		to {
			/* how far a stripe set travels sideways to land on itself: its period over sin(65°) */
			transform: translateX(28.69px);
		}
	}
	/* the light edge the chevron is cut with: a band two pixels wide along its point */
	.chevron-edge {
		inset-block: 0;
		right: -2px;
		width: calc(var(--lean) + 2px);
		background: var(--color-text);
		clip-path: polygon(0 0, 2px 0, 100% 50%, 2px 100%, 0 100%, calc(100% - 2px) 50%);
	}

	/* ---- RAYS & HELLFIRE: each side moves as what it is. Rescue is light breaking through cloud —
	   shafts that come, thin and go, each on its own pace — spilling a little past its front. Death
	   is a dark ground on fire: tongues rise from its floor, taller with each failure, embers climb
	   out of it and sparks leave its front for the middle ---- */
	.cloudbreak {
		inset: 0;
		background:
			radial-gradient(
				ellipse 170px 64px at 90px 0,
				color-mix(in srgb, var(--color-glint) 50%, transparent),
				transparent
			),
			radial-gradient(
				ellipse 150px 54px at 330px 0,
				color-mix(in srgb, var(--color-glint) 42%, transparent),
				transparent
			),
			radial-gradient(
				ellipse 180px 60px at 580px 0,
				color-mix(in srgb, var(--color-glint) 50%, transparent),
				transparent
			);
		animation: breathe 7s ease-in-out infinite alternate;
	}
	/* a shaft: soft at both edges, bright where it leaves the cloud and gone before the floor */
	.shaft {
		top: -12%;
		left: var(--x);
		width: var(--w);
		height: 150%;
		--light: color-mix(in srgb, var(--color-glint) 75%, transparent);
		background: linear-gradient(
			to right,
			transparent,
			var(--light) 45%,
			var(--light) 55%,
			transparent
		);
		mask-image: linear-gradient(to bottom, black 15%, transparent 92%);
		rotate: var(--tilt);
		transform-origin: 50% 0;
		opacity: 0;
		animation: shaft-break var(--t) ease-in-out var(--wait) infinite;
	}
	@keyframes shaft-break {
		0% {
			transform: translateX(-7px);
			opacity: 0;
		}
		28% {
			opacity: var(--peak);
		}
		52% {
			opacity: calc(var(--peak) * 0.4);
		}
		72% {
			opacity: var(--peak);
		}
		100% {
			transform: translateX(9px);
			opacity: 0;
		}
	}
	.glory {
		inset-block: 0;
		left: calc(100% - var(--lean));
		width: 70px;
		background: linear-gradient(
			to right,
			color-mix(in srgb, currentColor 45%, transparent),
			transparent
		);
		animation: breathe 4.6s ease-in-out infinite alternate;
	}
	.rays-hellfire.bad .window {
		background: color-mix(in srgb, currentColor 42%, var(--color-death));
	}
	.flame {
		bottom: -6px;
		left: var(--x);
		width: var(--w);
		height: calc(var(--h) * (0.35 + var(--level) * 0.325));
		background: currentColor;
		clip-path: polygon(
			50% 0,
			60% 20%,
			78% 42%,
			92% 68%,
			100% 100%,
			0 100%,
			6% 70%,
			20% 46%,
			30% 30%,
			40% 18%
		);
		transform-origin: 50% 100%;
		animation: flame-lick var(--t) ease-in-out var(--wait) infinite alternate;
	}
	.flame.core {
		background: color-mix(in srgb, currentColor 72%, var(--color-glint));
	}
	@keyframes flame-lick {
		0% {
			transform: scaleY(0.62) skewX(-5deg);
			opacity: 0.75;
		}
		35% {
			transform: scaleY(1) skewX(6deg);
			opacity: 1;
		}
		65% {
			transform: scaleY(0.78) skewX(-7deg);
		}
		100% {
			transform: scaleY(0.94) skewX(4deg);
			opacity: 0.9;
		}
	}
	.ember {
		bottom: 0;
		left: var(--x);
		width: var(--d);
		height: var(--d);
		border-radius: 50%;
		background: color-mix(in srgb, currentColor 40%, var(--color-glint));
		opacity: 0;
		animation: ember-rise calc(var(--t) / var(--level)) ease-out var(--wait) infinite;
	}
	@keyframes ember-rise {
		0% {
			transform: translate(0, 0);
			opacity: 1;
		}
		100% {
			transform: translate(var(--sway), -105px);
			opacity: 0;
		}
	}

	/* ---- LIQUID: each side is a body of liquid. Its surface — the edge facing the other side —
	   is a smooth swell that never lies still, and drops pull out of it and are drawn back ---- */
	.side.liquid {
		--lean: 12px;
	}
	.filter-holder {
		position: absolute;
	}
	.fill {
		inset: 0;
		right: var(--lean);
		background: currentColor;
	}
	/* the swell: a wave cut once into a strip taller than the block, sliding by one period */
	.swell {
		top: -80px;
		bottom: 0;
		left: calc(100% - 2 * var(--lean));
		width: 24px;
		--period: 80px;
		background: currentColor;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='80'%3E%3Cpath d='M0 0H12C22 13.3 22 26.7 12 40C2 53.3 2 66.7 12 80H0Z'/%3E%3C/svg%3E")
			0 0 / 24px var(--period) repeat-y;
		animation: swell 5s linear infinite;
	}
	.swell.second {
		top: -124px;
		--period: 124px;
		animation-duration: 7.5s;
		animation-direction: reverse;
	}
	@keyframes swell {
		to {
			transform: translateY(var(--period));
		}
	}
	/* a drop: it leaves the surface, hangs by a neck, and is taken back */
	.drop {
		top: var(--y);
		left: calc(100% - var(--lean) - var(--d));
		width: var(--d);
		height: var(--d);
		margin-top: calc(var(--d) / -2);
		border-radius: var(--radius-full);
		background: currentColor;
		animation: drop-pull var(--t) ease-in-out var(--wait) infinite alternate;
	}
	@keyframes drop-pull {
		to {
			transform: translate(var(--far), var(--sway));
		}
	}
	/* a bubble's lane is as long as the ground is wide, so a move of its own length carries the
	   bubble from the block's edge to the surface */
	.bubble {
		top: var(--y);
		left: calc(100% - var(--shown));
		width: calc(var(--shown) - var(--lean));
		height: var(--d);
		opacity: 0;
		transform: translateX(-100%);
		animation: bubble-run var(--t) linear var(--wait) infinite;
	}
	.bubble::before {
		content: '';
		position: absolute;
		inset-block: 0;
		right: 0;
		width: var(--d);
		border-radius: var(--radius-full);
		background: color-mix(in srgb, currentColor 58%, var(--color-glint));
	}
	@keyframes bubble-run {
		12% {
			opacity: 0.8;
		}
		82% {
			opacity: 0.8;
		}
		100% {
			opacity: 0;
			transform: translate(0, var(--sway));
		}
	}
</style>
