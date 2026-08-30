<script lang="ts">
	// Skills, in two columns grouped by ability — the same rows the inspector's skills pane shows,
	// because a skill is trained in exactly one place (SkillRows). The head carries the two counts
	// that decide whether you are finished: class picks and expertise.
	import { _ } from '$lib/i18n';
	import { build } from '../build-view-model.svelte';
	import SkillRows from './SkillRows.svelte';
	import SkillCounts from './SkillCounts.svelte';
	const b = build;
</script>

<div class="card">
	<div class="card-head">
		<span class="eyebrow">{$_('build.skills.title')}</span>
		<!-- names the two number columns; without it the second one is an unexplained integer -->
		<span class="trail">{$_('build.skills.columns')}</span>
		<span class="spacer"></span>
		<SkillCounts badge="trail" />
		<button
			class="pill-btn"
			class:accent={b.inspector.isOpen({ id: 'skills' })}
			onclick={() => b.inspector.toggle({ id: 'skills' })}
			>{$_('build.skills.whichCanITake')}</button
		>
	</div>
	<SkillRows columns={2} />
</div>
