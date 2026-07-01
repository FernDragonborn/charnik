<script lang="ts">
	// Combat sheet — the first LIVE screen: a demo character run through the full pipeline
	// (content graph → rules core → effects engine → deriveSheet). Every number is computed,
	// and its provenance shows on hover. Real character loading/editing lands next.
	import { onMount } from 'svelte';
	import { loadDemo } from '$lib/demo/sheet';
	import { deriveSheet, type CharacterSheet, SKILL_ABILITY } from '$lib/character/derive';
	import type { Character } from '$lib/character/schema';
	import type { Computed } from '$lib/rules/pipeline';

	let sheet = $state<CharacterSheet | null>(null);
	let character = $state<Character | null>(null);

	onMount(async () => {
		const demo = await loadDemo();
		character = demo.character;
		sheet = deriveSheet(demo.character, demo.graph);
	});

	const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
	const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

	/** Format a Computed's trace for the hover tooltip. */
	function why(c: Computed): string {
		const parts = c.trace
			.filter((t) => t.amount !== 0 || t.op === 'set')
			.map(
				(t) =>
					`${t.source} ${t.op === 'set' ? '= ' : ''}${signed(t.amount)}${t.note ? ` (${t.note})` : ''}`
			);
		const notes = c.notes?.length ? ' · ' + c.notes.join(' · ') : '';
		return (parts.join(', ') || 'no contributions') + notes;
	}
</script>

<svelte:head><title>Combat — Charnik</title></svelte:head>

{#if !sheet || !character}
	<p class="loading">Computing sheet…</p>
{:else}
	{@const s = sheet}
	<header class="hero">
		<div>
			<p class="eyebrow">Combat · live demo</p>
			<h1>{character.build.name}</h1>
			<p class="sub">
				Wizard {s.level} · <span class="sys">{character.system}</span>
			</p>
		</div>
		<div class="hp" title={why(s.maxHp)}>
			<span class="hp-cur">{character.play.hp.current}</span><span class="hp-max"
				>/ {s.maxHp.value}</span
			>
			<span class="hp-lbl">Hit points</span>
		</div>
	</header>

	<section class="tiles" aria-label="Core stats">
		<div class="tile" title={why(s.ac)}>
			<span class="t-lbl">AC</span><span class="t-val">{s.ac.value}</span>
		</div>
		<div class="tile" title={why(s.initiative)}>
			<span class="t-lbl">Init</span><span class="t-val">{signed(s.initiative.value)}</span>
		</div>
		<div class="tile" title={why(s.speed)}>
			<span class="t-lbl">Speed</span><span class="t-val">{s.speed.value}<small>ft</small></span>
		</div>
		<div class="tile">
			<span class="t-lbl">Prof</span><span class="t-val">{signed(s.proficiencyBonus)}</span>
		</div>
		{#if s.spellcasting}
			<div class="tile" title={why(s.spellcasting.saveDC)}>
				<span class="t-lbl">Spell DC</span><span class="t-val">{s.spellcasting.saveDC.value}</span>
			</div>
			<div class="tile" title={why(s.spellcasting.attack)}>
				<span class="t-lbl">Spell atk</span><span class="t-val"
					>{signed(s.spellcasting.attack.value)}</span
				>
			</div>
		{/if}
	</section>

	<section class="abilities" aria-label="Ability scores">
		{#each ABILITY_ORDER as ab (ab)}
			{@const a = s.abilities[ab]}
			<div class="ab">
				<div class="ab-top">
					<span class="ab-name">{ab}</span><span class="ab-score">{a.score}</span>
				</div>
				<span class="ab-mod">{signed(a.mod)}</span>
				<span
					class="ab-save"
					class:prof={a.save.trace.some((t) => t.layer === 'proficiency')}
					title={why(a.save)}
				>
					save {signed(a.save.value)}
				</span>
			</div>
		{/each}
	</section>

	<section class="strip" aria-label="Passive senses">
		<span title={why(s.passives.perception)}
			>Passive Perception <b>{s.passives.perception.value}</b></span
		>
		<span title={why(s.passives.investigation)}
			>Investigation <b>{s.passives.investigation.value}</b></span
		>
		<span title={why(s.passives.insight)}>Insight <b>{s.passives.insight.value}</b></span>
		<span title={why(s.carryingCapacity)}>Capacity <b>{s.carryingCapacity.value}</b> lb</span>
	</section>

	<section class="skills" aria-label="Skills">
		<h2>Skills</h2>
		<ul>
			{#each Object.keys(SKILL_ABILITY) as skill (skill)}
				{@const sk = s.skills[skill]}
				<li class:prof={sk.proficient} title={why(sk)}>
					<span class="sk-dot" aria-hidden="true"></span>
					<span class="sk-name">{skill.replace(/-/g, ' ')}</span>
					<span class="sk-ab">{SKILL_ABILITY[skill]}</span>
					<span class="sk-val">{signed(sk.value)}</span>
				</li>
			{/each}
		</ul>
	</section>

	{#if s.missing.length}
		<p class="missing">Missing content: {s.missing.join(', ')}</p>
	{/if}
	<p class="hint">
		Hover any value to see how it's computed. This is a demo character; real character loading is
		next.
	</p>
{/if}

<style>
	.loading {
		color: var(--color-text-muted);
		padding: var(--space-6);
		text-align: center;
	}
	.hero {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}
	.eyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: var(--font-size-xs);
		color: var(--color-accent);
		margin: 0;
	}
	.hero h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-2xl);
		margin: var(--space-1) 0;
	}
	.sub {
		color: var(--color-text-muted);
		margin: 0;
	}
	.sys {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
	}
	.hp {
		text-align: right;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-4);
		background: var(--color-surface);
	}
	.hp-cur {
		font-family: var(--font-display);
		font-size: var(--font-size-2xl);
		color: var(--color-accent);
	}
	.hp-max {
		color: var(--color-text-muted);
		margin-left: var(--space-1);
	}
	.hp-lbl {
		display: block;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-text-muted);
	}
	.tiles {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
	}
	.tile {
		flex: 1 1 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		cursor: help;
	}
	.t-lbl {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-text-muted);
	}
	.t-val {
		font-family: var(--font-display);
		font-size: var(--font-size-xl);
	}
	.t-val small {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.abilities {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	@media (max-width: 640px) {
		.abilities {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.ab {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	.ab-top {
		display: flex;
		justify-content: space-between;
		width: 100%;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}
	.ab-name {
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		color: var(--color-text-muted);
	}
	.ab-mod {
		font-family: var(--font-display);
		font-size: var(--font-size-2xl);
		line-height: 1;
	}
	.ab-save {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		cursor: help;
	}
	.ab-save.prof {
		color: var(--color-resource, var(--color-accent));
	}
	.strip {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-bottom: var(--space-4);
	}
	.strip b {
		color: var(--color-text);
	}
	.skills h2 {
		font-family: var(--font-display);
		font-size: var(--font-size-lg);
		margin: 0 0 var(--space-2);
	}
	.skills ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 2px var(--space-4);
	}
	@media (max-width: 640px) {
		.skills ul {
			grid-template-columns: 1fr;
		}
	}
	.skills li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		cursor: help;
	}
	.skills li:hover {
		background: var(--color-surface-2);
	}
	.sk-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1px solid var(--color-border-strong);
	}
	.skills li.prof .sk-dot {
		background: var(--color-resource, var(--color-accent));
		border-color: var(--color-resource, var(--color-accent));
	}
	.sk-name {
		text-transform: capitalize;
		flex: 1;
	}
	.sk-ab {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.sk-val {
		font-family: var(--font-mono);
		min-width: 2ch;
		text-align: right;
	}
	.missing {
		color: var(--color-danger, crimson);
		font-size: var(--font-size-sm);
	}
	.hint {
		margin-top: var(--space-5);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
</style>
