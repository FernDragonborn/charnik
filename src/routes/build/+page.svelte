<script lang="ts">
	// Build / create (docs/internals/ui.md ▸ "The builder is a live sheet, not a form"): the character
	// as a LIVE SHEET on the left, and one choice at a time in the inspector on the right. Every
	// changeable thing on the sheet is a click that opens its choice; nothing is picked blind, because
	// the inspector shows what taking an option would do to the sheet before it is taken.
	//
	// A thin shell composing src/routes/build/blocks/*; each block reads the shared `build` view-model.
	// Shared builder CSS lives in $lib/styles/build.css (confined to `.build-page`); block-local CSS
	// stays scoped inside its block.
	import { goto, afterNavigate } from '$app/navigation';
	import { toast } from 'svelte-sonner';
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
		// The graph is loaded HERE rather than beside this in `onMount`, because hydrate needs it and
		// two unawaited starts race: `hydrate` subtracts the boosts the restored feat slots re-derive,
		// those slots come from the class's `asi_levels`, and with no graph the fallback levels hide a
		// slot the class really grants. Nothing is subtracted, the slot then adds its boost again, and
		// the character gains +2 every time it is opened.
		await build.load();
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

	// Autosave. A half-built character is the thing people lose, and the two ways they lose it — a
	// crash and a closed tab — are the two no dialog can catch. Reading a deep snapshot is what
	// subscribes this to every field of the draft; the delay keeps a name being typed from becoming
	// one write per keystroke.
	const AUTOSAVE_DELAY_MS = 600;
	$effect(() => {
		$state.snapshot(b.draft);
		const timer = setTimeout(() => {
			// one settled change is one step of history, which is why this rides the same debounce: a
			// name being typed becomes one thing to take back rather than one per keystroke
			build.history.record();
			void build.drafts.persist();
		}, AUTOSAVE_DELAY_MS);
		return () => clearTimeout(timer);
	});

	// Ctrl/Cmd+Z and Ctrl+Shift+Z / Ctrl+Y over the whole draft. Bound to the physical key (`code`),
	// and deliberately NOT taken from a text field: a caret in the name box has the browser's own
	// undo stack, which is the right one while you are typing in it.
	$effect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
			if (event.target instanceof Element && event.target.closest('input, textarea')) return;
			const redo = event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey);
			if (!redo && event.code !== 'KeyZ') return;
			event.preventDefault();
			if (redo) build.history.redo();
			else build.history.undo();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// There is no leave guard any more. It existed because walking away lost the build; the draft is
	// now on disk and waiting in the roster, so a dialog saying otherwise would simply be wrong.
	async function create() {
		const wasEdit = Boolean(build.edit);
		const id = await build.save();
		if (!id) return;
		// a save that only navigates leaves the player guessing whether it took — the failure path has
		// said so all along, and the success path said nothing (playtest feedback)
		toast.success($_(wasEdit ? 'build.notice.saved' : 'build.notice.created'));
		void goto(`${base}/combat`);
	}
</script>

<svelte:head><title>{$_('nav.build')} — Charnik</title></svelte:head>

{#if !build.graph}
	<!-- A content-load failure was silent here (empty pickers) — surface it like other views. The gate
	     is a MISSING graph, not `content.error`: a FAILED REFRESH leaves the working graph in place and
	     sets the error beside it, and blanking the builder mid-build over a transient listing failure
	     is the one screen a user cannot afford to lose. The error still renders, as a reason. -->
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
		gap: var(--space-4);
		flex: 1;
		min-height: 0;
	}
	.sheet {
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: auto;
		min-height: 0;
		padding-inline-end: var(--space-1);
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
		/* minmax(0, …) rather than a bare 1fr: a bare one floors at the track's min-content, so the
		   widest card in the pair set a floor the phone viewport could not meet and the whole sheet
		   overflowed sideways. */
		.sheet-pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	/* A fixed-height box, NOT a scroll container: a wheel goes to the innermost scrollable ancestor
	   under the pointer, so a scrolling column around a scrolling list makes "scroll the inspector"
	   unreachable wherever the list happens to be (ui.md §1). Exactly one region inside the pane
	   scrolls, and the pane picks which. */
	.inspector {
		border-inline-start: 1px solid var(--color-border);
		background: var(--color-bg);
		overflow: hidden;
		min-height: 0;
		padding-inline-start: var(--space-4);
	}

	/* under ~1100px the inspector can't hold a list and a diff side by side with the sheet — it moves
	   below, still a full pane rather than a squeezed column. */
	@media (max-width: 1100px) {
		.build-page {
			height: auto;
		}
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
		.sheet,
		.inspector {
			overflow: visible;
		}
		.inspector {
			border-inline-start: 0;
			border-top: 1px solid var(--color-border);
			padding-inline-start: 0;
			padding-top: var(--space-4);
		}
	}
</style>
