/*
 * The Combat view-model: all reactive state ($state), derived values ($derived) and
 * actions for the sheet, in one typed class. A single shared instance (`combat`) is
 * imported by +page.svelte and the area components, so they operate on one state without
 * prop-drilling. Split out of the old monolithic combat/+page.svelte — behaviour unchanged.
 *
 * Methods are arrow-function fields so they can be destructured / passed to markup with the
 * correct `this`. Pure helpers live in $lib/combat/helpers.
 */
import { toast } from 'svelte-sonner';
import { demoCharacter } from '$lib/demo/sheet';
import { getContentGraph } from '$lib/content/provider';
import { deriveSheet, type CharacterSheet } from '$lib/character/derive';
import { fullCasterSlots, passiveScore } from '$lib/rules/core';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import {
	signed,
	titleCase,
	ordinal,
	wantsTray,
	spellRow,
	GROUP_MODES,
	type GroupMode,
	type Atk,
	type SpRow,
	type SpGroup
} from '$lib/combat/helpers';

class CombatVM {
	graph = $state<ContentGraph | null>(null);
	character = $state<Character | null>(null);
	sheet = $state<CharacterSheet | null>(null);

	// play / UI state
	round = $state(1);
	shieldOn = $state(false);
	collapsed = $state<Record<string, boolean>>({});
	pinned = $state<Record<string, boolean>>({ 'fire-bolt': true, shield: true });
	// Panel layout = two independent column arrays (svelte-dnd-action items need an id).
	columns = $state<{ id: string }[][]>([
		[{ id: 'skills' }, { id: 'spells' }, { id: 'effects' }],
		[{ id: 'attacks' }, { id: 'actions' }]
	]);
	dragDisabled = $state(true); // drag only after the ⠿ grip arms it (handle-only)
	flipDurationMs = 150;
	// menus open as dropdowns anchored under their trigger button (not centered modals)
	overlay = $state<null | {
		kind: string;
		top: number;
		left: number | null;
		right: number | null;
	}>(null);
	log = $state<{ label: string; expr: string; total: number; adv?: [number, number] }[]>([]);
	hiddenActions = $state<Record<string, boolean>>({});
	// dice tray / roll builder
	dice = $state<Record<number, number>>({ 20: 1 }); // sides → count in the pool
	rollMod = $state(0);
	rollAdv = $state(0); // −1 disadvantage · 0 normal · +1 advantage
	rollSrc = $state<string | null>(null);
	tempHpInput = $state(5);
	customEffectLabel = $state('');
	spellGroupBy = $state<GroupMode>('level');
	passiveSkills = $state<string[]>(['perception', 'investigation', 'insight']);

	load = async () => {
		this.graph = await getContentGraph();
		this.character = demoCharacter();
		this.sheet = deriveSheet(this.character, this.graph);
		// restore this character's saved panel layout (falls back to the default columns)
		const saved = this.character.ui.panelColumns;
		if (saved?.length) this.columns = saved.map((col) => col.map((id) => ({ id })));
	};

	openMenu = (kind: string, e: Event) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const anchorRight = r.left > window.innerWidth / 2;
		// document coords (+scroll) so the dropdown scrolls WITH the page/button, not the viewport
		this.overlay = {
			kind,
			top: r.bottom + window.scrollY + 6,
			left: anchorRight ? null : r.left + window.scrollX,
			right: anchorRight ? document.documentElement.clientWidth - r.right : null
		};
	};

	addCustomEffect = () => {
		if (this.customEffectLabel.trim()) this.addEffect(this.customEffectLabel.trim(), [], true);
		this.customEffectLabel = '';
	};

	openDice = (e: Event) => {
		this.dice = { 20: 1 };
		this.rollMod = 0;
		this.rollAdv = 0;
		this.rollSrc = null;
		this.openMenu('dice', e);
	};

	bumpDie = (sides: number, d: number) => {
		const n = (this.dice[sides] ?? 0) + d;
		if (n <= 0) delete this.dice[sides];
		else this.dice[sides] = n;
		this.dice = { ...this.dice };
	};

	rollExpr = $derived(
		Object.entries(this.dice)
			.sort((a, b) => Number(b[0]) - Number(a[0]))
			.map(([s, c]) => `${c}d${s}`)
			.join(' + ') + (this.rollMod ? ` ${signed(this.rollMod)}` : '')
	);

	doRoll = () => {
		const parts: string[] = [];
		let total = 0;
		let adv: [number, number] | undefined; // [kept, dropped] for the adv/disadv d20
		for (const [s, c] of Object.entries(this.dice).sort((a, b) => Number(b[0]) - Number(a[0]))) {
			const sides = Number(s);
			for (let k = 0; k < c; k++) {
				const v = 1 + Math.floor(Math.random() * sides);
				if (sides === 20 && this.rollAdv !== 0 && k === 0) {
					// roll TWO d20 and keep the winner; the loser is shown struck through
					const v2 = 1 + Math.floor(Math.random() * 20);
					const kept = this.rollAdv > 0 ? Math.max(v, v2) : Math.min(v, v2);
					adv = [kept, kept === v ? v2 : v];
					total += kept;
					continue; // the adv detail renders the d20, don't duplicate it in parts
				}
				total += v;
				parts.push(`d${sides}(${v})`);
			}
		}
		total += this.rollMod;
		const label = this.rollSrc ?? 'Custom roll';
		const expr = parts.join(' + ') + (this.rollMod ? ` ${signed(this.rollMod)}` : '');
		this.log = [{ label, expr, total, adv }, ...this.log].slice(0, 200);
		const advTxt = adv ? `d20 ${adv[0]} (drop ${adv[1]}) ` : '';
		toast(`${label} — ${total}`, { description: `${advTxt}${expr}`.trim() });
	};

	setTempHp = () => {
		if (this.character) this.character.play.hp.temp = Math.max(0, this.tempHpInput);
		this.overlay = null;
	};

	groupByLabel = $derived(
		{ level: 'By level', prepared: 'Prepared', school: 'By school' }[this.spellGroupBy]
	);
	cycleGroupBy = () =>
		(this.spellGroupBy =
			GROUP_MODES[(GROUP_MODES.indexOf(this.spellGroupBy) + 1) % GROUP_MODES.length]);

	className = $derived.by(() => {
		if (!this.character || !this.graph) return '';
		const c = this.character.build.classes[0];
		const row = this.graph.get(c.class);
		return row ? `${row.data.name_en} ${c.level}` : `Level ${this.sheet?.level ?? ''}`;
	});
	speciesName = $derived.by(() =>
		this.character?.build.species && this.graph
			? String(this.graph.get(this.character.build.species)?.data.name_en ?? '')
			: ''
	);
	conc = $derived(
		this.character?.play.effects.find((e) => e.label.toLowerCase().includes('bless'))
	);

	// configurable passive-sense skills (Pin skills)
	passives = $derived(
		this.sheet
			? this.passiveSkills.map((k) => ({
					key: k,
					name: titleCase(k),
					comp: passiveScore(this.sheet!.skills[k])
				}))
			: []
	);
	togglePassive = (k: string) => {
		this.passiveSkills = this.passiveSkills.includes(k)
			? this.passiveSkills.filter((x) => x !== k)
			: [...this.passiveSkills, k];
	};

	toggle = (k: string) => (this.collapsed[k] = !this.collapsed[k]);

	// open the roll builder prefilled + anchored, so the player can pick advantage then Roll
	openRoll = (label: string, diceObj: Record<number, number>, mod: number, e: Event) => {
		this.rollSrc = label;
		this.dice = { ...diceObj };
		this.rollMod = mod;
		this.rollAdv = 0;
		this.openMenu('dice', e);
	};
	// roll a dice pool immediately (no advantage — that lives in the builder)
	rollDiceNow = (label: string, diceObj: Record<number, number>, mod: number) => {
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
		this.log = [{ label, expr, total }, ...this.log].slice(0, 200);
		toast(`${label} — ${total}`, { description: expr });
	};
	// EVERY roll site: normal tap rolls instantly; Alt/Ctrl-click opens the prefilled tray
	roll = (label: string, mod: number, e: Event) => {
		if (wantsTray(e)) this.openRoll(label, { 20: 1 }, mod, e);
		else this.rollDiceNow(label, { 20: 1 }, mod);
	};

	// casting a spell: damage/healing spells roll their dice; attack spells roll to hit
	cast = (r: SpRow, e: Event) => {
		const alt = wantsTray(e);
		// a spell with dice rolls them: damage (Fire Bolt 1d10, Fireball 8d6) or, for auto
		// spells, healing (Healing Word 2d4 + spellcasting mod)
		if (r.dmg && Object.keys(r.dmg).length) {
			const heal = r.res === 'auto';
			const label = `${r.name} ${heal ? 'healing' : 'damage'}`;
			const mod =
				heal && this.sheet?.spellcasting
					? this.sheet.abilities[this.sheet.spellcasting.ability].mod
					: 0;
			if (alt) this.openRoll(label, r.dmg, mod, e);
			else this.rollDiceNow(label, r.dmg, mod);
		} else if (r.res === 'hit' && this.sheet?.spellcasting) {
			// non-damage attack spell → the to-hit roll
			const m = this.sheet.spellcasting.attack.value;
			const label = `${r.name} (spell attack)`;
			if (alt) this.openRoll(label, { 20: 1 }, m, e);
			else this.rollDiceNow(label, { 20: 1 }, m);
		} else {
			this.log = [{ label: `Cast ${r.name}`, expr: '', total: NaN }, ...this.log].slice(0, 200);
			toast(`Cast ${r.name}`);
		}
	};

	// tap a slot pip: click a filled pip to spend down to it, a spent pip to restore up to it
	slotClick = (key: string, full: number, spent: number, i: number) => {
		if (!this.character) return;
		const remaining = full - spent;
		const newSpent = i < remaining ? full - i : full - i - 1;
		this.character.play.spellSlotsSpent[key] = Math.max(0, Math.min(full, newSpent));
	};
	// tap a spell's prep dot to prepare/unprepare it (always-prepared can't be unset)
	togglePrepared = (r: SpRow) => {
		if (!this.character) return;
		if (r.tm === 'cantrip') {
			toast('Cantrips are always known — you never prepare them.');
			return;
		}
		if (r.prep === 'always') return;
		const sp = this.character.build.spells.find((s) => s.spell.endsWith(`:${r.id}`));
		if (sp) sp.prepared = !sp.prepared;
	};

	// attacks (equipped weapons + Unarmed Strike)
	attacks = $derived.by<Atk[]>(() => {
		if (!this.character || !this.sheet || !this.graph) return [];
		const prof = this.sheet.proficiencyBonus,
			strMod = this.sheet.abilities.str.mod,
			dexMod = this.sheet.abilities.dex.mod;
		const out: Atk[] = [];
		for (const inv of this.character.build.inventory) {
			if (!inv.equipped) continue;
			const row = this.graph.get(inv.item);
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
	actions = $derived.by(() => {
		const s = this.sheet;
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
	visibleActions = $derived(this.actions.filter((a) => !this.hiddenActions[a.id]));

	spellGroups = $derived.by<SpGroup[]>(() => {
		if (!this.character || !this.graph) return [];
		const character = this.character;
		const graph = this.graph;
		const slots = fullCasterSlots(this.sheet?.level ?? 1);
		const all = character.build.spells
			.map((sp) => ({
				sp,
				row: spellRow(graph, sp.spell, sp.alwaysPrepared ? 'always' : sp.prepared ? 'on' : '')
			}))
			.filter((x): x is { sp: (typeof character.build.spells)[number]; row: SpRow } => !!x.row);
		const groups: SpGroup[] = [];
		const pins = all.filter((x) => this.pinned[x.row.id]);
		if (pins.length)
			groups.push({ key: 'pinned', label: '★ Pinned', slots: null, rows: pins.map((x) => x.row) });

		if (this.spellGroupBy === 'level') {
			const byLevel = new Map<number, SpRow[]>();
			for (const x of all) {
				const lvl = Number(graph.get(x.sp.spell)!.data.level);
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
		} else if (this.spellGroupBy === 'prepared') {
			const prep = all.filter((x) => x.row.prep).map((x) => x.row);
			const rest = all.filter((x) => !x.row.prep).map((x) => x.row);
			if (prep.length) groups.push({ key: 'prep', label: 'Prepared', slots: null, rows: prep });
			if (rest.length)
				groups.push({ key: 'unprep', label: 'Not prepared', slots: null, rows: rest });
		} else {
			const bySchool = new Map<string, SpRow[]>();
			for (const x of all) {
				const sch = String(graph.get(x.sp.spell)!.data.school || 'Other');
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
	preparedCount = $derived(
		this.character?.build.spells.filter((s) => s.prepared).length ?? 0
	);
	preparedCap = $derived((this.sheet?.abilities.int.mod ?? 0) + (this.sheet?.level ?? 0));

	hpBar = $derived.by(() => {
		if (!this.character || !this.sheet) return { cur: 0, tmp: 0 };
		const max = this.character.play.hp.max ?? this.sheet.maxHp.value;
		return {
			cur: Math.max(0, Math.min(100, (this.character.play.hp.current / max) * 100)),
			tmp: (this.character.play.hp.temp / max) * 100
		};
	});

	// svelte-dnd-action: sync each column on drag consider + finalize; re-lock the grip.
	dndConsider = (ci: number, e: CustomEvent<{ items: { id: string }[] }>) => {
		this.columns[ci] = e.detail.items;
	};
	dndFinalize = (ci: number, e: CustomEvent<{ items: { id: string }[] }>) => {
		this.columns[ci] = e.detail.items;
		this.dragDisabled = true;
		// persist the layout ON THE CHARACTER (round-trips once save/load is wired)
		if (this.character) this.character.ui.panelColumns = this.columns.map((col) => col.map((x) => x.id));
	};
	releaseDrag = () => (this.dragDisabled = true); // window pointerup

	conditionList = $derived(
		this.graph
			? this.graph.list('condition', { system: '5.5e' }).map((r) => String(r.data.name_en))
			: []
	);
	addEffect = (label: string, tokens: string[], positive = true) => {
		if (!this.character) return;
		this.character.play.effects = [
			...this.character.play.effects,
			{
				iid: label + Date.now(),
				label,
				effects: tokens,
				positive,
				durationRounds: 10,
				startedRound: this.round
			}
		];
		this.sheet = deriveSheet(this.character, this.graph!);
		this.overlay = null;
	};
}

/** The single shared Combat view-model instance. */
export const combat = new CombatVM();
