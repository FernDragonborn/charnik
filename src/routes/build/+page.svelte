<script lang="ts">
	// Build / create — bakes the "Builder Sheet Inspector" mock (docs/builder-plan.md): the character
	// as a LIVE SHEET on the left, and one choice at a time in the inspector on the right. Every
	// changeable thing on the sheet is a click that opens its choice; nothing is picked blind, because
	// the inspector shows what taking an option would do to the sheet before it is taken.
	//
	// A thin shell composing src/routes/build/blocks/*; each block reads the shared `build` view-model.
	// Shared builder CSS lives in $lib/styles/build.css (confined to `.build-page`); block-local CSS
	// stays scoped inside its block.
	import { onMount } from 'svelte';
	import { goto, afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { build } from './build-view-model.svelte';
	import { loadCharacterBySlug } from '$lib/character/store.svelte';
	import { content } from '$lib/content/store.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { _ } from '$lib/i18n';
	import Loading from '$lib/components/Loading.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import '$lib/styles/build.css';
	import BuildHead from './blocks/BuildHead.svelte';
	import SheetOrigin from './blocks/SheetOrigin.svelte';
	import SheetAbilities from './blocks/SheetAbilities.svelte';
	import SheetVitals from './blocks/SheetVitals.svelte';
	import SheetClasses from './blocks/SheetClasses.svelte';
	import SheetDefenses from './blocks/SheetDefenses.svelte';
	import SheetAttacks from './blocks/SheetAttacks.svelte';
	import SheetSpells from './blocks/SheetSpells.svelte';
	import SheetResources from './blocks/SheetResources.svelte';
	import SheetSkills from './blocks/SheetSkills.svelte';
	import SheetFeats from './blocks/SheetFeats.svelte';
	import SheetInventory from './blocks/SheetInventory.svelte';
	import SheetStory from './blocks/SheetStory.svelte';
	import ReviewBar from './blocks/ReviewBar.svelte';
	import Inspector from './blocks/Inspector.svelte';

	const b = build;

	onMount(build.load);

	// the sheet + inspector need the whole viewport width; hand it back on the way out (ARCH: a way
	// in without a way out is a bug).
	$effect(() => {
		ui.fullBleed = true;
		return () => {
			ui.fullBleed = false;
		};
	});

	// Runs on first load AND every navigation (incl. a query-only change on this same route, which
	// doesn't remount): ?edit/?levelup=<slug> hydrates from that character; no param → a fresh draft
	// (so "New character" after a level-up doesn't reopen the last edit).
	afterNavigate(async () => {
		const slug = page.url.searchParams.get('edit') || page.url.searchParams.get('levelup');
		const char = slug ? await loadCharacterBySlug(slug) : null;
		if (char) build.hydrate(char);
		else build.reset();
	});

	// --- the leave guard ------------------------------------------------------------------------
	// A half-built character is not playable, so walking away from one is almost always a misclick.
	// The navigation is cancelled and re-offered as an explicit choice — never a silent block, or the
	// page becomes a room with no door.
	let leaving = $state<(() => void) | null>(null);
	let leaveConfirmed = false;
	let saved = $state(false);
	beforeNavigate((nav) => {
		if (leaveConfirmed || saved || !b.blocking.length || !nav.to) return;
		nav.cancel();
		const href = nav.to.url.href;
		leaving = () => {
			leaveConfirmed = true;
			void goto(href);
		};
	});

	async function create() {
		const id = await build.save();
		if (!id) return;
		saved = true; // the draft became a character — leaving is no longer a loss
		void goto(`${base}/combat`);
	}
</script>

<svelte:head><title>Build — Charnik</title></svelte:head>

{#if content.error}
	<!-- W2: a content-load failure was silent here (empty pickers) — surface it like the other views. -->
	<Loading error={content.error} />
{:else}
	<section class="page build-page">
		<BuildHead />

		<div class="split">
			<div class="sheet scrolly">
				<SheetOrigin />
				<SheetAbilities />
				<SheetVitals />
				<SheetClasses />
				<SheetDefenses />
				<SheetAttacks />
				<SheetSpells />
				<SheetResources />
				<SheetSkills />
				<SheetFeats />
				<SheetInventory />
				<SheetStory />
				<ReviewBar {create} />
			</div>

			<aside class="inspector scrolly" aria-label={$_('build.inspector.label')}>
				<Inspector />
			</aside>
		</div>
	</section>
{/if}

{#if leaving}
	<ConfirmDialog
		title={$_('build.leave.title')}
		message={$_('build.leave.message', { values: { count: b.blocking.length } })}
		confirmLabel={$_('build.leave.confirm')}
		danger
		onConfirm={() => leaving?.()}
		onCancel={() => (leaving = null)}
	/>
{/if}

<style>
	/* the page owns the viewport height; each pane scrolls on its own (min-height:0), so the sheet
	   can be long without pushing the inspector off-screen. */
	.build-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.split {
		display: grid;
		/* The inspector holds a list AND a full compendium article, so a fixed width is wrong at both
		   ends: it was cramped on a wide screen and would crowd the sheet on a narrow one. It takes a
		   share of the window instead, floored so the article never squeezes and capped so the sheet
		   never becomes the smaller pane. */
		grid-template-columns: minmax(0, 1fr) clamp(520px, 40vw, 880px);
		gap: 16px;
		flex: 1;
		min-height: 0;
	}
	.sheet {
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: auto;
		min-height: 0;
		padding-right: 4px;
	}
	.inspector {
		border-left: 1px solid var(--color-border);
		background: var(--color-bg);
		overflow: auto;
		min-height: 0;
		padding-left: 16px;
	}

	/* under ~1100px the inspector can't hold a list and a diff side by side with the sheet — it moves
	   below, still a full pane rather than a squeezed column. */
	@media (max-width: 1100px) {
		.build-page {
			height: auto;
		}
		.split {
			grid-template-columns: 1fr;
		}
		.sheet,
		.inspector {
			overflow: visible;
		}
		.inspector {
			border-left: 0;
			border-top: 1px solid var(--color-border);
			padding-left: 0;
			padding-top: 16px;
		}
	}
</style>
