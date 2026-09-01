<script lang="ts">
	// The three numbers that decide whether the skills are finished: class picks made, skills the
	// background handed over, expertise spent.
	//
	// The sheet card and the inspector pane both show them, and both are on screen at once — so the
	// conditions and the catalog keys live here and only the dressing differs. The sheet says them as
	// trailing notes in a card head; the pane says them as tags.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	const b = build;

	let { badge }: { badge: 'tag' | 'trail' } = $props();
	/** What "there is still room here" looks like in each dressing. */
	const lit = $derived(badge === 'tag' ? 'accent' : 'open');
</script>

{#if b.skillPicks.classSkillCount > 0}
	<span class={[badge, b.skillPicks.chosenCount < b.skillPicks.classSkillCount && lit]}>
		{$_('build.skills.classPicks', {
			values: { chosen: b.skillPicks.chosenCount, cap: b.skillPicks.classSkillCount }
		})}
	</span>
{/if}
{#if b.skillPicks.autoSkills.length}
	<!-- gold, because these are granted rather than chosen — the tag dressing has a gold variant and
	     the card head's trailing note does not -->
	<span class={[badge, badge === 'tag' && 'gold']}>
		{$_('build.skills.fromBackground', { values: { count: b.skillPicks.autoSkills.length } })}
	</span>
{/if}
{#if b.skillPicks.expertiseCap > 0}
	<span class={badge}>
		{$_('build.skills.expertise', { values: { used: b.skillPicks.expertiseUsed, cap: b.skillPicks.expertiseCap } })}
	</span>
{/if}
