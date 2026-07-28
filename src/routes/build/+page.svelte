<script lang="ts">
	// Build / create — bakes design-preview/d-build.html: two-column card editor (Origin · Classes ·
	// Proficiencies · Ability boosts & feats | Ability scores · Spells · Inventory) with a full-width
	// review/create bar. A thin shell composing src/routes/build/blocks/*; each block binds to the
	// shared `build` view-model. Shared builder CSS lives in $lib/styles/build.css (confined to
	// `.build-page`); card-local CSS is scoped inside each block.
	import { onMount } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { build } from './state.svelte';
	import { loadCharacterBySlug } from '$lib/character/store.svelte';
	import { content } from '$lib/content/store.svelte';
	import Loading from '$lib/components/Loading.svelte';
	import '$lib/styles/build.css';
	import BuildHead from './blocks/BuildHead.svelte';
	import OriginCard from './blocks/OriginCard.svelte';
	import ClassesCard from './blocks/ClassesCard.svelte';
	import ProficienciesCard from './blocks/ProficienciesCard.svelte';
	import FeatsCard from './blocks/FeatsCard.svelte';
	import AbilityScoresCard from './blocks/AbilityScoresCard.svelte';
	import SpellsCard from './blocks/SpellsCard.svelte';
	import InventoryCard from './blocks/InventoryCard.svelte';
	import ReviewBar from './blocks/ReviewBar.svelte';

	onMount(build.load);

	// Runs on first load AND every navigation (incl. a query-only change on this same route, which
	// doesn't remount): ?edit/?levelup=<slug> hydrates from that character; no param → a fresh draft
	// (so "New character" after a level-up doesn't reopen the last edit).
	afterNavigate(async () => {
		const slug = page.url.searchParams.get('edit') || page.url.searchParams.get('levelup');
		const char = slug ? await loadCharacterBySlug(slug) : null;
		if (char) build.hydrate(char);
		else build.reset();
	});

	async function create() {
		const id = await build.save();
		if (id) goto(`${base}/combat`);
	}
</script>

<svelte:head><title>Build — Charnik</title></svelte:head>

{#if content.error}
	<!-- W2: a content-load failure was silent here (empty pickers) — surface it like the other views. -->
	<Loading error={content.error} />
{:else}
<section class="page build-page">
	<BuildHead />

	<div class="cols">
		<div class="column">
			<OriginCard />
			<ClassesCard />
			<ProficienciesCard />
			<FeatsCard />
		</div>

		<div class="column">
			<AbilityScoresCard />
			<SpellsCard />
			{#if !build.edit}<InventoryCard />{/if}
		</div>
	</div>

	<ReviewBar {create} />
</section>
{/if}

<style>
	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
		align-items: start;
	}
	.column {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	@media (max-width: 760px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
</style>
