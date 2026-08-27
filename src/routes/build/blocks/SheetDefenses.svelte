<script lang="ts">
	// Saving throws, passive senses, and what this character is trained in or shrugs off. Three
	// read-outs that share a row because they answer one question: what happens to you when something
	// happens TO you. Every number carries its provenance on hover.
	import { _ } from '$lib/i18n';
	import { build, rowName, rowOfType } from '../build-view-model.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { signed, titleCase } from '$lib/util/format';
	import { why } from '$lib/combat/effects-view';
	import { gatherProfGrants, UNCONSTRAINED } from '$lib/rules/proficiency';
	import { splitList } from '$lib/content/schemas';
	const b = build;

	const s = $derived(b.sheet);
	const classRows = $derived(
		b.draft.classes.map((c) => rowOfType(b.row(c.classId), 'class')).filter((r) => !!r)
	);

	/** "all · shields" reads better than a list of category words, and an undeclared class means
	 *  proficient with everything (the lenient default the rules layer already uses). */
	const DASH = '—';
	function profText(raw: (string | undefined)[]): string {
		if (!classRows.length) return DASH;
		const grants = gatherProfGrants(raw);
		if (grants === UNCONSTRAINED) return $_('build.defenses.all');
		if (!grants.size) return $_('build.defenses.none');
		return [...grants].map((g) => titleCase(g.replace(/_/g, ' '))).join(' · ');
	}

	const armor = $derived(profText(classRows.map((r) => r.data.armor_profs)));
	const weapons = $derived(profText(classRows.map((r) => r.data.weapon_profs)));
	const tools = $derived(
		splitList(b.backgroundRow?.data.tools)
			.map((t) => titleCase(t))
			.join(' · ')
	);
	const languages = $derived(
		b.draft.selectedLanguages.map((ref) => rowName(b.row(ref))).filter(Boolean).join(' · ')
	);
	const defenses = $derived(s?.defenses ?? { resist: [], immune: [], vulnerable: [] });
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
						.map((a) => a.toUpperCase())
						.join(' · ') || $_('build.defenses.noneProficient')}</span
				>
			</div>
			<div class="saves">
				{#each ABILITIES as ab (ab)}
					{@const block = s.abilities[ab]}
					<div class="save" class:prof={block.saveProficient} title={why(block.save)}>
						<span class="code">{ab}</span>
						<b>{signed(block.save.value)}</b>
					</div>
				{/each}
			</div>
		</div>

		<div class="card">
			<div class="card-head"><span class="eyebrow">{$_('build.defenses.passiveSenses')}</span></div>
			<div class="passives">
				{#each ['perception', 'insight', 'investigation'] as const as id (id)}
					<div class="tile" title={why(s.passives[id])}>
						<b>{s.passives[id].value}</b><small>{titleCase(id)}</small>
					</div>
				{/each}
			</div>
			{#if s.flySpeed.value || s.swimSpeed.value}
				<div class="tags">
					{#if s.flySpeed.value}<span class="tag gold"
							>{$_('build.defenses.fly', { values: { feet: s.flySpeed.value } })}</span
						>{/if}
					{#if s.swimSpeed.value}<span class="tag gold"
							>{$_('build.defenses.swim', { values: { feet: s.swimSpeed.value } })}</span
						>{/if}
				</div>
			{/if}
		</div>

		<div class="card">
			<div class="card-head"><span class="eyebrow">{$_('build.defenses.trained')}</span></div>
			<div class="facts">
				<b>{$_('build.defenses.armour')}</b><span>{armor}</span>
				<b>{$_('build.defenses.weapons')}</b><span>{weapons}</span>
				<b>{$_('build.defenses.tools')}</b><span>{tools || DASH}</span>
				<b>{$_('build.defenses.languages')}</b><span>{languages || DASH}</span>
			</div>
			<div class="tags">
				{#if hasDefenses}
					{#each defenses.resist as d (d)}<span class="tag gold"
							>{$_('build.defenses.resists', { values: { type: d } })}</span
						>{/each}
					{#each defenses.immune as d (d)}<span class="tag gold"
							>{$_('build.defenses.immuneTo', { values: { type: d } })}</span
						>{/each}
					{#each defenses.vulnerable as d (d)}<span class="tag accent"
							>{$_('build.defenses.vulnerableTo', { values: { type: d } })}</span
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
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 14px;
		align-items: start;
	}
	.saves {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
		gap: 6px;
	}
	.save {
		display: flex;
		align-items: baseline;
		gap: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-2);
		border-radius: var(--radius);
		padding: 6px 9px;
	}
	.save.prof {
		border-color: var(--color-resource-line);
		background: var(--color-resource-soft);
	}
	.save.prof b {
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
	.passives {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
	}
	.passives .tile {
		background: var(--color-surface-2);
		padding: 8px 4px;
	}
	.passives .tile b {
		font-size: var(--font-size-md);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
		align-items: center;
	}
</style>
