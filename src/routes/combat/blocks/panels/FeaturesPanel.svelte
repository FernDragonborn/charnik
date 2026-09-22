<script lang="ts">
	// Features panel body: what this character HAS, to read. Class features by the level they were
	// gained at, then species traits, background and feats — separate sections, never one blob
	// (plan.md ▸ Character sheet fields).
	//
	// It reads `characterFeatures`, NOT the sheet's effect list: the gather keeps only rows carrying
	// effect tokens, so a feature made purely of prose — which is most of them — never reaches it.
	//
	// Each row is a native <details>: the player expands the one they are looking up and the rest stay
	// out of the way. Native because it is already everything this needs — keyboard-operable, Enter
	// takes, no state to hold — and a scripted accordion would only re-implement it worse.
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { combat } from '../../combat-view-model.svelte';
	import { localizedName } from '$lib/content/detail';
	import { describedPlainProse } from '$lib/content/overrides.svelte';
	import {
		FEATURE_SECTION,
		type CharacterFeature,
		type FeatureSection,
	} from '$lib/character/features';

	// reading order: what a player looks up most often first
	const ORDER: FeatureSection[] = [
		FEATURE_SECTION.classFeatures,
		FEATURE_SECTION.speciesTraits,
		FEATURE_SECTION.background,
		FEATURE_SECTION.feats,
	];
	const features = $derived(combat.features);
	const sections = $derived(
		ORDER.map((key) => ({
			key,
			items: features.filter((f: CharacterFeature) => f.section === key),
		})).filter((s) => s.items.length),
	);
</script>

{#each sections as section (section.key)}
	<div class="feature-section eyebrow">{$_(`combat.features.${section.key}`)}</div>
	{#each section.items as f, i (`${f.row.effectiveId}:${f.at ?? ''}:${i}`)}
		{@const prose = describedPlainProse(f.row, app.activeLocale)}
		<details class="feature-item">
			<summary>
				<!-- the class level a feature arrived at. A multiclass sheet needs the class too, or "3"
				     names nothing; a trait or a feat has no level and gets no chip. -->
				{#if f.at !== undefined}<span class="feature-level" title={f.className}>{f.at}</span>{/if}
				<span class="feature-name">{localizedName(f.row, app.activeLocale)}</span>
			</summary>
			<p class="feature-prose">{prose || $_('combat.features.noText')}</p>
		</details>
	{/each}
{:else}
	<p class="feature-empty">{$_('combat.features.empty')}</p>
{/each}

<style>
	.feature-section {
		font-size: var(--font-size-micro);
		color: var(--color-text-muted);
		padding: var(--space-2) 0 var(--space-1);
	}
	.feature-section:not(:first-child) {
		border-top: 1px solid var(--color-border);
		margin-top: var(--space-1);
	}
	.feature-item summary {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1-5) var(--space-2);
		margin: 0 calc(-1 * var(--space-2));
		border-radius: var(--radius);
		cursor: pointer;
		list-style: none;
	}
	/* the disclosure triangle is Safari's own and sits outside the flex row; the row's own layout
	   already says what is expandable */
	.feature-item summary::-webkit-details-marker {
		display: none;
	}
	.feature-item summary:hover {
		background: var(--color-surface-2);
	}
	.feature-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.feature-level {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-resource);
		min-width: 1.4em;
		text-align: end;
	}
	.feature-prose {
		margin: 0;
		padding: 0 var(--space-2) var(--space-2) calc(1.4em + var(--space-2));
		font-size: var(--font-size-xs);
		line-height: 1.55;
		color: var(--color-text-muted);
	}
	.feature-empty {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
