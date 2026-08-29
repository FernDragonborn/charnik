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
	import { goto, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { build } from './build-view-model.svelte';
	import { loadCharacterBySlug } from '$lib/character/store.svelte';
	import { loadDraft } from '$lib/character/draft-repository';
	import { getUserStorage } from '$lib/storage/provider';
	import { content } from '$lib/content/store.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { _ } from '$lib/i18n';
	import Loading from '$lib/components/Loading.svelte';
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
	// doesn't remount): ?edit/?levelup=<slug> hydrates from that character, ?draft=<guid> resumes an
	// unfinished build; no param → a fresh draft (so "New character" after a level-up doesn't reopen
	// the last edit).
	afterNavigate(async () => {
		const slug = page.url.searchParams.get('edit') || page.url.searchParams.get('levelup');
		const guid = page.url.searchParams.get('draft');
		const char = slug ? await loadCharacterBySlug(slug) : null;
		if (char) build.hydrate(char);
		else if (guid) {
			const record = await loadDraft(getUserStorage(), guid);
			if (record) build.hydrateDraft(record);
			else build.reset(); // deleted from another window, or hand-edited into nonsense
		} else build.reset();
	});

	// Autosave. A half-built character is the thing people lose, and the leave guard only covers
	// leaving on purpose — it cannot help with a crash, a closed tab, or a reload. Reading a deep
	// snapshot is what subscribes this to every field of the draft; the delay keeps a name being
	// typed from becoming one write per keystroke.
	const AUTOSAVE_DELAY_MS = 600;
	$effect(() => {
		$state.snapshot(b.draft);
		const timer = setTimeout(() => void build.persistDraft(), AUTOSAVE_DELAY_MS);
		return () => clearTimeout(timer);
	});

	// There is no leave guard any more. It existed because walking away lost the build; the draft is
	// now on disk and waiting in the roster, so a dialog saying otherwise would simply be wrong.
	async function create() {
		const id = await build.save();
		if (!id) return;
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
				<!-- Skills at full width left a wide hole down its middle: 18 rows in two columns simply
				     do not need 690px. Paired with the feat slots, which are few and short, the leftover
				     room lands BELOW the shorter card instead of inside the taller one. -->
				<div class="sheet-pair">
					<SheetSkills />
					<SheetFeats />
				</div>
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
	/* skills is the taller and denser of the two, so it takes the larger share; `start` keeps the
	   short card short instead of stretching it to match. */
	.sheet-pair {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		gap: 14px;
		align-items: start;
	}
	@media (max-width: 900px) {
		.sheet-pair {
			grid-template-columns: 1fr;
		}
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
