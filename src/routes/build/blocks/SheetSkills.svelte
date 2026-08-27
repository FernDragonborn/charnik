<script lang="ts">
	// Skills, in two columns grouped by ability — the same rows the inspector's skills pane shows,
	// because a skill is trained in exactly one place (SkillRows). The head carries the two counts
	// that decide whether you are finished: class picks and expertise.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import SkillRows from './SkillRows.svelte';
	const b = build;
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.skills.title')}</span>
		<span class="spacer"></span>
		{#if b.classSkillCount > 0}
			<span class="trail" class:open={b.skillChosenCount < b.classSkillCount}>
				{$_('build.skills.classPicks', {
					values: { chosen: b.skillChosenCount, cap: b.classSkillCount }
				})}
			</span>
		{/if}
		{#if b.autoSkills.length}<span class="trail"
				>{$_('build.skills.fromBackground', { values: { count: b.autoSkills.length } })}</span
			>{/if}
		{#if b.expertiseCap > 0}
			<span class="trail"
				>{$_('build.skills.expertise', {
					values: { used: b.expertiseUsed, cap: b.expertiseCap }
				})}</span
			>
		{/if}
		<button
			class="pill-btn"
			class:accent={b.inspector.isOpen({ id: 'skills' })}
			onclick={() => b.inspector.toggle({ id: 'skills' })}
			>{$_('build.skills.whichCanITake')}</button
		>
	</div>
	<SkillRows columns={2} />
</div>
