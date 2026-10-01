<script lang="ts">
	// What a feat asks back once it is on the character: the +1 a half-feat grants, the skills a
	// Skilled-shaped feat hands out, and the spell list a Magic-Initiate-shaped one draws from. All
	// three are driven by the feat's own columns (`ability_choice`, `skill_choice`, `spell_choice*`),
	// so a homebrew feat asking any of them just works.
	//
	// ONE component for both keys a choice can hang off — a level's slot, and the background's granted
	// origin feat. The questions a feat asks do not depend on how it arrived, and written twice they
	// drift: the origin feat's copy did not exist at all, so Skilled granted nothing.
	import { _ } from '$lib/i18n';
	import { abilityShortLabel } from '$lib/util/format';
	import { build, rowName, ASI } from '../build-view-model.svelte';
	import { skillLabel } from '../rows';
	import { SKILL_ABILITY } from '$lib/character/skills';
	import { TOOL_PREFIX } from '$lib/character/granted-proficiency';
	import { provenance } from '$lib/actions/provenance';
	const b = build;
	const SKILLS = Object.keys(SKILL_ABILITY);

	/** The slot key, or `ORIGIN_SLOT_KEY` — whichever the choices are stored under. */
	let { choiceKey }: { choiceKey: string } = $props();

	const ref = $derived(b.feats.featRefFor(choiceKey));
	const halfOpts = $derived(ref && ref !== ASI ? b.feats.halfFeatOptionsFor(choiceKey) : []);
	const skillCount = $derived(ref && ref !== ASI ? b.feats.featSkillCountOf(ref) : 0);
	const offersTools = $derived(ref && ref !== ASI ? b.feats.featChoiceOffersTools(ref) : false);
	const picks = $derived(b.feats.slotFeatSkillsFor(choiceKey));
	/* §D. Only the two questions the feat itself asks — WHICH list and WHICH ability. The spells then
	   come off the Spells pane, because a chosen list makes this feat a caster profile like any other
	   and a second spell picker here would be the same list twice. */
	const spellLists = $derived(b.feats.featSpellListsFor(choiceKey));
	const spellAbilities = $derived(b.feats.featSpellAbilitiesFor(choiceKey));
	const spellChoice = $derived(b.feats.featSpellChoiceFor(choiceKey));
	/** A pinned list with a real ability question behind it is STATED, not offered as a lone chip. */
	const listIsStated = $derived(spellLists.length === 1 && spellAbilities.length > 1);
</script>

{#if halfOpts.length}
	<div class="alloc">
		<span class="eyebrow">{$_('build.feats.halfFeatAsk', { values: { feat: rowName(b.row(ref)) } })}</span>
		<div class="chips">
			{#each halfOpts as ab (ab)}
				<button
					class="pick-chip"
					class:on={b.draft.slotFeatAbility[choiceKey] === ab}
					onclick={() => b.feats.setSlotFeatAbility(choiceKey, ab)}>{abilityShortLabel(ab, $_)}</button
				>
			{/each}
		</div>
	</div>
{/if}

{#if spellLists.length}
	{#if listIsStated}
		<!-- one list and it is not the player's: a background grants "Magic Initiate (Cleric)", so the
		     list is stated and only the ability is asked. -->
		<span class="eyebrow"
			>{$_('build.feats.spellListFixed', { values: { list: rowName(spellLists[0]) } })}</span
		>
	{:else}
		<div class="alloc">
			<span class="eyebrow">{$_('build.feats.spellListAsk')}</span>
			<div class="chips">
				{#each spellLists as list (list.effectiveId)}
					{@const on = spellChoice?.list === list.id}
					<!-- RAW for a repeatable spell feat: a second one must name a different list. Strict
					     blocks the duplicate; Free lets it through, like every other cap here. -->
					{@const blocked =
						b.draft.strict && b.feats.featSpellListTakenElsewhere(choiceKey, list.id) && !on}
					<button
						class="pick-chip"
						class:on
						class:dim={blocked}
						disabled={blocked}
						onclick={() => b.feats.setFeatSpellList(choiceKey, list.id)}>{rowName(list)}</button
					>
				{/each}
			</div>
		</div>
	{/if}
	{#if spellAbilities.length > 1 && (spellChoice || listIsStated)}
		<div class="alloc">
			<span class="eyebrow">{$_('build.feats.spellAbilityAsk')}</span>
			<div class="chips">
				{#each spellAbilities as ab (ab)}
					<button
						class="pick-chip"
						class:on={spellChoice?.ability === ab}
						onclick={() => b.feats.setFeatSpellAbility(choiceKey, ab)}
						>{abilityShortLabel(ab, $_)}</button
					>
				{/each}
			</div>
		</div>
	{/if}
	{#if spellChoice}
		<span class="eyebrow gold">{$_('build.feats.spellsInPane')}</span>
	{/if}
{/if}

{#snippet proficiencyChip(pick: string, label: string)}
	{@const on = picks.includes(pick)}
	<!-- blocked only by ANOTHER source already granting it. Being at the cap is not a block: a click
	     there replaces the oldest pick, so the grant is never a dead end. `aria-disabled`, so the chip
	     can still be reached to say why (ui.md ▸ rule 10); the refusal itself is the view-model's. -->
	{@const blocked = b.draft.strict && b.feats.featSkillTakenElsewhere(choiceKey, pick) && !on}
	<button
		class="pick-chip"
		aria-pressed={on}
		class:on
		class:dim={blocked}
		aria-disabled={blocked ? true : undefined}
		use:provenance={blocked ? $_('build.feats.proficiencyHeldElsewhere') : ''}
		onclick={() => b.feats.toggleSlotFeatSkill(choiceKey, pick, skillCount)}
	>
		{label}
	</button>
{/snippet}

{#if skillCount > 0}
	<div class="alloc">
		<span class="eyebrow">
			{$_(offersTools ? 'build.feats.skillOrToolGrant' : 'build.feats.skillGrant', {
				values: { chosen: Math.min(picks.length, skillCount), cap: skillCount }
			})}
		</span>
		<div class="chips">
			{#each SKILLS as skill (skill)}
				{@render proficiencyChip(skill, skillLabel(skill, $_))}
			{/each}
		</div>
		{#if offersTools}
			<!-- the same grant, the same count: a tool taken here is one of the feat's picks, which is
			     what the SRD's "any combination of skills or tools" says -->
			<div class="chips" role="group" aria-label={$_('build.tools.label')}>
				{#each b.toolList as row (row.effectiveId)}
					{@render proficiencyChip(`${TOOL_PREFIX}${row.id}`, rowName(row))}
				{/each}
			</div>
		{/if}
	</div>
{/if}
