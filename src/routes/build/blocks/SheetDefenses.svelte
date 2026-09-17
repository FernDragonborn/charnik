<script lang="ts">
	// Saving throws, and what this character is trained in or shrugs off. Two read-outs that share a
	// row because they answer one question: what happens to you when something happens TO you.
	// Every number carries its provenance on hover.
	//
	// Passive scores are NOT here: the sheet has one for every skill (`derive.ts` `passives`), so they
	// read in the skill list beside the check they belong to, rather than in a card that could only
	// ever show three of eighteen.
	import { _ } from '$lib/i18n';
	import { build, rowName, rowOfType } from '../build-view-model.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { abilityShortLabel, signed, titleCase } from '$lib/util/format';
	import { why } from '$lib/combat/effects-view';
	import { provenance } from '$lib/actions/provenance';
	import { damageTypeLabel } from '$lib/combat/attacks';
	import { gatherProfGrants, withGrantedProfs, UNCONSTRAINED } from '$lib/rules/proficiency';
	import { grantedEquipmentProfs } from '$lib/character/derive-stats';
	import { splitList } from '$lib/content/schemas';
	const b = build;

	const s = $derived(b.sheet);
	const classRows = $derived(
		b.draft.classes.map((c) => rowOfType(b.row(c.classId), 'class')).filter((r) => !!r)
	);


	/** "all · shields" reads better than a list of category words, and an undeclared class means
	 *  proficient with everything (the lenient default the rules layer already uses). A feature's own
	 *  grant (Life Domain's heavy armour) is folded in here too, or the card would contradict the
	 *  attack rows that already honour it. */
	const DASH = '—';
	function profText(raw: (string | undefined)[], granted: string[]): string {
		if (!classRows.length) return DASH;
		const grants = withGrantedProfs(gatherProfGrants(raw), granted);
		if (grants === UNCONSTRAINED) return $_('build.defenses.all');
		if (!grants.size) return $_('build.defenses.none');
		return [...grants].map((g) => titleCase(g)).join(' · ');
	}

	const granted = $derived(s ? grantedEquipmentProfs(s.facts) : { armor: [], weapons: [] });
	const armor = $derived(profText(classRows.map((r) => r.data.armor_profs), granted.armor));
	const weapons = $derived(profText(classRows.map((r) => r.data.weapon_profs), granted.weapons));
	const tools = $derived(
		[
			...splitList(b.backgroundRow?.data.tools).map((t) => titleCase(t)),
			...b.draft.customTools,
		].join(' · '),
	);
	// what the content granted and what the player typed read as ONE list: the sheet is asked "what do
	// I speak", and where the word came from is not part of that answer
	const languages = $derived(
		[
			...b.draft.selectedLanguages.map((ref) => rowName(b.row(ref))),
			...b.draft.customLanguages,
		]
			.filter(Boolean)
			.join(' · '),
	);
	const defenses = $derived(s?.damageSensitivities ?? { resist: [], immune: [], vulnerable: [] });
	const hasDefenses = $derived(
		defenses.resist.length + defenses.immune.length + defenses.vulnerable.length > 0
	);
</script>

{#if s}
	<div class="row3">
		<div class="card">
			<div class="card-head">
				<span class="eyebrow">{$_('build.defenses.saves')}</span>
				<span class="spacer"></span>
				<span class="trail"
					>{ABILITIES.filter((a) => s.abilities[a].saveProficient)
						.map((a) => abilityShortLabel(a, $_))
						.join(' · ') || $_('build.defenses.noneProficient')}</span
				>
			</div>
			<div class="saves">
				{#each ABILITIES as ab (ab)}
					{@const block = s.abilities[ab]}
					<div class="save" class:is-taken={block.saveProficient} use:provenance={why(block.save, $_)}>
						<span class="code">{abilityShortLabel(ab, $_)}</span>
						<b>{signed(block.save.value)}</b>
					</div>
				{/each}
			</div>
		</div>

		<div class="card">
			<div class="card-head"><span class="eyebrow">{$_('build.defenses.trained')}</span></div>
			<div class="facts">
				<b>{$_('build.defenses.armour')}</b><span>{armor}</span>
				<b>{$_('build.defenses.weapons')}</b><span>{weapons}</span>
				<b>{$_('build.defenses.tools')}</b><span>{tools || DASH}</span>
				<b>{$_('build.defenses.languages')}</b><span>{languages || DASH}</span>
			</div>
			<div class="chips tags">
				<!-- fly/swim moved here when the passive-senses card went: they are things you shrug off
				     gravity or water with, and this card is already "what is true of your body". -->
				{#if s.flySpeed.value}<span class="tag gold"
						>{$_('build.defenses.fly', { values: { feet: s.flySpeed.value } })}</span
					>{/if}
				{#if s.swimSpeed.value}<span class="tag gold"
						>{$_('build.defenses.swim', { values: { feet: s.swimSpeed.value } })}</span
					>{/if}
				{#if hasDefenses}
					{#each defenses.resist as d (d)}<span class="tag gold"
							>{$_('build.defenses.resists', { values: { type: damageTypeLabel(d, $_) } })}</span
						>{/each}
					{#each defenses.immune as d (d)}<span class="tag gold"
							>{$_('build.defenses.immuneTo', { values: { type: damageTypeLabel(d, $_) } })}</span
						>{/each}
					{#each defenses.vulnerable as d (d)}<span class="tag accent"
							>{$_('build.defenses.vulnerableTo', { values: { type: damageTypeLabel(d, $_) } })}</span
						>{/each}
				{:else}
					<span class="tag ghost">{$_('build.defenses.noResistances')}</span>
				{/if}
				<button
					class="pill-btn"
					class:accent={b.inspector.isOpen({ id: 'languages' })}
					onclick={() => b.inspector.toggle({ id: 'languages' })}
					>{$_('build.defenses.editLanguages')}</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.row3 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 14px;
		align-items: start;
	}
	.saves {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
		gap: var(--space-1-5);
	}
	.save {
		display: flex;
		align-items: baseline;
		gap: var(--space-1-5);
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: var(--radius);
		padding: var(--space-1-5) var(--space-2);
	}
	.save.is-taken b {
		color: var(--color-resource);
	}
	.save .code {
		flex: 1;
		font-family: var(--font-mono);
		font-size: var(--font-size-micro);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.save b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-sm);
	}
	/* layout is the global .chips; what stays here is where this one sits */
	.tags {
		margin-top: var(--space-2-5);
		align-items: center;
	}
</style>
