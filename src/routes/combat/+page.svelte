<script lang="ts">
	// Combat sheet — the agreed d-charnik design, baked into Svelte and fed live data
	// (content graph → rules core → effects engine → deriveSheet). Structure/typography/
	// colour follow design-preview/d-charnik.html; every number is computed with provenance.
	import { onMount } from 'svelte';
	import { demoCharacter } from '$lib/demo/sheet';
	import { getContentGraph } from '$lib/content/provider';
	import { deriveSheet, type CharacterSheet, SKILL_ABILITY } from '$lib/character/derive';
	import { fullCasterSlots, type Ability } from '$lib/rules/core';
	import type { ContentGraph } from '$lib/content/loader';
	import type { Character } from '$lib/character/schema';
	import type { Computed } from '$lib/rules/pipeline';

	let graph = $state<ContentGraph | null>(null);
	let character = $state<Character | null>(null);
	let sheet = $state<CharacterSheet | null>(null);
	let round = $state(1);

	onMount(async () => {
		graph = await getContentGraph();
		character = demoCharacter();
		sheet = deriveSheet(character, graph);
	});

	const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
	const metres = (ft: number) => `${(ft * 0.3048).toFixed(1).replace(/\.0$/, '')} m`;
	function why(c: Computed): string {
		const parts = c.trace
			.filter((t) => t.amount !== 0 || t.op === 'set')
			.map(
				(t) =>
					`${t.source} ${t.op === 'set' ? '= ' : ''}${signed(t.amount)}${t.note ? ` (${t.note})` : ''}`
			);
		return (parts.join(', ') || '—') + (c.notes?.length ? ' · ' + c.notes.join(' · ') : '');
	}

	const ABIL: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
	const ABILITY_NAME: Record<Ability, string> = {
		str: 'Strength',
		dex: 'Dexterity',
		con: 'Constitution',
		int: 'Intelligence',
		wis: 'Wisdom',
		cha: 'Charisma'
	};

	// className label
	const className = $derived(character && graph ? classLabel() : '');
	function classLabel(): string {
		const c = character!.build.classes[0];
		const row = graph!.get(c.class);
		return row ? `${row.data.name_en} ${c.level}` : `Level ${sheet?.level ?? ''}`;
	}
	const speciesName = $derived.by(() => {
		if (!character?.build.species || !graph) return '';
		return String(graph.get(character.build.species)?.data.name_en ?? '');
	});

	// --- attacks from equipped weapons ---
	interface Atk {
		name: string;
		toHit: string;
		dmg: string;
		meta: string;
	}
	const attacks = $derived.by<Atk[]>(() => {
		if (!character || !sheet || !graph) return [];
		const prof = sheet.proficiencyBonus;
		const strMod = sheet.abilities.str.mod,
			dexMod = sheet.abilities.dex.mod;
		const out: Atk[] = [];
		for (const inv of character.build.inventory) {
			if (!inv.equipped) continue;
			const row = graph.get(inv.item);
			if (!row || row.data.category !== 'weapon') continue;
			const props = String(row.data.properties ?? '').toLowerCase();
			const ranged = String(row.data.item_type ?? '').includes('ranged');
			const finesse = props.includes('finesse');
			const mod = ranged ? dexMod : finesse ? Math.max(strMod, dexMod) : strMod;
			const dmg = String(row.data.damage ?? '');
			out.push({
				name: String(row.data.name_en),
				toHit: signed(mod + prof),
				dmg: `${dmg} ${signed(mod)} ${row.data.damage_type ?? ''}`.trim(),
				meta: [row.data.item_type, props.split(/[,;]/)[0]].filter(Boolean).join(' · ')
			});
		}
		return out;
	});

	// --- spells grouped by level ---
	interface SpRow {
		name: string;
		spe: string;
		res: 'hit' | 'save' | 'auto' | '';
		resLabel: string;
		tm: string;
		prep: 'on' | 'always' | '';
	}
	interface SpGroup {
		level: number;
		label: string;
		slots: { full: number; spent: number };
		rows: SpRow[];
	}
	const spellGroups = $derived.by<SpGroup[]>(() => {
		if (!character || !graph) return [];
		const casterLevel = sheet?.level ?? 1;
		const slots = fullCasterSlots(casterLevel);
		const byLevel = new Map<number, SpRow[]>();
		for (const sp of character.build.spells) {
			const row = graph.get(sp.spell);
			if (!row) continue;
			const lvl = Number(row.data.level);
			const res = String(row.data.resolution ?? 'none');
			const rtag: SpRow['res'] =
				res === 'attack' ? 'hit' : res === 'save' ? 'save' : res === 'auto' ? 'auto' : '';
			const resLabel =
				res === 'attack'
					? 'attack roll'
					: res === 'save'
						? `${row.data.save_ability} save`
						: res === 'auto'
							? 'auto-hit'
							: '';
			const r: SpRow = {
				name: String(row.data.name_en),
				spe: String(row.data.damage || '') || shortHint(String(row.data.text_en ?? '')),
				res: rtag,
				resLabel,
				tm:
					(lvl === 0 ? 'cantrip' : `${ordinal(lvl)}`) +
					castingSuffix(String(row.data.casting_time ?? '')),
				prep: sp.alwaysPrepared ? 'always' : sp.prepared ? 'on' : ''
			};
			(byLevel.get(lvl) ?? byLevel.set(lvl, []).get(lvl)!).push(r);
		}
		const groups: SpGroup[] = [];
		for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
			groups.push({
				level: lvl,
				label: lvl === 0 ? 'Cantrips' : ordinal(lvl),
				slots: {
					full: lvl === 0 ? 0 : (slots[lvl - 1] ?? 0),
					spent: Number(character.play.spellSlotsSpent[String(lvl)] ?? 0)
				},
				rows: byLevel.get(lvl)!
			});
		}
		return groups;
	});
	const ordinal = (n: number) =>
		`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;
	const castingSuffix = (ct: string) =>
		/bonus/i.test(ct) ? ' · bonus' : /reaction/i.test(ct) ? ' · react' : '';
	const shortHint = (t: string) => (t.split(/[.。]/)[0] || '').slice(0, 22) || 'utility';

	// HP bar widths
	const hpBar = $derived.by(() => {
		if (!character || !sheet) return { cur: 0, tmp: 0 };
		const max = character.play.hp.max ?? sheet.maxHp.value;
		return {
			cur: Math.max(0, Math.min(100, (character.play.hp.current / max) * 100)),
			tmp: (character.play.hp.temp / max) * 100
		};
	});
	const conc = $derived(
		character?.play.effects.find((e) => e.label.toLowerCase().includes('bless') || false)
	);
</script>

<svelte:head><title>Combat — Charnik</title></svelte:head>

{#if !sheet || !character}
	<p class="loading">Computing sheet…</p>
{:else}
	{@const s = sheet}
	{@const c = character}
	<section class="hero">
		<div>
			<div class="eyebrow">{className}{speciesName ? ` · ${speciesName}` : ''}</div>
			<h1>{c.build.name}</h1>
			<div class="subl">
				Level <b>{s.level}</b> · <span class="sysx">{c.system}</span> · Proficiency
				<b>{signed(s.proficiencyBonus)}</b>
			</div>
		</div>
		<div class="hp">
			<div class="lab"><span>Hit points</span><button class="temptag">＋ Temp HP</button></div>
			<div class="val" title={why(s.maxHp)}>
				{c.play.hp.current}<small> / {c.play.hp.max ?? s.maxHp.value}</small>
				{#if c.play.hp.temp > 0}<span class="temp">+{c.play.hp.temp} temp</span>{/if}
			</div>
			<div class="bar">
				<i class="cur" style="width:{hpBar.cur}%"></i><i class="tmp" style="width:{hpBar.tmp}%"></i>
			</div>
		</div>
	</section>

	<section class="controls">
		<button class="toggle" class:on={c.play.inspiration}
			>✦ Inspiration <span class="sw">{c.play.inspiration ? 'ON' : 'OFF'}</span></button
		>
		{#if conc}<button class="toggle conc on"
				>◈ Concentration <span class="sw">{conc.label}</span></button
			>{/if}
		<button class="toggle">＋ Condition</button>
		<span class="spacer"></span>
		<button class="toggle auto on">⚙ Auto-calc <span class="sw">ON</span></button>
		<button class="toggle dice">🎲 Dice tray</button>
	</section>

	<section class="turnbar">
		<span class="lbl">Turn</span>
		<span class="ae">Action <span class="aepips"><i class="aedot"></i></span></span>
		<span class="ae">Bonus <span class="aepips"><i class="aedot"></i></span></span>
		<span class="ae">Reaction <span class="aepips"><i class="aedot"></i></span></span>
		<span class="ae move">🦶 Move <b>{s.speed.value}</b> / {s.speed.value} ft</span>
		<span class="spacer"></span>
		<span class="roundc"
			><button class="rstep" onclick={() => (round = Math.max(1, round - 1))}>‹</button>⟳ Round {round}<button
				class="rstep"
				onclick={() => (round += 1)}>›</button
			></span
		>
		<button class="nextturn">Next turn ▸</button>
	</section>

	<div class="sectlab">Combat</div>
	<section class="combat">
		<div class="tile" title={why(s.ac)}>
			<div class="k">Armor class</div>
			<div class="v">{s.ac.value}</div>
			<div class="t">{s.ac.trace.map((x) => `${x.source} ${signed(x.amount)}`).join(' ')}</div>
		</div>
		<div class="tile" title={why(s.initiative)}>
			<div class="k">Initiative</div>
			<div class="v">{signed(s.initiative.value)}</div>
			<div class="t">DEX <b>{signed(s.abilities.dex.mod)}</b></div>
		</div>
		<div class="tile" title={why(s.speed)}>
			<div class="k">Speed</div>
			<div class="v">{s.speed.value} ft<small> ({metres(s.speed.value)})</small></div>
			<div class="t">base walk</div>
		</div>
	</section>
	<div class="senses-strip">
		<span class="lbl">Passive senses</span>
		<span class="sv" title={why(s.passives.perception)}
			><i>Perception</i>{s.passives.perception.value}</span
		><span class="sdot">·</span>
		<span class="sv" title={why(s.passives.investigation)}
			><i>Investigation</i>{s.passives.investigation.value}</span
		><span class="sdot">·</span>
		<span class="sv" title={why(s.passives.insight)}><i>Insight</i>{s.passives.insight.value}</span>
		<button class="edit">✎ Pin skills</button>
	</div>

	<div class="sectlab">Abilities <em>tap to roll a check or save · click a value to edit</em></div>
	<section class="grid">
		{#each ABIL as ab (ab)}
			{@const a = s.abilities[ab]}
			{@const prof = a.save.trace.some((t) => t.layer === 'proficiency')}
			<div class="ab">
				<div class="n"><b>{ab.toUpperCase()}</b> · {a.score}</div>
				<div class="m">{a.mod < 0 ? '−' + Math.abs(a.mod) : a.mod === 0 ? '0' : '+' + a.mod}</div>
				<div class="sv" class:prof title={why(a.save)}>
					<i class="pdot" class:on={prof}></i>SAVE
					<b>{a.save.value < 0 ? '−' + Math.abs(a.save.value) : signed(a.save.value)}</b>
				</div>
			</div>
		{/each}
	</section>

	<section class="panels">
		<!-- Skills -->
		<div class="card">
			<h2>Skills</h2>
			<div class="sklgrid">
				{#each ABIL as ab (ab)}
					{@const list = Object.keys(SKILL_ABILITY).filter((k) => SKILL_ABILITY[k] === ab)}
					{#if list.length}
						<div class="catblock">
							<div class="ssec">{ABILITY_NAME[ab]}</div>
							{#each list as skill (skill)}
								{@const sk = s.skills[skill]}
								<div class="skl" title={why(sk)}>
									<i class="pdot" class:on={sk.proficient}></i>
									<span class="sn"
										>{skill.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}</span
									>
									<b class="sm"
										>{sk.value < 0
											? '−' + Math.abs(sk.value)
											: sk.value === 0
												? '0'
												: '+' + sk.value}</b
									>
								</div>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
			<p class="trace" style="margin-top:10px">
				<i class="pdot on"></i> proficient · tap a skill to roll
			</p>
		</div>

		<!-- Attacks -->
		{#if attacks.length}
			<div class="card">
				<h2>Attacks</h2>
				{#each attacks as at (at.name)}
					<div class="atk">
						<span class="an">{at.name}</span><span class="ah">{at.toHit}</span>
						<span class="ad">{at.dmg}</span><span class="am">{at.meta}</span>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Effects & conditions -->
		{#if c.play.effects.length}
			<div class="card">
				<div class="ph2">
					<h2>Effects &amp; conditions</h2>
					<span class="grpby">＋ Add</span>
				</div>
				{#each c.play.effects as e (e.iid)}
					<div class="eff" class:pos={e.positive} class:neg={!e.positive}>
						<span class="d"></span>
						<div class="body">
							<b>{e.label}</b>
							{#if e.effects.length}<small
									>{e.effects.join(' · ')}{e.durationRounds
										? ` · ${e.durationRounds} rounds`
										: ''}</small
								>{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Spells -->
		{#if s.spellcasting && spellGroups.length}
			<div class="card">
				<div class="ph2"><h2>Spells</h2></div>
				<div class="castline">
					Spell save DC <b>{s.spellcasting.saveDC.value}</b> · spell attack
					<b>{signed(s.spellcasting.attack.value)}</b> — same for every spell
				</div>
				{#each spellGroups as g (g.level)}
					<div class="scat">
						{g.label}
						{#if g.slots.full > 0}
							<span class="pips">
								{#each Array(g.slots.full) as _, i (i)}<span
										class="pip"
										class:full={i >= g.slots.spent}
										class:spent={i < g.slots.spent}
									></span>{/each}
							</span>
						{/if}
					</div>
					{#each g.rows as r (r.name)}
						<div class="sprow">
							<span class="an"
								><i class="prep" class:on={r.prep === 'on'} class:always={r.prep === 'always'}
								></i>{r.name}</span
							>
							<span class="spe">{r.spe}</span>
							{#if r.res}<span class="rtag {r.res}">{r.resLabel}</span>{:else}<span></span>{/if}
							<span class="tm">{r.tm}</span>
						</div>
					{/each}
				{/each}
				<p class="trace" style="margin-top:11px">tap a slot pip to spend / restore</p>
			</div>
		{/if}
	</section>
{/if}

<style>
	.loading {
		color: var(--color-text-muted);
		padding: var(--space-6);
		text-align: center;
	}
	.hero {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 22px;
		align-items: end;
		margin-bottom: 16px;
	}
	.eyebrow {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: 11px;
		color: var(--color-accent-bright);
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-2xl);
		line-height: 1.02;
		letter-spacing: -0.02em;
		margin: 7px 0 4px;
	}
	.subl {
		color: var(--color-text-muted);
		font-size: 14px;
	}
	.subl b {
		color: var(--color-resource);
		font-weight: 600;
	}
	.sysx {
		font-family: var(--font-mono);
		font-size: 11px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: 1px 6px;
	}
	.hp {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 15px 17px;
	}
	.hp .lab {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}
	.temptag {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
		padding: 3px 9px;
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
	}
	.hp .val {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 30px;
	}
	.hp .val small {
		color: var(--color-text-muted);
		font-size: 16px;
		font-weight: 500;
	}
	.hp .val .temp {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
		color: var(--color-good);
		margin-left: 7px;
	}
	.bar {
		height: 9px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
		overflow: hidden;
		border: 1px solid var(--color-border);
		margin-top: 8px;
		display: flex;
	}
	.bar > i {
		display: block;
		height: 100%;
	}
	.bar > i.cur {
		background: var(--color-accent);
	}
	.bar > i.tmp {
		background: var(--color-good);
		box-shadow: -1px 0 0 var(--color-surface);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 7px 12px;
		border-radius: var(--radius-full);
		cursor: pointer;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.toggle .sw {
		font-family: var(--font-mono);
		font-size: 10px;
		border: 1px solid var(--color-border-strong);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.toggle.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.toggle.on .sw {
		border-color: var(--color-resource);
	}
	.toggle.conc.on {
		background: #241317;
		border-color: var(--color-accent);
		color: #f0a6ad;
	}
	.toggle.auto.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.toggle.auto.on .sw {
		border-color: var(--color-good);
	}
	.toggle.dice {
		background: var(--color-accent-deep);
		border-color: var(--color-accent-deep);
		color: #fff;
		font-size: 13px;
	}
	.controls .spacer,
	.turnbar .spacer {
		flex: 1 1 auto;
		min-width: 8px;
	}

	.turnbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 9px 12px;
		margin-bottom: 20px;
	}
	.turnbar .lbl {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.ae {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 5px 11px;
	}
	.ae .aepips {
		display: inline-flex;
		gap: 4px;
	}
	.ae .aedot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-good);
		box-shadow: 0 0 8px rgba(59, 184, 166, 0.45);
	}
	.ae b {
		color: var(--color-text);
	}
	.roundc {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		padding: 7px 10px;
		color: var(--color-text-muted);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
	}
	.rstep {
		background: transparent;
		border: 0;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
		padding: 0 2px;
	}
	.nextturn {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: #fff;
		border-radius: 9px;
		padding: 7px 15px;
		cursor: pointer;
	}

	.sectlab {
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
		font-size: 10px;
		color: var(--color-text-muted);
		margin: 0 2px 9px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.sectlab::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}
	.sectlab em {
		font-style: normal;
		text-transform: none;
		letter-spacing: 0;
		font-family: var(--font-body);
		font-size: 11px;
		color: var(--color-text-muted);
	}

	.combat {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 12px;
	}
	.tile {
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		padding: 13px 15px;
		cursor: help;
	}
	.tile .k {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-accent-bright);
	}
	.tile .v {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 26px;
		line-height: 1.05;
		margin-top: 4px;
	}
	.tile .v small {
		font-size: 13px;
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.tile .t {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 6px;
	}
	.tile .t b {
		color: var(--color-resource);
	}

	.senses-strip {
		display: flex;
		align-items: baseline;
		gap: 14px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 11px 16px;
		margin-bottom: 22px;
	}
	.senses-strip .lbl {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.senses-strip .sv {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
		cursor: help;
	}
	.senses-strip .sv i {
		font-style: normal;
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 12px;
		color: var(--color-text-muted);
		margin-right: 6px;
	}
	.senses-strip .sdot {
		color: var(--color-border-strong);
	}
	.senses-strip .edit {
		margin-left: auto;
		font-family: var(--font-body);
		font-size: 12px;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		cursor: pointer;
		align-self: center;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
		margin-bottom: 22px;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
		.hero {
			grid-template-columns: 1fr;
		}
	}
	.ab {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 11px;
		text-align: center;
		padding: 12px 8px;
		cursor: pointer;
	}
	.ab .n {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	.ab .n b {
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 600;
	}
	.ab .m {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 34px;
		line-height: 1;
		margin: 6px 0 9px;
	}
	.ab .sv {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 4px 6px;
	}
	.ab .sv b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		color: var(--color-text);
	}
	.ab .sv.prof {
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.ab .sv.prof b {
		color: var(--color-resource);
	}
	.ab .sv .pdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
	}
	.ab .sv .pdot.on {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}

	.panels {
		column-count: 2;
		column-gap: 18px;
	}
	@media (max-width: 760px) {
		.panels {
			column-count: 1;
		}
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 17px;
		break-inside: avoid;
		margin-bottom: 18px;
	}
	.card h2 {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 0 0 13px;
	}
	.ph2 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
	}
	.ph2 h2 {
		margin: 0 auto 0 0;
	}
	.grpby {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 3px 8px;
		cursor: pointer;
	}

	.sklgrid {
		column-count: 2;
		column-gap: 16px;
		column-rule: 1px solid var(--color-border);
	}
	.catblock {
		break-inside: avoid;
		margin-bottom: 7px;
	}
	.ssec {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 5px 0 3px;
	}
	.skl {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: 8px;
		break-inside: avoid;
		cursor: help;
		font-size: 13px;
	}
	.skl:hover {
		background: var(--color-surface-2);
	}
	.skl .pdot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		flex: none;
	}
	.skl .pdot.on {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
	.skl .sn {
		flex: 1;
	}
	.skl .sm {
		font-family: var(--font-display);
		font-weight: 700;
	}
	.trace {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.trace .pdot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-resource);
		vertical-align: middle;
	}

	.atk {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1px 10px;
		padding: 8px 9px;
		margin: 0 -9px;
		border-radius: 9px;
		cursor: pointer;
	}
	.atk + .atk {
		box-shadow: 0 -1px 0 var(--color-border);
	}
	.atk:hover {
		background: var(--color-surface-2);
		box-shadow: none;
	}
	.atk .an {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.atk .ah {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		color: var(--color-resource);
		justify-self: end;
	}
	.atk .ad {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.atk .am {
		font-size: 11px;
		color: var(--color-text-muted);
		justify-self: end;
	}

	.eff {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 9px 0;
		border-top: 1px solid var(--color-border);
	}
	.eff:first-of-type {
		border-top: 0;
	}
	.eff .d {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-top: 6px;
		flex: none;
	}
	.eff.pos .d {
		background: var(--color-good);
	}
	.eff.pos .body b {
		color: var(--color-good);
	}
	.eff.neg .d {
		background: var(--color-accent);
	}
	.eff.neg .body b {
		color: var(--color-accent-bright);
	}
	.eff .body small {
		color: var(--color-text-muted);
		display: block;
	}

	.castline {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin: -2px 0 9px;
	}
	.castline b {
		color: var(--color-resource);
		font-family: var(--font-display);
		font-weight: 700;
	}
	.scat {
		display: flex;
		align-items: center;
		gap: 9px;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 11px 0 3px;
	}
	.scat .pips {
		display: flex;
		gap: 5px;
	}
	.scat .pip {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1px solid #2c4a45;
	}
	.scat .pip.full {
		background: var(--color-good);
		border-color: var(--color-good);
		box-shadow: 0 0 8px rgba(59, 184, 166, 0.45);
	}
	.scat .pip.spent {
		background: transparent;
		border-style: dashed;
		opacity: 0.5;
	}
	.sprow {
		display: grid;
		grid-template-columns: 1fr 96px 88px 64px;
		align-items: center;
		gap: 9px;
		padding: 7px 6px;
		border-top: 1px solid var(--color-border);
		border-radius: 7px;
		cursor: pointer;
	}
	.scat + .sprow {
		border-top: 0;
	}
	.sprow:hover {
		background: var(--color-surface-2);
	}
	.sprow .an {
		min-width: 0;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sprow .spe {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		text-align: right;
	}
	.sprow .rtag {
		font-family: var(--font-mono);
		font-size: 10px;
		border-radius: 5px;
		padding: 2px 4px;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		white-space: nowrap;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sprow .rtag.hit {
		color: var(--color-resource);
		border-color: #5a4d28;
	}
	.sprow .rtag.save {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
	}
	.sprow .rtag.auto {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.sprow .tm {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		text-align: right;
		white-space: nowrap;
	}
	.prep {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		margin-right: 8px;
		vertical-align: middle;
	}
	.prep.on,
	.prep.always {
		background: var(--color-resource);
		border-color: var(--color-resource);
	}
</style>
