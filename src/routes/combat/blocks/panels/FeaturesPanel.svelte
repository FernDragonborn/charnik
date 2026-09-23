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
	//
	// PINNED features lift into a group of their own above the sections, the way a pinned spell does,
	// and do not repeat below — a row in two places is two answers to where it is. Everything else
	// keeps its section, because a section IS the grouping; what a player may now override is the
	// order INSIDE one.
	import { _ } from '$lib/i18n';
	import { app } from '$lib/stores/app.svelte';
	import { combat } from '../../combat-view-model.svelte';
	import { localizedName } from '$lib/content/detail';
	import { describedProse } from '$lib/content/overrides.svelte';
	import { localizedProse } from '$lib/content/prose';
	import ArticleProse from '$lib/components/ArticleProse.svelte';
	import OwnWords from '$lib/components/OwnWords.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import RowGrip from '../RowGrip.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { ROW_PANEL } from '$lib/combat/row-order';
	import {
		FEATURE_SECTION,
		type CharacterFeature,
		type FeatureSection,
	} from '$lib/character/features';

	/** The pinned group's key — not a FeatureSection, because it is not a source, it is a choice. */
	const PINNED = 'pinned';

	// reading order: what a player looks up most often first
	const ORDER: FeatureSection[] = [
		FEATURE_SECTION.classFeatures,
		FEATURE_SECTION.speciesTraits,
		FEATURE_SECTION.background,
		FEATURE_SECTION.feats,
	];
	const features = $derived(combat.featureView.visible);
	const idOf = (f: CharacterFeature) => f.row.effectiveId;
	const nameOf = (f: CharacterFeature) => localizedName(f.row, app.activeLocale);
	/** Which feature's rewrite editor is open, by row. Keyed rather than a single flag: the panel is a
	 *  list of independent <details>, and a player may have more than one expanded. Bound through a
	 *  getter/setter pair, since a key that has never been written reads `undefined` and `bind:` will
	 *  not hand that to a prop with a fallback. */
	const rewriting = $state<Record<string, boolean>>({});
	/** The pinned group first, then the sections with their pinned members removed. One saved order
	 *  serves them all: `ordered` sorts each group's own members by it, and a group a player has never
	 *  dragged keeps the reading order it was gathered in. */
	const groups = $derived(
		[
			{ key: PINNED, items: features.filter((f) => combat.featureView.isPinned(idOf(f))) },
			...ORDER.map((key) => ({
				key,
				items: features.filter(
					(f: CharacterFeature) => f.section === key && !combat.featureView.isPinned(idOf(f)),
				),
			})),
		]
			.map((g) => ({ key: g.key, items: combat.layout.ordered(ROW_PANEL.features, g.items, idOf) }))
			.filter((g) => g.items.length),
	);

	/** A drag rewrites ONE group; the saved order is the flat concatenation of every group after it,
	 *  so one array keeps serving all of them. */
	function reorder(groupKey: string, ids: string[]) {
		combat.layout.setRowOrder(
			ROW_PANEL.features,
			groups.flatMap((g) => (g.key === groupKey ? ids : g.items.map(idOf))),
		);
	}
	/** The row being dragged, per group — the item carries its feature, so the shadow row renders. */
	let dragging = $state<{ key: string; items: { id: string; f: CharacterFeature }[] } | null>(null);
	const itemsFor = (g: { key: string; items: CharacterFeature[] }) =>
		dragging?.key === g.key ? dragging.items : g.items.map((f) => ({ id: idOf(f), f }));
</script>

{#each groups as group (group.key)}
	<div class="feature-section eyebrow">{$_(`combat.features.${group.key}`)}</div>
	<div
		class="dnd-rows"
		use:dndzone={{
			items: itemsFor(group),
			type: 'feature-row',
			flipDurationMs: 150,
			dropTargetStyle: {},
			morphDisabled: true,
		}}
		onconsider={(e) => (dragging = { key: group.key, items: e.detail.items })}
		onfinalize={(e) => {
			dragging = null;
			reorder(
				group.key,
				e.detail.items.map((i) => i.id),
			);
		}}
	>
		{#each itemsFor(group) as item (item.id)}
			{@const f = item.f}
			{@const prose = describedProse(f.row, app.activeLocale)}
			{@const id = idOf(f)}
			<div class="row-wrap">
				<RowGrip
					panel={ROW_PANEL.features}
					{id}
					name={nameOf(f)}
					onmove={(by) => combat.layout.moveRow(ROW_PANEL.features, group.items.map(idOf), id, by)}
				/>
				<details class="feature-item">
					<summary>
						<!-- the class level a feature arrived at. A multiclass sheet needs the class too, or
						     "3" names nothing; a trait or a feat has no level and gets no chip. -->
						{#if f.at !== undefined}<span class="feature-level" title={f.className}>{f.at}</span
							>{/if}
						<span class="feature-name">{nameOf(f)}</span>
						<!-- the pin is a real button beside the name, not inside the summary's click: a
						     control nested in a control is what cost the keyboard its walk before -->
						<button
							class="feature-pin"
							class:on={combat.featureView.isPinned(id)}
							aria-pressed={combat.featureView.isPinned(id)}
							title={$_(
								combat.featureView.isPinned(id) ? 'combat.features.unpin' : 'combat.features.pin',
							)}
							aria-label={$_(
								combat.featureView.isPinned(id) ? 'combat.features.unpin' : 'combat.features.pin',
							)}
							onclick={(e) => {
								e.preventDefault();
								combat.featureView.togglePinned(id);
							}}
							><Icon
								name="star"
								size={12}
								{...combat.featureView.isPinned(id) ? { fill: 'currentColor' } : {}}
							/></button
						>
					</summary>
					<!-- ArticleProse, not a plain <p>: a feature's text is Markdown in user-owned CSV, and
			     printing it stripped collapsed every blank line into one wall of a paragraph. The
			     EffectsPanel's ⓘ already reuses it for the same reason (UBUG-7). -->
					<!-- the same rewrite control the compendium article carries, and BEFORE the prose so its
			     floated pencil lands at the text's top-right. This is where a feature is actually READ
			     — mid-session, on the panel — so a table's own wording has to be reachable from here
			     and not only from the browsing view. `original` is the SHIPPED prose, never `prose`:
			     that one is already the override. -->
					<div class="feature-prose">
						<OwnWords
							rowId={id}
							original={localizedProse(f.row, 'text', app.activeLocale)}
							bind:rewriting={() => rewriting[id] ?? false, (open) => (rewriting[id] = open)}
						/>
						{#if !rewriting[id]}
							{#if prose}<ArticleProse bodyMarkdown={prose} />{:else}<p class="feature-none">
									{$_('combat.features.noText')}
								</p>{/if}
						{/if}
					</div>
				</details>
			</div>
		{/each}
	</div>
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
	/* the grip sits BESIDE the row, never inside it (RowGrip's own comment) */
	.row-wrap {
		display: flex;
		align-items: flex-start;
		gap: var(--space-1);
	}
	.row-wrap > .feature-item {
		flex: 1;
		min-width: 0;
	}
	/* quiet until the row is under the pointer, loud once a feature IS pinned — a star at full
	   strength on every row is a column of stars */
	.feature-pin {
		margin-inline-start: auto;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
	}
	.feature-item:hover .feature-pin,
	.feature-pin:focus-visible,
	.feature-pin.on {
		opacity: 1;
	}
	.feature-pin.on {
		color: var(--color-resource);
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
		padding: 0 var(--space-2) var(--space-2) calc(1.4em + var(--space-2));
		font-size: var(--font-size-xs);
		line-height: 1.55;
		color: var(--color-text-muted);
	}
	/* ArticleProse's .body trails a bottom margin on its last block, which doubles the padding here */
	.feature-prose :global(.body > :last-child),
	.feature-none {
		margin-bottom: 0;
	}
	.feature-none {
		margin-top: 0;
	}
	.feature-empty {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
