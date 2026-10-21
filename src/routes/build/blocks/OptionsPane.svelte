<script lang="ts">
	// What a class feature has the character choose — a Pact Boon, the Eldritch Invocations. One
	// group per feature that asks, chips like every other capped grant in the builder: the count is
	// the feature's own ladder, and at the cap a click replaces the oldest pick. Each chip says the
	// option's own text on hover and on focus, because nothing here is picked blind.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import { describedPlainProse } from '$lib/content/overrides.svelte';
	import { localizedName } from '$lib/content/detail';
	import { provenance } from '$lib/actions/provenance';
	import { app } from '$lib/stores/app.svelte';
	import type { OptionRow } from '$lib/content/options';
	import type { FeatureChoice } from '../option-picks.svelte';
	const b = build;

	const choices = $derived(b.optionPicks.choices);
	// an option that asks (2024 Agonizing Blast: which cantrip) opens a row of its answers under the
	// chips; each answer is a pick of its own, so the same option may be held once per cantrip
	let opened = $state<string | null>(null);
	const pressOption = (choice: FeatureChoice, option: OptionRow) => {
		if (option.data.answer) opened = opened === option.effectiveId ? null : option.effectiveId;
		else b.optionPicks.toggle(choice, option);
	};
	const nameOf = (id: string | undefined): string => {
		const option = b.optionPicks.optionById(id);
		return option ? localizedName(option, app.activeLocale) : (id ?? '');
	};
</script>

{#if !choices.length}
	<p class="subtext">{$_('build.options.none')}</p>
{:else}
	{#each choices as choice (choice.feature.effectiveId)}
		<div class="counts">
			<span class={['tag', choice.picks.length < choice.cap && 'accent']}>
				{localizedName(choice.feature, app.activeLocale)}
				{choice.picks.length}/{choice.cap}
			</span>
		</div>
		{#if choice.options.length}
			<div class="chips">
				{#each choice.options as option (option.effectiveId)}
					{@const block = b.optionPicks.blockOf(choice, option)}
					<!-- a prerequisite that is not met is said on the chip, and the chip stays focusable so
					     its text can still be read: `aria-disabled`, never `disabled` -->
					{@const taken = b.optionPicks.answersTaken(choice, option).length}
					<button
						class="pick-chip"
						class:on={b.optionPicks.holds(choice, option)}
						aria-disabled={!b.optionPicks.canToggle(choice, option)}
						aria-expanded={option.data.answer ? opened === option.effectiveId : undefined}
						use:provenance={describedPlainProse(option, app.activeLocale)}
						onclick={() => pressOption(choice, option)}
					>
						{localizedName(option, app.activeLocale)}{#if taken > 1}<span class="why">×{taken}</span
							>{/if}{#if block !== null}<span class="why"
								>{$_(`build.options.block.${block}`, {
									values: {
										level: option.data.level ?? 0,
										option: nameOf(option.data.requires),
										feature: localizedName(
											b.optionPicks.takenElsewhere(choice, option)?.feature ?? choice.feature,
											app.activeLocale,
										),
									},
								})}</span
							>{/if}
					</button>
				{/each}
			</div>
			{#each choice.options.filter((option) => option.effectiveId === opened) as option (option.effectiveId)}
				{@const answers = b.optionPicks.answersFor(choice, option)}
				{@const taken = b.optionPicks.answersTaken(choice, option)}
				<p class="subtext">
					{$_('build.options.answerFor', {
						values: { option: localizedName(option, app.activeLocale) },
					})}
				</p>
				{#if answers.length}
					<div class="chips">
						{#each answers as spell (spell.effectiveId)}
							<button
								class="pick-chip"
								class:on={taken.includes(spell.id)}
								aria-disabled={!taken.includes(spell.id) &&
									!b.optionPicks.canToggle(choice, option)}
								onclick={() => b.optionPicks.toggleAnswer(choice, option, spell.id)}
							>
								{localizedName(spell, app.activeLocale)}
							</button>
						{/each}
					</div>
				{:else}
					<p class="subtext">{$_(`build.options.noAnswers.${option.data.answer}`)}</p>
				{/if}
			{/each}
		{:else}
			<p class="subtext">{$_('build.options.noRows')}</p>
		{/if}
	{/each}
{/if}

<style>
	/* the reason sits beside the name, quieter than it; the gap is the separator, as on the mastery
	   chips */
	.why {
		margin-inline-start: var(--space-1-5);
		color: var(--color-text-muted);
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1-5);
		margin-top: var(--space-2);
	}
</style>
