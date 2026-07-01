<script lang="ts">
	// Combat sheet — faithful bake of design-preview/d-charnik.html (+ d-menus overlays),
	// fed by the live pipeline (deriveSheet over the real content graph). Collapsible +
	// drag-reorderable panels, working menus (dice tray, condition/effect pickers, roll
	// log, show/hide), pins, provenance on hover.
	import { onMount } from 'svelte';
	import { demoCharacter } from '$lib/demo/sheet';
	import { getContentGraph } from '$lib/content/provider';
	import { deriveSheet, type CharacterSheet, SKILL_ABILITY } from '$lib/character/derive';
	import { fullCasterSlots, passiveScore, type Ability } from '$lib/rules/core';
	import type { ContentGraph } from '$lib/content/loader';
	import type { Character } from '$lib/character/schema';
	import type { Computed } from '$lib/rules/pipeline';

	let graph = $state<ContentGraph | null>(null);
	let character = $state<Character | null>(null);
	let sheet = $state<CharacterSheet | null>(null);

	// play/UI state
	let round = $state(1);
	let shieldOn = $state(false);
	let collapsed = $state<Record<string, boolean>>({});
	let pinned = $state<Record<string, boolean>>({ 'fire-bolt': true, shield: true });
	let panelOrder = $state(['skills', 'attacks', 'actions', 'effects']);
	let overlay = $state<null | { kind: string }>(null);
	let log = $state<{ label: string; expr: string; total: number }[]>([]);
	let dragId = $state<string | null>(null);
	let dragArmed = $state<string | null>(null); // a panel is draggable only while its ⠿ handle is held
	let hiddenActions = $state<Record<string, boolean>>({});
	let passiveSkills = $state<string[]>(['perception', 'investigation', 'insight']);

	onMount(async () => {
		graph = await getContentGraph();
		character = demoCharacter();
		sheet = deriveSheet(character, graph);
	});

	const signed = (n: number) => (n >= 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
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
	const toggle = (k: string) => (collapsed[k] = !collapsed[k]);

	function roll(label: string, mod: number) {
		const d = 1 + Math.floor(Math.random() * 20);
		const total = d + mod;
		log = [{ label, expr: `1d20(${d}) ${signed(mod)}`, total }, ...log].slice(0, 200);
	}

	const PANEL_TITLE: Record<string, string> = {
		skills: 'Skills',
		attacks: 'Attacks',
		actions: 'Actions',
		effects: 'Effects & conditions'
	};
	const ABIL: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
	const ABILITY_NAME: Record<Ability, string> = {
		str: 'Strength',
		dex: 'Dexterity',
		con: 'Constitution',
		int: 'Intelligence',
		wis: 'Wisdom',
		cha: 'Charisma'
	};

	const className = $derived.by(() => {
		if (!character || !graph) return '';
		const c = character.build.classes[0];
		const row = graph.get(c.class);
		return row ? `${row.data.name_en} ${c.level}` : `Level ${sheet?.level ?? ''}`;
	});
	const speciesName = $derived.by(() =>
		character?.build.species && graph
			? String(graph.get(character.build.species)?.data.name_en ?? '')
			: ''
	);
	const conc = $derived(
		character?.play.effects.find((e) => e.label.toLowerCase().includes('bless'))
	);

	const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
	// configurable passive-sense skills (Pin skills)
	const passives = $derived(
		sheet
			? passiveSkills.map((k) => ({
					key: k,
					name: titleCase(k),
					comp: passiveScore(sheet!.skills[k])
				}))
			: []
	);
	function togglePassive(k: string) {
		passiveSkills = passiveSkills.includes(k)
			? passiveSkills.filter((x) => x !== k)
			: [...passiveSkills, k];
	}
	// casting a spell: attack spells roll to hit; others just log the cast
	function cast(r: { name: string; res: string }) {
		if (r.res === 'hit' && sheet?.spellcasting)
			roll(`${r.name} (spell attack)`, sheet.spellcasting.attack.value);
		else log = [{ label: `Cast ${r.name}`, expr: '', total: NaN }, ...log].slice(0, 200);
	}

	// attacks (equipped weapons + Unarmed Strike)
	interface Atk {
		name: string;
		toHit: number;
		dmg: string;
		meta: string;
	}
	const attacks = $derived.by<Atk[]>(() => {
		if (!character || !sheet || !graph) return [];
		const prof = sheet.proficiencyBonus,
			strMod = sheet.abilities.str.mod,
			dexMod = sheet.abilities.dex.mod;
		const out: Atk[] = [];
		for (const inv of character.build.inventory) {
			if (!inv.equipped) continue;
			const row = graph.get(inv.item);
			if (!row || row.data.category !== 'weapon') continue;
			const props = String(row.data.properties ?? '').toLowerCase();
			const ranged = String(row.data.item_type ?? '').includes('ranged');
			const mod = ranged ? dexMod : props.includes('finesse') ? Math.max(strMod, dexMod) : strMod;
			out.push({
				name: String(row.data.name_en),
				toHit: mod + prof,
				dmg: `${row.data.damage ?? ''} ${signed(mod)} ${row.data.damage_type ?? ''}`.trim(),
				meta: [row.data.item_type, props.split(/[,;]/)[0]].filter(Boolean).join(' · ')
			});
		}
		out.push({
			name: 'Unarmed Strike',
			toHit: strMod + prof,
			dmg: `${1 + strMod} bludgeoning`,
			meta: 'melee'
		});
		return out;
	});

	// standard actions (from d-charnik); roll ones reference live skills
	const actions = $derived.by(() => {
		const s = sheet;
		const sk = (k: string) => s?.skills[k]?.value ?? 0;
		return [
			{ id: 'attack', n: 'Attack', h: '', d: 'weapon / spell / unarmed', m: '→ Attacks' },
			{ id: 'dash', n: 'Dash', h: '', d: '+speed this turn', m: 'action' },
			{ id: 'disengage', n: 'Disengage', h: '', d: 'no opportunity attacks', m: 'action' },
			{ id: 'dodge', n: 'Dodge', h: '', d: 'attackers have disadv.', m: 'action' },
			{
				id: 'hide',
				n: 'Hide',
				h: signed(sk('stealth')),
				d: 'Stealth',
				m: '→ roll',
				roll: ['Hide (Stealth)', sk('stealth')] as [string, number]
			},
			{
				id: 'search',
				n: 'Search',
				h: signed(sk('perception')),
				d: 'Perception',
				m: '→ roll',
				roll: ['Search (Perception)', sk('perception')] as [string, number]
			},
			{
				id: 'study',
				n: 'Study',
				h: signed(sk('arcana')),
				d: 'recall lore',
				m: '→ roll',
				roll: ['Study (Arcana)', sk('arcana')] as [string, number]
			},
			{
				id: 'grapple',
				n: 'Grapple',
				h: signed(sk('athletics')),
				d: 'Athletics vs target',
				m: 'contest',
				roll: ['Grapple (Athletics)', sk('athletics')] as [string, number]
			},
			{
				id: 'shove',
				n: 'Shove',
				h: signed(sk('athletics')),
				d: 'prone / push 5 ft',
				m: 'contest',
				roll: ['Shove (Athletics)', sk('athletics')] as [string, number]
			},
			{ id: 'help', n: 'Help', h: '', d: 'give an ally advantage', m: 'action' },
			{ id: 'ready', n: 'Ready', h: '', d: 'prepare a trigger', m: 'action' },
			{ id: 'utilize', n: 'Utilize', h: '', d: 'use an object', m: 'action' }
		];
	});
	const visibleActions = $derived(actions.filter((a) => !hiddenActions[a.id]));

	// spells grouped by level (Pinned first)
	interface SpRow {
		id: string;
		name: string;
		spe: string;
		res: '' | 'hit' | 'save' | 'auto';
		resLabel: string;
		tm: string;
		prep: '' | 'on' | 'always';
	}
	interface SpGroup {
		key: string;
		label: string;
		slots: { full: number; spent: number } | null;
		rows: SpRow[];
	}
	function spellRow(ref: string, prep: SpRow['prep']): SpRow | null {
		const row = graph!.get(ref);
		if (!row) return null;
		const lvl = Number(row.data.level);
		const res = String(row.data.resolution ?? 'none');
		const dmg = String(row.data.damage ?? '');
		return {
			id: String(row.data.id),
			name: String(row.data.name_en),
			spe: dmg || effectHint(row.data),
			res: res === 'attack' ? 'hit' : res === 'save' ? 'save' : res === 'auto' ? 'auto' : '',
			resLabel:
				res === 'attack'
					? 'attack roll'
					: res === 'save'
						? `${row.data.save_ability} save`
						: res === 'auto'
							? 'auto-hit'
							: '',
			tm:
				(lvl === 0 ? 'cantrip' : ordinal(lvl)) + castingSuffix(String(row.data.casting_time ?? '')),
			prep
		};
	}
	const spellGroups = $derived.by<SpGroup[]>(() => {
		if (!character || !graph) return [];
		const slots = fullCasterSlots(sheet?.level ?? 1);
		const all = character.build.spells
			.map((sp) => ({
				sp,
				row: spellRow(sp.spell, sp.alwaysPrepared ? 'always' : sp.prepared ? 'on' : '')
			}))
			.filter((x): x is { sp: (typeof character.build.spells)[number]; row: SpRow } => !!x.row);
		const groups: SpGroup[] = [];
		const pins = all.filter((x) => pinned[x.row.id]);
		if (pins.length)
			groups.push({ key: 'pinned', label: '★ Pinned', slots: null, rows: pins.map((x) => x.row) });
		const byLevel = new Map<number, SpRow[]>();
		for (const x of all) {
			const lvl = Number(graph!.get(x.sp.spell)!.data.level);
			(byLevel.get(lvl) ?? byLevel.set(lvl, []).get(lvl)!).push(x.row);
		}
		for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
			groups.push({
				key: String(lvl),
				label: lvl === 0 ? 'Cantrips' : ordinal(lvl),
				slots:
					lvl === 0
						? null
						: {
								full: slots[lvl - 1] ?? 0,
								spent: Number(character.play.spellSlotsSpent[String(lvl)] ?? 0)
							},
				rows: byLevel.get(lvl)!
			});
		}
		return groups;
	});
	const preparedCount = $derived(character?.build.spells.filter((s) => s.prepared).length ?? 0);
	const preparedCap = $derived((sheet?.abilities.int.mod ?? 0) + (sheet?.level ?? 0));

	function effectHint(d: Record<string, unknown>): string {
		const range = String(d.range ?? '');
		if (/self/i.test(range) && /step|door|teleport/i.test(String(d.name_en))) return 'teleport';
		if (/counter/i.test(String(d.name_en))) return 'negate spell';
		if (
			/mage hand|prestidig|light|message|minor illusion|mage armor|fly|invis|mirror/i.test(
				String(d.name_en)
			)
		)
			return (
				{
					'mage hand': 'utility',
					'mage armor': 'set AC 13',
					fly: 'fly 60 ft',
					'mirror image': '3 duplicates'
				}[String(d.name_en).toLowerCase()] ?? 'utility'
			);
		return 'utility';
	}
	const ordinal = (n: number) =>
		`${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;
	const castingSuffix = (ct: string) =>
		/bonus/i.test(ct) ? ' · bonus' : /reaction/i.test(ct) ? ' · react' : '';

	const hpBar = $derived.by(() => {
		if (!character || !sheet) return { cur: 0, tmp: 0 };
		const max = character.play.hp.max ?? sheet.maxHp.value;
		return {
			cur: Math.max(0, Math.min(100, (character.play.hp.current / max) * 100)),
			tmp: (character.play.hp.temp / max) * 100
		};
	});

	// drag reorder
	function onDrop(target: string) {
		if (!dragId || dragId === target) return;
		const o = [...panelOrder];
		o.splice(o.indexOf(dragId), 1);
		o.splice(o.indexOf(target), 0, dragId);
		panelOrder = o;
		dragId = null;
	}

	const conditionList = $derived(
		graph ? graph.list('condition', { system: '5.5e' }).map((r) => String(r.data.name_en)) : []
	);
	const EFFECT_PRESETS = [
		{ label: 'Bless', tokens: ['flat-bonus:saves+1d4'] },
		{ label: 'Bane', tokens: ['flat-bonus:saves-1d4'] },
		{ label: 'Shield of Faith', tokens: ['flat-bonus:ac+2'] },
		{ label: 'Half cover', tokens: ['flat-bonus:ac+2'] },
		{ label: 'Three-quarters cover', tokens: ['flat-bonus:ac+5'] }
	];
	function addEffect(label: string, tokens: string[], positive = true) {
		if (!character) return;
		character.play.effects = [
			...character.play.effects,
			{
				iid: label + Date.now(),
				label,
				effects: tokens,
				positive,
				durationRounds: 10,
				startedRound: round
			}
		];
		sheet = deriveSheet(character, graph!);
		overlay = null;
	}
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
				{c.play.hp.current}<small>
					/ {c.play.hp.max ?? s.maxHp.value}</small
				>{#if c.play.hp.temp > 0}<span class="temp">+{c.play.hp.temp} temp</span>{/if}
			</div>
			<div class="bar">
				<i class="cur" style="width:{hpBar.cur}%"></i><i class="tmp" style="width:{hpBar.tmp}%"></i>
			</div>
		</div>
	</section>

	<section class="controls">
		<button class="toggle" class:on={shieldOn} onclick={() => (shieldOn = !shieldOn)}
			>🛡 Shield <span class="sw">{shieldOn ? 'ON' : 'OFF'}</span></button
		>
		{#if conc}<button class="toggle conc on"
				>◈ Concentration <span class="sw">{conc.label}</span></button
			>{/if}
		<button
			class="toggle"
			class:on={c.play.inspiration}
			onclick={() => (c.play.inspiration = !c.play.inspiration)}
			>✦ Inspiration <span class="sw">{c.play.inspiration ? 'ON' : 'OFF'}</span></button
		>
		<button class="toggle" onclick={() => (overlay = { kind: 'condition' })}>＋ Condition</button>
		<span class="spacer"></span>
		<button class="toggle auto on">⚙ Auto-calc <span class="sw">ON</span></button>
		<button class="toggle dice" onclick={() => (overlay = { kind: 'dice' })}>🎲 Dice tray</button>
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

	<div class="playbar">
		<span class="phint"
			>Tap any check · save · attack to roll it. Auto-calc &amp; rounds are optional.</span
		>
		<button class="rollout" onclick={() => (overlay = { kind: 'log' })}>
			🎲 {#if log[0]}Last · <b>{log[0].label}</b> <i>{log[0].expr}</i> =
				<span class="res">{log[0].total}</span>{:else}<i>no rolls yet</i>{/if}<span class="logcue"
				>▸ log</span
			>
		</button>
	</div>

	<div class="sectlab">
		<button class="chev" onclick={() => toggle('combat')}>{collapsed.combat ? '▸' : '▾'}</button
		>Combat
	</div>
	{#if !collapsed.combat}
		<section class="combat">
			<button class="tile" title={why(s.ac)} onclick={() => roll('AC (touch)', 0)}>
				<div class="k">Armor class</div>
				<div class="v">{s.ac.value}</div>
				<div class="t">{s.ac.trace.map((x) => `${x.source} ${signed(x.amount)}`).join(' ')}</div>
			</button>
			<button
				class="tile"
				title={why(s.initiative)}
				onclick={() => roll('Initiative', s.initiative.value)}
			>
				<div class="k">Initiative</div>
				<div class="v">{signed(s.initiative.value)}</div>
				<div class="t">DEX <b>{signed(s.abilities.dex.mod)}</b></div>
			</button>
			<div class="tile" title={why(s.speed)}>
				<div class="k">Speed</div>
				<div class="v">{s.speed.value} ft<small> ({metres(s.speed.value)})</small></div>
				<div class="t">base walk</div>
			</div>
		</section>
		<div class="senses-strip">
			<span class="lbl">Passive senses</span>
			{#each passives as p, i (p.key)}
				{#if i > 0}<span class="sdot">·</span>{/if}
				<span class="sv" title={why(p.comp)}><i>{p.name}</i>{p.comp.value}</span>
			{:else}
				<span class="sv"><i>none pinned</i></span>
			{/each}
			<button class="edit" onclick={() => (overlay = { kind: 'pinskills' })}>✎ Pin skills</button>
		</div>
	{/if}

	<div class="sectlab">
		<button class="chev" onclick={() => toggle('abilities')}
			>{collapsed.abilities ? '▸' : '▾'}</button
		>Abilities <em>tap to roll a check or save</em>
	</div>
	{#if !collapsed.abilities}
		<section class="grid">
			{#each ABIL as ab (ab)}
				{@const a = s.abilities[ab]}
				{@const prof = a.save.trace.some((t) => t.layer === 'proficiency')}
				<button class="ab" onclick={() => roll(`${ab.toUpperCase()} check`, a.mod)}>
					<div class="n"><b>{ab.toUpperCase()}</b> · {a.score}</div>
					<div class="m">{signed(a.mod)}</div>
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<span
						class="sv"
						class:prof
						role="button"
						tabindex="-1"
						title={why(a.save)}
						onclick={(e) => {
							e.stopPropagation();
							roll(`${ab.toUpperCase()} save`, a.save.value);
						}}
					>
						<i class="pdot" class:on={prof}></i>SAVE <b>{signed(a.save.value)}</b>
					</span>
				</button>
			{/each}
		</section>
	{/if}

	<section class="panels">
		{#each panelOrder as pid (pid)}
			<div
				class="card"
				draggable={dragArmed === pid}
				ondragstart={() => (dragId = pid)}
				ondragover={(e) => e.preventDefault()}
				ondrop={() => onDrop(pid)}
				ondragend={() => (dragArmed = null)}
			>
				<div class="phead">
					<button class="htoggle" onclick={() => toggle(pid)}>
						<span class="chev">{collapsed[pid] ? '▸' : '▾'}</span>{PANEL_TITLE[pid]}
					</button>
					{#if pid === 'actions'}
						<button
							class="grpby"
							title="Show / hide actions"
							onclick={() => (overlay = { kind: 'showhide' })}>👁</button
						>
					{:else if pid === 'effects'}
						<button class="grpby" onclick={() => (overlay = { kind: 'addeffect' })}>＋ Add</button>
					{/if}
					<button class="dh" title="drag to reorder" onmousedown={() => (dragArmed = pid)}>⠿</button
					>
				</div>
				{#if !collapsed[pid]}
					{#if pid === 'skills'}
						<div class="sklgrid">
							{#each ABIL as ab (ab)}
								{@const list = Object.keys(SKILL_ABILITY).filter((k) => SKILL_ABILITY[k] === ab)}
								{#if list.length}
									<div class="catblock">
										<div class="ssec">{ABILITY_NAME[ab]}</div>
										{#each list as skill (skill)}
											{@const sk = s.skills[skill]}
											<button
												class="skl"
												title={why(sk)}
												onclick={() => roll(titleCase(skill), sk.value)}
											>
												<i class="pdot" class:on={sk.proficient}></i>
												<span class="sn">{titleCase(skill)}</span>
												<b class="sm">{signed(sk.value)}</b>
											</button>
										{/each}
									</div>
								{/if}
							{/each}
						</div>
					{:else if pid === 'attacks'}
						{#each attacks as at (at.name)}
							<button class="atk" onclick={() => roll(at.name, at.toHit)}>
								<span class="an">{at.name}</span><span class="ah">{signed(at.toHit)}</span>
								<span class="ad">{at.dmg}</span><span class="am">{at.meta}</span>
							</button>
						{/each}
					{:else if pid === 'actions'}
						{#each visibleActions as a (a.id)}
							<button class="atk" onclick={() => a.roll && roll(a.roll[0], a.roll[1])}>
								<span class="an">{a.n}</span><span class="ah">{a.h || '—'}</span>
								<span class="ad">{a.d}</span><span class="am">{a.m}</span>
							</button>
						{/each}
					{:else if pid === 'effects'}
						{#each c.play.effects as e (e.iid)}
							<div class="eff" class:pos={e.positive} class:neg={!e.positive}>
								<span class="d"></span>
								<div class="body">
									<b>{e.label}</b>{#if e.effects.length}<small
											>{e.effects.join(' · ')}{e.durationRounds
												? ` · ${e.durationRounds} rounds`
												: ''}</small
										>{/if}
								</div>
							</div>
						{:else}<p class="trace">No active effects.</p>{/each}
					{/if}
				{/if}
			</div>
		{/each}
	</section>

	<!-- Spells: full width so the effect-first rows are never cramped -->
	{#if s.spellcasting && spellGroups.length}
		<div class="card spellcard">
			<div class="phead">
				<button class="htoggle" onclick={() => toggle('spells')}>
					<span class="chev">{collapsed.spells ? '▸' : '▾'}</span>Spells
				</button>
				<span class="prepct">Prepared <b>{preparedCount}</b> / {preparedCap}</span>
				<button class="grpby" onclick={() => (overlay = { kind: 'manage' })}>⛭ Manage all</button>
			</div>
			{#if !collapsed.spells}
				<div class="castline">
					Spell save DC <b>{s.spellcasting.saveDC.value}</b> · spell attack
					<b>{signed(s.spellcasting.attack.value)}</b> — same for every spell
				</div>
				<div class="sprows">
					{#each spellGroups as g (g.key)}
						<div class="spgroup">
							<div class="scat" class:star={g.key === 'pinned'}>
								{g.label}
								{#if g.slots}<span class="pips"
										>{#each Array(g.slots.full) as _, i (i)}<span
												class="pip"
												class:full={i >= g.slots.spent}
												class:spent={i < g.slots.spent}
											></span>{/each}</span
									>{/if}
							</div>
							{#each g.rows as r (g.key + r.id)}
								<button class="sprow" onclick={() => cast(r)}>
									<span class="an"
										><i class="prep" class:on={r.prep === 'on'} class:always={r.prep === 'always'}
										></i>{r.name}</span
									>
									<span class="spe">{r.spe}</span>
									{#if r.res}<span class="rtag {r.res}">{r.resLabel}</span>{:else}<span></span>{/if}
									<span class="tm">{r.tm}</span>
									<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
									<span
										class="pinstar"
										class:on={pinned[r.id]}
										role="button"
										tabindex="-1"
										title="pin to top"
										onclick={(e) => {
											e.stopPropagation();
											pinned[r.id] = !pinned[r.id];
										}}>{pinned[r.id] ? '★' : '☆'}</span
									>
								</button>
							{/each}
						</div>
					{/each}
				</div>
				<p class="trace" style="margin-top:11px">
					tap a spell to cast/roll · slot pip to spend · ★ pin
				</p>
			{/if}
		</div>
	{/if}

	<!-- overlays — d-menus popovers -->
	{#if overlay}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="ovbg" onclick={() => (overlay = null)}></div>
		<div class="pop" role="dialog" aria-modal="true" tabindex="-1">
			<div class="pop-h">
				{{
					dice: 'Dice tray',
					condition: 'Add condition',
					addeffect: 'Add effect',
					log: 'Roll log',
					showhide: 'Which actions appear',
					pinskills: 'Which skills show as passive',
					manage: 'Spellbook'
				}[overlay.kind]}
				<button class="ovx" onclick={() => (overlay = null)}>✕</button>
			</div>
			<div class="pop-b">
				{#if overlay.kind === 'dice'}
					<div class="dtray">
						{#each [20, 12, 10, 8, 6, 4] as die (die)}<button
								class="dbtn"
								onclick={() => {
									const v = 1 + Math.floor(Math.random() * die);
									log = [{ label: `d${die}`, expr: `1d${die}`, total: v }, ...log];
								}}>d{die}</button
							>{/each}
					</div>
					{#if log[0]}<p class="dres">{log[0].label} → <b>{log[0].total}</b></p>{/if}
				{:else if overlay.kind === 'condition'}
					{#each conditionList as cn (cn)}
						{@const added = character?.play.effects.some((e) => e.label === cn)}
						<button class="row" onclick={() => (added ? null : addEffect(cn, [], false))}>
							<span class="main">{cn}</span><span class="tg" class:on={added}></span>
						</button>
					{/each}
				{:else if overlay.kind === 'addeffect'}
					{#each EFFECT_PRESETS as p (p.label)}
						<button
							class="row"
							onclick={() => addEffect(p.label, p.tokens, !/bane/i.test(p.label))}
						>
							<span class="main"
								><span class="ic" class:neg={/bane/i.test(p.label)}>＋</span>{p.label}</span
							><span class="meta">{p.tokens.join(', ')}</span>
						</button>
					{/each}
				{:else if overlay.kind === 'log'}
					{#each log as l, i (i)}
						<div class="row">
							<span class="main">{l.label}</span><span class="meta mono"
								>{l.expr}{l.expr ? ' = ' : ''}<b>{Number.isNaN(l.total) ? '' : l.total}</b></span
							>
						</div>
					{:else}<p class="trace">No rolls yet — tap a stat, skill, save, or attack.</p>{/each}
				{:else if overlay.kind === 'showhide'}
					{#each actions as a (a.id)}
						<button class="row" onclick={() => (hiddenActions[a.id] = !hiddenActions[a.id])}>
							<span class="eye" class:on={!hiddenActions[a.id]}></span><span class="main"
								>{a.n}</span
							>{#if hiddenActions[a.id]}<span class="meta">hidden</span>{/if}
						</button>
					{/each}
				{:else if overlay.kind === 'pinskills'}
					{#each Object.keys(SKILL_ABILITY) as skill (skill)}
						<button class="row" onclick={() => togglePassive(skill)}>
							<span class="eye" class:on={passiveSkills.includes(skill)}></span><span class="main"
								>{titleCase(skill)}</span
							><span class="meta">{SKILL_ABILITY[skill].toUpperCase()}</span>
						</button>
					{/each}
				{:else if overlay.kind === 'manage'}
					<p class="trace">
						Full spellbook manager arrives with the spell-manager view (d-spellmgr).
					</p>
				{/if}
			</div>
		</div>
	{/if}
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
		color: inherit;
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
	.toggle.conc.on .sw {
		border-color: #7a2230;
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
		margin-bottom: 12px;
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

	.playbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 22px;
	}
	.phint {
		font-size: 12px;
		color: var(--color-text-muted);
		flex: 1;
		min-width: 220px;
	}
	.rollout {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 6px 11px;
		cursor: pointer;
		margin-left: auto;
		white-space: nowrap;
	}
	.rollout:hover {
		border-color: var(--color-border-strong);
	}
	.rollout i {
		font-style: normal;
		color: var(--color-text-muted);
	}
	.rollout .res {
		color: var(--color-good);
		font-size: 14px;
		font-weight: 700;
	}
	.rollout .logcue {
		color: var(--color-text-muted);
		margin-left: 8px;
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
	.chev {
		color: var(--color-text-muted);
		font-size: 10px;
		margin-right: 4px;
	}
	/* panel header: click the whole title area (chev + name) to collapse */
	.phead {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 10px;
	}
	.htoggle {
		display: inline-flex;
		align-items: center;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		cursor: pointer;
		padding: 4px 8px 4px 2px;
		margin-right: auto;
		border-radius: var(--radius-sm);
	}
	.htoggle:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.dh {
		color: var(--color-border-strong);
		font-size: 14px;
		cursor: grab;
		background: transparent;
		border: 0;
		padding: 2px 4px;
	}
	.dh:active {
		cursor: grabbing;
	}

	.combat {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 12px;
	}
	.tile {
		text-align: left;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		padding: 13px 15px;
		cursor: pointer;
		color: var(--color-text);
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
		color: var(--color-text);
		display: block;
		width: 100%;
	}
	.ab:hover {
		border-color: var(--color-border-strong);
		background: var(--color-surface);
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
		width: 100%;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 4px 6px;
		cursor: pointer;
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
	.spellcard {
		margin-top: 0;
	}
	.grpby {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
		color: var(--color-text-muted);
		background: transparent;
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
		cursor: pointer;
		font-size: 13px;
		width: 100%;
		background: transparent;
		border: 0;
		color: var(--color-text);
		text-align: left;
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

	.atk {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1px 10px;
		padding: 8px 9px;
		margin: 0 -9px;
		border-radius: 9px;
		cursor: pointer;
		width: calc(100% + 18px);
		background: transparent;
		border: 0;
		color: var(--color-text);
		text-align: left;
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

	.spellcard .castline {
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
	.sprows {
		column-count: 2;
		column-gap: 22px;
	}
	@media (max-width: 760px) {
		.sprows {
			column-count: 1;
		}
	}
	.spgroup {
		break-inside: avoid;
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
		break-inside: avoid;
	}
	.scat.star {
		color: var(--color-accent-bright);
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
		grid-template-columns: 1fr 84px 78px 54px;
		align-items: center;
		gap: 9px;
		padding: 7px 6px;
		border-top: 1px solid var(--color-border);
		border-radius: 7px;
		cursor: pointer;
		break-inside: avoid;
		width: 100%;
		background: transparent;
		border-left: 0;
		border-right: 0;
		border-bottom: 0;
		color: var(--color-text);
		text-align: left;
		font: inherit;
	}
	.spgroup:first-child .scat {
		padding-top: 2px;
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
		overflow: hidden;
		text-overflow: ellipsis;
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
	.pinstar {
		background: transparent;
		border: 0;
		color: var(--color-border-strong);
		margin-left: 7px;
		cursor: pointer;
		font-size: 12px;
	}
	.pinstar.on {
		color: var(--color-accent-bright);
	}
	.prepct {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.prepct b {
		color: var(--color-resource);
	}

	/* overlays — d-menus popover language */
	.ovbg {
		position: fixed;
		inset: 0;
		background: var(--color-overlay);
		z-index: 50;
	}
	.pop {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(320px, calc(100vw - 2rem));
		max-height: 74vh;
		overflow: auto;
		z-index: 51;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		box-shadow: 0 18px 40px #000a;
	}
	.pop-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 11px 13px;
		border-bottom: 1px solid var(--color-border);
	}
	.ovx {
		background: transparent;
		border: 0;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
	}
	.pop-b {
		padding: 7px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		background: transparent;
		border-radius: 8px;
		cursor: pointer;
		color: var(--color-text);
		text-align: left;
		font: inherit;
	}
	.row:hover {
		background: var(--color-surface-2);
	}
	.row .main {
		flex: 1;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.row .meta {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.row .meta.mono b {
		color: var(--color-good);
	}
	.row .ic {
		width: 18px;
		text-align: center;
		color: var(--color-good);
	}
	.row .ic.neg {
		color: var(--color-accent-bright);
	}
	/* visibility = open/closed eye, teal when shown */
	.eye {
		display: inline-block;
		width: 22px;
		height: 16px;
		flex: none;
		background-repeat: no-repeat;
		background-position: center;
		opacity: 0.5;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23878f9d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 12s3.5-6 10-6c1.6 0 3 .3 4.2.9M22 12s-3.5 6-10 6c-1.6 0-3-.3-4.2-.9'/%3E%3Cline x1='2' y1='2' x2='22' y2='22'/%3E%3C/svg%3E");
	}
	.eye.on {
		opacity: 1;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%233bb8a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='2.5'/%3E%3C/svg%3E");
	}
	.tg {
		width: 34px;
		height: 20px;
		border-radius: 999px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border-strong);
		position: relative;
		flex: none;
	}
	.tg::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-text-muted);
		transition: left 0.12s;
	}
	.tg.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
	}
	.tg.on::after {
		left: 16px;
		background: var(--color-good);
	}
	.dtray {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 6px;
	}
	.dbtn {
		font-family: var(--font-display);
		font-weight: 700;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		border-radius: 9px;
		padding: 10px 14px;
		cursor: pointer;
	}
	.dbtn:hover {
		border-color: var(--color-accent);
	}
	.dres {
		font-family: var(--font-mono);
		margin: 8px 6px 4px;
	}
	.dres b {
		color: var(--color-good);
		font-size: 18px;
	}
</style>
