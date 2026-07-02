<script lang="ts">
	// Combat sheet — faithful bake of design-preview/d-charnik.html (+ d-menus overlays),
	// fed by the live pipeline (deriveSheet over the real content graph). Collapsible +
	// drag-reorderable panels, working menus (dice tray, condition/effect pickers, roll
	// log, show/hide), pins, provenance on hover.
	import { onMount } from 'svelte';
	import { dndzone } from 'svelte-dnd-action';
	import { toast } from 'svelte-sonner';
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
	// Panel layout = two independent column arrays (svelte-dnd-action items need an id).
	// A panel's slot in its column is its position, so a neighbour's height never moves it.
	let columns = $state<{ id: string }[][]>([
		[{ id: 'skills' }, { id: 'spells' }, { id: 'effects' }],
		[{ id: 'attacks' }, { id: 'actions' }]
	]);
	let dragDisabled = $state(true); // drag only after the ⠿ grip arms it (handle-only)
	const flipDurationMs = 150;
	// menus open as dropdowns anchored under their trigger button (not centered modals)
	let overlay = $state<null | {
		kind: string;
		top: number;
		left: number | null;
		right: number | null;
	}>(null);
	function openMenu(kind: string, e: Event) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const anchorRight = r.left > window.innerWidth / 2;
		// document coords (+scroll) so the dropdown scrolls WITH the page/button, not the viewport
		overlay = {
			kind,
			top: r.bottom + window.scrollY + 6,
			left: anchorRight ? null : r.left + window.scrollX,
			right: anchorRight ? document.documentElement.clientWidth - r.right : null
		};
	}
	let log = $state<{ label: string; expr: string; total: number; adv?: [number, number] }[]>([]);
	let hiddenActions = $state<Record<string, boolean>>({});
	// dice tray / roll builder
	let dice = $state<Record<number, number>>({ 20: 1 }); // sides → count in the pool
	let rollMod = $state(0);
	let rollAdv = $state(0); // −1 disadvantage · 0 normal · +1 advantage
	let rollSrc = $state<string | null>(null);
	let tempHpInput = $state(5);
	let customEffectLabel = $state('');
	function addCustomEffect() {
		if (customEffectLabel.trim()) addEffect(customEffectLabel.trim(), [], true);
		customEffectLabel = '';
	}
	const DICE = [4, 6, 8, 10, 12, 20, 100];
	function openDice(e: Event) {
		dice = { 20: 1 };
		rollMod = 0;
		rollAdv = 0;
		rollSrc = null;
		openMenu('dice', e);
	}
	function bumpDie(sides: number, d: number) {
		const n = (dice[sides] ?? 0) + d;
		if (n <= 0) delete dice[sides];
		else dice[sides] = n;
		dice = { ...dice };
	}
	const rollExpr = $derived(
		Object.entries(dice)
			.sort((a, b) => Number(b[0]) - Number(a[0]))
			.map(([s, c]) => `${c}d${s}`)
			.join(' + ') + (rollMod ? ` ${signed(rollMod)}` : '')
	);
	function doRoll() {
		const parts: string[] = [];
		let total = 0;
		let adv: [number, number] | undefined; // [kept, dropped] for the adv/disadv d20
		for (const [s, c] of Object.entries(dice).sort((a, b) => Number(b[0]) - Number(a[0]))) {
			const sides = Number(s);
			for (let k = 0; k < c; k++) {
				const v = 1 + Math.floor(Math.random() * sides);
				if (sides === 20 && rollAdv !== 0 && k === 0) {
					// roll TWO d20 and keep the winner; the loser is shown struck through
					const v2 = 1 + Math.floor(Math.random() * 20);
					const kept = rollAdv > 0 ? Math.max(v, v2) : Math.min(v, v2);
					adv = [kept, kept === v ? v2 : v];
					total += kept;
					continue; // the adv detail renders the d20, don't duplicate it in parts
				}
				total += v;
				parts.push(`d${sides}(${v})`);
			}
		}
		total += rollMod;
		const label = rollSrc ?? 'Custom roll';
		const expr = parts.join(' + ') + (rollMod ? ` ${signed(rollMod)}` : '');
		log = [{ label, expr, total, adv }, ...log].slice(0, 200);
		const advTxt = adv ? `d20 ${adv[0]} (drop ${adv[1]}) ` : '';
		toast(`${label} — ${total}`, { description: `${advTxt}${expr}`.trim() });
	}
	function setTempHp() {
		if (character) character.play.hp.temp = Math.max(0, tempHpInput);
		overlay = null;
	}
	const GROUP_MODES = ['level', 'prepared', 'school'] as const;
	let spellGroupBy = $state<(typeof GROUP_MODES)[number]>('level');
	const groupByLabel = $derived(
		{ level: 'By level', prepared: 'Prepared', school: 'By school' }[spellGroupBy]
	);
	const cycleGroupBy = () =>
		(spellGroupBy = GROUP_MODES[(GROUP_MODES.indexOf(spellGroupBy) + 1) % GROUP_MODES.length]);
	let passiveSkills = $state<string[]>(['perception', 'investigation', 'insight']);

	onMount(async () => {
		graph = await getContentGraph();
		character = demoCharacter();
		sheet = deriveSheet(character, graph);
		// restore this character's saved panel layout (falls back to the default columns)
		const saved = character.ui.panelColumns;
		if (saved?.length) columns = saved.map((col) => col.map((id) => ({ id })));
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

	// open the roll builder prefilled + anchored, so the player can pick advantage then Roll
	function openRoll(label: string, diceObj: Record<number, number>, mod: number, e: Event) {
		rollSrc = label;
		dice = { ...diceObj };
		rollMod = mod;
		rollAdv = 0;
		openMenu('dice', e);
	}
	// roll a dice pool immediately (no advantage — that lives in the builder)
	function rollDiceNow(label: string, diceObj: Record<number, number>, mod: number) {
		const parts: string[] = [];
		let total = 0;
		for (const [s, c] of Object.entries(diceObj).sort((a, b) => Number(b[0]) - Number(a[0]))) {
			const sides = Number(s);
			for (let k = 0; k < c; k++) {
				const v = 1 + Math.floor(Math.random() * sides);
				total += v;
				parts.push(`d${sides}(${v})`);
			}
		}
		total += mod;
		const expr = parts.join(' + ') + (mod ? ` ${signed(mod)}` : '');
		log = [{ label, expr, total }, ...log].slice(0, 200);
		toast(`${label} — ${total}`, { description: expr });
	}
	// EVERY roll site: normal tap rolls instantly; Alt/Ctrl-click opens the prefilled tray
	// (advantage / disadvantage / custom dice).
	const wantsTray = (e: Event) => {
		const m = e as MouseEvent;
		return m.altKey || m.ctrlKey || m.metaKey;
	};
	function roll(label: string, mod: number, e: Event) {
		if (wantsTray(e)) openRoll(label, { 20: 1 }, mod, e);
		else rollDiceNow(label, { 20: 1 }, mod);
	}
	const parseDice = (s: string): Record<number, number> => {
		const out: Record<number, number> = {};
		for (const m of s.matchAll(/(\d+)d(\d+)/gi))
			out[Number(m[2])] = (out[Number(m[2])] ?? 0) + Number(m[1]);
		return out;
	};

	const PANEL_TITLE: Record<string, string> = {
		skills: 'Skills',
		attacks: 'Attacks',
		spells: 'Spells',
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
	function cast(r: SpRow, e: Event) {
		const alt = wantsTray(e);
		// a damaging spell rolls its damage dice (uniform: Fire Bolt 1d10, Fireball 8d6…);
		if (r.dmg && Object.keys(r.dmg).length) {
			const label = `${r.name} damage`;
			if (alt) openRoll(label, r.dmg, 0, e);
			else rollDiceNow(label, r.dmg, 0);
		} else if (r.res === 'hit' && sheet?.spellcasting) {
			// non-damage attack spell → the to-hit roll
			const m = sheet.spellcasting.attack.value;
			const label = `${r.name} (spell attack)`;
			if (alt) openRoll(label, { 20: 1 }, m, e);
			else rollDiceNow(label, { 20: 1 }, m);
		} else {
			log = [{ label: `Cast ${r.name}`, expr: '', total: NaN }, ...log].slice(0, 200);
			toast(`Cast ${r.name}`);
		}
	}
	// tap a slot pip: click a filled pip to spend down to it, a spent pip to restore up to it
	function slotClick(key: string, full: number, spent: number, i: number) {
		if (!character) return;
		const remaining = full - spent;
		const newSpent = i < remaining ? full - i : full - i - 1;
		character.play.spellSlotsSpent[key] = Math.max(0, Math.min(full, newSpent));
	}
	// tap a spell's prep dot to prepare/unprepare it (always-prepared can't be unset)
	function togglePrepared(r: SpRow) {
		if (!character || r.prep === 'always') return;
		const sp = character.build.spells.find((s) => s.spell.endsWith(`:${r.id}`));
		if (sp) sp.prepared = !sp.prepared;
	}
	// a bounded-vocab effect token → a short readable tag ("flat-bonus:ac+2" → "AC +2")
	function effectTag(token: string): string {
		const m = token.match(/^flat-bonus:(\w+)([+-].+)$/);
		if (m) return `${m[1] === 'ac' ? 'AC' : m[1]} ${m[2]}`;
		return token.replace(/[-:]/g, ' ');
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
		ct: '' | 'react' | 'bonus'; // casting time → icon before the level
		dmg: Record<number, number> | null; // parsed damage dice (for casting)
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
							? 'auto'
							: '',
			tm: lvl === 0 ? 'cantrip' : ordinal(lvl),
			ct: castingIcon(String(row.data.casting_time ?? '')),
			dmg: dmg ? parseDice(dmg) : null,
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

		if (spellGroupBy === 'level') {
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
		} else if (spellGroupBy === 'prepared') {
			const prep = all.filter((x) => x.row.prep).map((x) => x.row);
			const rest = all.filter((x) => !x.row.prep).map((x) => x.row);
			if (prep.length) groups.push({ key: 'prep', label: 'Prepared', slots: null, rows: prep });
			if (rest.length)
				groups.push({ key: 'unprep', label: 'Not prepared', slots: null, rows: rest });
		} else {
			const bySchool = new Map<string, SpRow[]>();
			for (const x of all) {
				const sch = String(graph!.get(x.sp.spell)!.data.school || 'Other');
				(bySchool.get(sch) ?? bySchool.set(sch, []).get(sch)!).push(x.row);
			}
			for (const sch of [...bySchool.keys()].sort())
				groups.push({
					key: 'sch:' + sch,
					label: titleCase(sch),
					slots: null,
					rows: bySchool.get(sch)!
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
	const castingIcon = (ct: string): SpRow['ct'] =>
		/bonus/i.test(ct) ? 'bonus' : /reaction/i.test(ct) ? 'react' : '';

	const hpBar = $derived.by(() => {
		if (!character || !sheet) return { cur: 0, tmp: 0 };
		const max = character.play.hp.max ?? sheet.maxHp.value;
		return {
			cur: Math.max(0, Math.min(100, (character.play.hp.current / max) * 100)),
			tmp: (character.play.hp.temp / max) * 100
		};
	});

	// svelte-dnd-action: sync each column on drag consider + finalize; re-lock the grip.
	function dndConsider(ci: number, e: CustomEvent<{ items: { id: string }[] }>) {
		columns[ci] = e.detail.items;
	}
	function dndFinalize(ci: number, e: CustomEvent<{ items: { id: string }[] }>) {
		columns[ci] = e.detail.items;
		dragDisabled = true;
		// persist the layout ON THE CHARACTER (round-trips once save/load is wired)
		if (character) character.ui.panelColumns = columns.map((col) => col.map((x) => x.id));
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
<svelte:window onpointerup={() => (dragDisabled = true)} />

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
			<div class="lab">
				<span>Hit points</span>
				<button class="temptag" onclick={(e) => openMenu('temphp', e)}>＋ Temp HP</button>
			</div>
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
		<span class="spacer"></span>
		<button class="toggle auto on">⚙ Auto-calc <span class="sw">ON</span></button>
		<button class="toggle dice" onclick={openDice}>🎲 Dice tray</button>
	</section>

	<section class="turnbar">
		<span class="lbl">Turn</span>
		<span class="ae">Action <span class="aepips"><i class="aedot"></i></span></span>
		<span class="ae">Bonus <span class="aepips"><i class="aedot"></i></span></span>
		<span class="ae">Reaction <span class="aepips"><i class="aedot"></i></span></span>
		<span class="ae move">🦶 Move <b>{s.speed.value}</b> / {s.speed.value} ft</span>
		<span class="spacer"></span>
		<button class="nextturn">Next turn ▸</button>
	</section>

	<div class="playbar">
		<span class="phint"
			>Tap any check · save · attack · spell to roll it · <b>Alt + click</b> (or Ctrl) for advantage /
			custom dice.</span
		>
		<button class="rollout" onclick={(e) => openMenu('log', e)}>
			🎲 {#if log[0]}Last · <b>{log[0].label}</b> <i>{log[0].expr}</i> =
				<span class="res">{log[0].total}</span>{:else}<i>no rolls yet</i>{/if}<span class="logcue"
				>▸ log</span
			>
		</button>
	</div>

	<div class="sectlab">
		<button class="slabtoggle" onclick={() => toggle('combat')}
			><span class="chev">{collapsed.combat ? '▸' : '▾'}</span>Combat</button
		>
	</div>
	{#if !collapsed.combat}
		<section class="combat">
			<button class="tile" title={why(s.ac)} onclick={(e) => roll('AC (touch)', 0, e)}>
				<div class="k">Armor class</div>
				<div class="v">{s.ac.value}</div>
				<div class="t">{s.ac.trace.map((x) => `${x.source} ${signed(x.amount)}`).join(' ')}</div>
			</button>
			<button
				class="tile"
				title={why(s.initiative)}
				onclick={(e) => roll('Initiative', s.initiative.value, e)}
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
			<button class="edit" onclick={(e) => openMenu('pinskills', e)}>✎ Pin skills</button>
		</div>
	{/if}

	<div class="sectlab">
		<button class="slabtoggle" onclick={() => toggle('abilities')}
			><span class="chev">{collapsed.abilities ? '▸' : '▾'}</span>Abilities</button
		><em>tap to roll a check or save</em>
	</div>
	{#if !collapsed.abilities}
		<section class="grid">
			{#each ABIL as ab (ab)}
				{@const a = s.abilities[ab]}
				{@const prof = a.save.trace.some((t) => t.layer === 'proficiency')}
				<button class="ab" onclick={(e) => roll(`${ab.toUpperCase()} check`, a.mod, e)}>
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
							roll(`${ab.toUpperCase()} save`, a.save.value, e);
						}}
					>
						<i class="pdot" class:on={prof}></i>SAVE <b>{signed(a.save.value)}</b>
					</span>
				</button>
			{/each}
		</section>
	{/if}

	{#snippet panelCard(pid: string)}
		<div class="phead">
			<button class="htoggle" onclick={() => toggle(pid)}>
				<span class="chev">{collapsed[pid] ? '▸' : '▾'}</span>{PANEL_TITLE[pid]}
			</button>
			{#if pid === 'actions'}
				<button class="grpby" onclick={(e) => openMenu('showhide', e)}>👁 Show / hide</button>
			{:else if pid === 'effects'}
				<button class="grpby" onclick={(e) => openMenu('addeffect', e)}>＋ Add effect</button>
			{:else if pid === 'spells' && s.spellcasting}
				<span class="prepct">Prepared <b>{preparedCount}</b> / {preparedCap}</span>
				<button class="grpby" onclick={cycleGroupBy} title="Change grouping"
					>{groupByLabel} ▾</button
				>
				<button class="grpby" onclick={(e) => openMenu('manage', e)}>⛭ Manage all</button>
			{/if}
			<span class="dh" title="drag to reorder" onpointerdown={() => (dragDisabled = false)}>⠿</span>
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
										onclick={(e) => roll(titleCase(skill), sk.value, e)}
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
					<button class="atk" onclick={(e) => roll(at.name, at.toHit, e)}>
						<span class="an">{at.name}</span><span class="ah">{signed(at.toHit)}</span>
						<span class="ad">{at.dmg}</span><span class="am">{at.meta}</span>
					</button>
				{/each}
			{:else if pid === 'actions'}
				{#each visibleActions as a (a.id)}
					<button class="atk" onclick={(e) => a.roll && roll(a.roll[0], a.roll[1], e)}>
						<span class="an">{a.n}</span><span class="ah">{a.h || '—'}</span>
						<span class="ad">{a.d}</span><span class="am">{a.m}</span>
					</button>
				{/each}
			{:else if pid === 'effects'}
				{#each c.play.effects as e (e.iid)}
					<div class="eff" class:pos={e.positive} class:neg={!e.positive}>
						<span class="d"></span>
						<div class="body">
							<b>{e.label}</b>
							{#if e.effects.length || e.durationRounds}<span class="etags"
									>{#each e.effects as t (t)}<span class="etag">{effectTag(t)}</span
										>{/each}{#if e.durationRounds}<span class="durpill">{e.durationRounds} rds</span
										>{/if}</span
								>{/if}
						</div>
					</div>
				{:else}<p class="trace">No active effects.</p>{/each}
			{:else if pid === 'spells' && s.spellcasting}
				<div class="castline">
					Save DC <b>{s.spellcasting.saveDC.value}</b> · attack
					<b>{signed(s.spellcasting.attack.value)}</b> — every spell
				</div>
				<div class="sprows">
					{#each spellGroups as g (g.key)}
						<div class="spgroup">
							<div class="scat" class:star={g.key === 'pinned'}>
								{g.label}
								{#if g.slots}{@const sl = g.slots}<span class="pips"
										>{#each Array(sl.full) as _, i (i)}<button
												class="pip"
												class:full={i < sl.full - sl.spent}
												class:spent={i >= sl.full - sl.spent}
												title="tap to spend / restore"
												onclick={() => slotClick(g.key, sl.full, sl.spent, i)}
											></button>{/each}</span
									>{/if}
							</div>
							{#each g.rows as r (g.key + r.id)}
								<button class="sprow" onclick={(e) => cast(r, e)}>
									<span class="an">
										<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
										<i
											class="prep"
											class:on={r.prep === 'on'}
											class:always={r.prep === 'always'}
											title={r.prep === 'always' ? 'always prepared' : 'tap to prepare / unprepare'}
											onclick={(e) => {
												e.stopPropagation();
												togglePrepared(r);
											}}
										></i>
										<span class="nm">{r.name}</span>
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
									</span>
									<span class="spe">{r.spe}</span>
									{#if r.res}<span class="rtag {r.res}">{r.resLabel}</span>{:else}<span></span>{/if}
									<span class="tm"
										>{#if r.ct}<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions --><i
												class="ct"
												title={r.ct === 'react' ? 'reaction' : 'bonus action'}
												onclick={(e) => {
													e.stopPropagation();
													toast(`Casting time: ${r.ct === 'react' ? 'reaction' : 'bonus action'}`);
												}}>{r.ct === 'react' ? '↩' : '⚡'}</i
											>{/if}{r.tm}</span
									>
								</button>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/snippet}

	<section class="panels">
		{#each columns as col, ci (ci)}
			<div
				class="pcol"
				use:dndzone={{
					items: col,
					type: 'panel',
					dragDisabled,
					flipDurationMs,
					dropTargetStyle: {}
				}}
				onconsider={(e) => dndConsider(ci, e)}
				onfinalize={(e) => dndFinalize(ci, e)}
			>
				{#each col as item (item.id)}
					<div class="card">{@render panelCard(item.id)}</div>
				{/each}
			</div>
		{/each}
	</section>
	<!-- overlays — d-menus dropdowns, anchored under their trigger -->
	{#if overlay}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="ovbg" onclick={() => (overlay = null)}></div>
		<div
			class="pop"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			style="top:{overlay.top}px; {overlay.left != null
				? `left:${overlay.left}px`
				: `right:${overlay.right}px`}"
		>
			{#if overlay.kind === 'dice'}
				<div class="tray">
					{#if rollSrc}<div class="tray-src"><b>{rollSrc}</b></div>{/if}
					<div class="pool">
						{#each Object.entries(dice).sort((a, b) => Number(b[0]) - Number(a[0])) as [s, c] (s)}
							<div class="poolchip">
								<button onclick={() => bumpDie(Number(s), -1)}>−</button><b>{c}</b>×d{s}<button
									onclick={() => bumpDie(Number(s), 1)}>+</button
								>
							</div>
						{/each}
					</div>
					<p class="gridhint">tap a die to add · ± sets the count</p>
					<div class="dice-grid">
						{#each DICE as d (d)}<button class="die" onclick={() => bumpDie(d, 1)}>d{d}</button
							>{/each}
					</div>
					<div class="advrow">
						<button class="seg" class:on={rollAdv === -1} onclick={() => (rollAdv = -1)}
							>Disadv.</button
						>
						<button class="seg" class:on={rollAdv === 0} onclick={() => (rollAdv = 0)}
							>Normal</button
						>
						<button class="seg" class:on={rollAdv === 1} onclick={() => (rollAdv = 1)}
							>Advant.</button
						>
					</div>
					<div class="modrow">
						<div class="mod">
							<button onclick={() => (rollMod -= 1)}>−</button> mod {signed(rollMod)}
							<button onclick={() => (rollMod += 1)}>+</button>
						</div>
						<button class="rollbtn" onclick={doRoll}>Roll {rollExpr}</button>
					</div>
					{#if log[0]}<div class="hist">
							{log[0].label}
							{#if log[0].adv}d20 <b class="res">{log[0].adv[0]}</b>
								<s class="drop">{log[0].adv[1]}</s>{/if}
							{log[0].expr}{log[0].expr ? ' ' : ''}=
							<span class="res">{Number.isNaN(log[0].total) ? '' : log[0].total}</span>
						</div>{/if}
				</div>
			{:else if overlay.kind === 'temphp'}
				<div class="ph">
					<div class="pop-h" style="border: 0">Set temporary HP</div>
					<div class="field">
						<input type="number" bind:value={tempHpInput} />
						<button class="set" onclick={setTempHp}>Set</button>
					</div>
					<p class="note">
						Separate pool — teal in the HP bar. Doesn't stack; takes the higher value.
					</p>
				</div>
			{:else if overlay.kind === 'addeffect'}
				<div class="search"><span class="mag">🔍</span><input placeholder="Search effects…" /></div>
				<div class="sec">Catalog · presets</div>
				{#each EFFECT_PRESETS as p (p.label)}
					<button class="row" onclick={() => addEffect(p.label, p.tokens, !/bane/i.test(p.label))}>
						<span class="main"
							><span class="ic" class:neg={/bane/i.test(p.label)}>＋</span>{p.label}</span
						><span class="durpill">10 rds</span>
					</button>
				{/each}
				<div class="divlite"></div>
				<button
					class="row"
					onclick={() => overlay && (overlay = { ...overlay, kind: 'customeffect' })}
				>
					<span class="main"><span class="ic">✎</span><b>Custom effect…</b></span><span class="meta"
						>text + manual mod</span
					>
				</button>
			{:else if overlay.kind === 'customeffect'}
				<div class="ph">
					<div class="pop-h" style="border: 0">Custom effect</div>
					<div class="field">
						<!-- svelte-ignore a11y_autofocus -->
						<input placeholder="Effect name…" bind:value={customEffectLabel} autofocus />
						<button class="set" onclick={addCustomEffect}>Add</button>
					</div>
					<p class="note">
						Inert text marker — add a manual modifier in the effects panel if needed.
					</p>
				</div>
			{:else if overlay.kind === 'log'}
				<div class="cardhead2"><span class="ttl">Roll log · history</span></div>
				<div class="logscroll">
					{#each log as l, i (i)}
						<div class="logrow">
							<div class="lr-top">
								<b>{l.label}</b><span class="lr-tot" class:res={!Number.isNaN(l.total)}
									>{Number.isNaN(l.total) ? '—' : l.total}</span
								>
							</div>
							{#if l.expr || l.adv}<div class="lr-sub">
									{#if l.adv}d20 <b>{l.adv[0]}</b> <s class="drop">{l.adv[1]}</s>
									{/if}{l.expr}
								</div>{/if}
						</div>
					{:else}<p class="note" style="padding: 11px 13px">
							No rolls yet — tap a stat, skill, save, or attack.
						</p>{/each}
				</div>
			{:else if overlay.kind === 'showhide'}
				<div class="pop-h">
					Which actions appear<button class="ovx" onclick={() => (overlay = null)}>✕</button>
				</div>
				{#each actions as a (a.id)}
					<button class="row" onclick={() => (hiddenActions[a.id] = !hiddenActions[a.id])}>
						<span class="eye" class:on={!hiddenActions[a.id]}></span><span class="main">{a.n}</span
						>{#if hiddenActions[a.id]}<span class="meta">hidden</span>{/if}
					</button>
				{/each}
			{:else if overlay.kind === 'pinskills'}
				<div class="pop-h">
					Passive senses · 👁 = shown<button class="ovx" onclick={() => (overlay = null)}>✕</button>
				</div>
				<div class="pinwrap">
					{#each ABIL as ab (ab)}
						{@const list = Object.keys(SKILL_ABILITY).filter((k) => SKILL_ABILITY[k] === ab)}
						{#if list.length}
							<div class="catblock">
								<div class="sec">{ABILITY_NAME[ab]}</div>
								{#each list as skill (skill)}
									<button class="row" onclick={() => togglePassive(skill)}>
										<span class="eye" class:on={passiveSkills.includes(skill)}></span><span
											class="nm">{titleCase(skill)}</span
										>
									</button>
								{/each}
							</div>
						{/if}
					{/each}
				</div>
			{:else if overlay.kind === 'manage'}
				<div class="pop-h">
					Spellbook<button class="ovx" onclick={() => (overlay = null)}>✕</button>
				</div>
				<p class="note" style="padding: 11px 13px">
					Full spellbook manager arrives with the spell-manager view (d-spellmgr).
				</p>
			{:else if overlay.kind === 'condition'}
				<div class="pop-h">
					Conditions · multi-select<button class="ovx" onclick={() => (overlay = null)}>✕</button>
				</div>
				{#each conditionList as cn (cn)}
					{@const added = character?.play.effects.some((e) => e.label === cn)}
					<button class="row" onclick={() => (added ? null : addEffect(cn, [], false))}>
						<span class="main">{cn}</span><span class="tg" class:on={added}></span>
					</button>
				{/each}
			{/if}
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
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
	}
	.toggle.conc.on .sw {
		border-color: var(--color-accent);
		color: var(--color-accent-bright);
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
	/* whole label clickable to collapse (chev + name), no button box */
	.slabtoggle {
		display: inline-flex;
		align-items: center;
		background: transparent;
		border: 0;
		cursor: pointer;
		color: var(--color-text-muted);
		font: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		padding: 3px 6px 3px 2px;
		border-radius: var(--radius-sm);
	}
	.slabtoggle:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
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
		font-size: 12px;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}
	.ab .n b {
		color: var(--color-text);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
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
		font-size: 12px;
		line-height: 1;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 5px 6px;
		cursor: pointer;
	}
	.ab .sv:hover {
		border-color: var(--color-accent);
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.ab .sv b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 12px;
		line-height: 1;
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

	/* Two flex columns (not multicol): drag-safe with svelte-dnd-action, packs tight
	   top-to-bottom so a block's height never bumps another into the next column. */
	.panels {
		display: flex;
		gap: 18px;
		align-items: stretch;
	}
	/* stretch + min-height so the whole column (incl. empty tail below the last card)
	   is inside the dndzone → a panel can be dropped anywhere in the other column. */
	.pcol {
		flex: 1;
		min-width: 0;
		min-height: 160px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	@media (max-width: 760px) {
		.panels {
			flex-direction: column;
		}
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 17px;
	}
	.grpby {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 7px;
		padding: 5px 11px;
		cursor: pointer;
	}
	.grpby:hover {
		color: var(--color-text);
		border-color: var(--color-border-strong);
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
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 6px 0 3px;
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
		align-items: center;
		gap: 10px;
		padding: 9px 0;
		border-top: 1px solid var(--color-border);
	}
	.eff:first-of-type {
		border-top: 0;
	}
	.eff .body {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
	}
	.eff .d {
		width: 8px;
		height: 8px;
		border-radius: 50%;
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
	.etags {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 5px;
		margin-left: auto;
	}
	.etag {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.eff.pos .etag {
		color: var(--color-good);
		border-color: var(--color-good);
	}
	.eff.neg .etag {
		color: var(--color-accent-bright);
		border-color: var(--color-accent);
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
	.sprows {
		margin-top: 2px;
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
		padding: 0;
		border-radius: 50%;
		border: 1px solid #2c4a45;
		cursor: pointer;
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
		/* fixed columns so effect/tag/timing line up across rows even when a row has no
		   resolution pill (its cell stays empty but keeps its width) */
		grid-template-columns: minmax(0, 1fr) 76px 74px 46px;
		align-items: center;
		gap: 8px;
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
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.sprow .an .nm {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sprow .pinstar {
		flex: none;
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
	.sprow .tm .ct {
		font-style: normal;
		margin-right: 6px;
		color: var(--color-accent-bright);
		cursor: help;
	}
	.prep {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border-strong);
		margin-right: 8px;
		vertical-align: middle;
		cursor: pointer;
	}
	.prep.always {
		cursor: default;
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
	/* transparent catcher: click outside the dropdown closes it */
	.ovbg {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: 50;
	}
	.pop {
		position: absolute;
		width: min(300px, calc(100vw - 1.5rem));
		max-height: 72vh;
		overflow: auto;
		z-index: 51;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 13px;
		box-shadow: 0 18px 40px #000a;
		padding-bottom: 6px;
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
	/* --- section label + search + divider (d-menus) --- */
	.sec {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
		padding: 8px 13px 3px;
	}
	.divlite {
		height: 1px;
		background: var(--color-border);
		margin: 4px 0;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 13px;
		border-bottom: 1px solid var(--color-border);
		font-size: 14px;
	}
	.search input {
		all: unset;
		flex: 1;
		color: var(--color-text);
	}
	.search .mag {
		color: var(--color-text-muted);
	}
	.durpill {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-resource);
		border: 1px solid var(--color-resource);
		border-radius: 5px;
		padding: 1px 6px;
	}
	/* --- dice tray / roll builder --- */
	.tray {
		padding: 12px;
	}
	.tray-src {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		padding: 8px 11px;
		margin-bottom: 9px;
	}
	.tray-src b {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
	}
	.pool {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
		margin-bottom: 9px;
	}
	.poolchip {
		display: flex;
		align-items: center;
		gap: 5px;
		background: var(--color-resource-soft);
		border: 1px solid var(--color-resource);
		border-radius: 8px;
		padding: 4px 8px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-resource);
	}
	.poolchip button {
		all: unset;
		cursor: pointer;
		color: var(--color-resource);
		font-size: 14px;
		padding: 0 2px;
	}
	.poolchip b {
		font-family: var(--font-display);
		font-weight: 700;
	}
	.gridhint {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 0 0 7px;
	}
	.dice-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 7px;
		margin-bottom: 11px;
	}
	.die {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
		text-align: center;
		padding: 9px 0;
		border-radius: 9px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
	}
	.die:hover {
		border-color: var(--color-resource);
	}
	.advrow {
		display: flex;
		gap: 6px;
		margin-bottom: 11px;
	}
	.seg {
		flex: 1;
		text-align: center;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 7px 0;
		border-radius: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.seg.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.modrow {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mod {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 7px 9px;
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.mod button {
		all: unset;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 15px;
		padding: 0 4px;
	}
	.rollbtn {
		flex: 1;
		text-align: center;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
		color: #fff;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		border-radius: 9px;
		padding: 9px 12px;
		cursor: pointer;
	}
	.hist {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-border);
		margin-top: 10px;
		padding-top: 9px;
	}
	.hist .res {
		color: var(--color-good);
		font-weight: 700;
	}
	/* --- temp HP --- */
	.ph {
		padding: 12px 13px;
	}
	.field {
		display: flex;
		gap: 8px;
		margin: 6px 0 8px;
	}
	.field input {
		flex: 1;
		min-width: 0;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text);
		font: inherit;
		padding: 8px 10px;
	}
	.set {
		font-family: var(--font-display);
		font-weight: 700;
		background: var(--color-good-soft);
		border: 1px solid var(--color-good);
		color: var(--color-good);
		border-radius: 8px;
		padding: 8px 14px;
		cursor: pointer;
	}
	.note {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 0;
	}
	/* --- pin skills (two-column) --- */
	.pinwrap {
		column-count: 2;
		column-gap: 14px;
		column-rule: 1px solid var(--color-border);
		padding: 7px;
	}
	.pinwrap .catblock {
		break-inside: avoid;
	}
	.pinwrap .sec {
		padding: 6px 6px 2px;
	}
	.pinwrap .row .nm {
		font-size: 13px;
	}
	/* --- roll log --- */
	.cardhead2 {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 11px 13px 6px;
	}
	.cardhead2 .ttl {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.logscroll {
		padding: 0 6px 4px;
	}
	.logrow {
		padding: 7px 7px;
		border-top: 1px solid var(--color-border);
	}
	.logrow:first-child {
		border-top: 0;
	}
	.lr-top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.lr-top b {
		flex: 1;
		font-weight: 600;
	}
	.lr-tot {
		font-family: var(--font-display);
		font-weight: 700;
	}
	.lr-tot.res {
		color: var(--color-good);
	}
	.lr-sub {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 2px;
	}
	.lr-sub b {
		color: var(--color-good);
	}
	/* the dropped die of an advantage/disadvantage pair */
	.drop {
		color: var(--color-text-muted);
		text-decoration: line-through;
		opacity: 0.7;
	}
</style>
