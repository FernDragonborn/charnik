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
import { ensureActiveCharacter, saveCharacterToStore } from '$lib/character/store.svelte';
import { content, loadContentStore } from '$lib/content/store.svelte';
import { deriveSheet, type CharacterSheet, type SkillId } from '$lib/character/derive';
import { plugins } from '$lib/effects/plugin-store.svelte';
import { rollPool, rollFormula } from '$lib/rules/dice';
import { shortRestHalfHeal } from '$lib/rules/core';
import { DEFAULT_SYSTEM } from '$lib/rules/pipeline';
import type { Character, DeathCause, ShortRestMode } from '$lib/character/schema';
import {
	titleCase,
	GROUP_MODES,
	type GroupMode,
	netAdvantage,
	computeAttacks,
	standardActions,
	buildSpellGroups,
	preparedTalliesByClass,
	parseDamageParts,
	modTargetLabel,
	applyDefense,
	effectiveHpMax,
	DEATH_CAUSE_LABEL,
	type Attack,
	type MenuKind,
	type StandardAction,
} from '$lib/combat/helpers';
import { RollTray } from './roll-tray.svelte';
import {
	appendLog,
	readLog,
	snapshotCharacterOnLaunch,
	type LogEntry,
} from '$lib/character/repository';
import { getUserStorage } from '$lib/storage/provider';
import type { RollLogEntry } from '$lib/combat/helpers';
import { registerDiceTray, openDiceTray, type DiceTrayRequest } from '$lib/dice/tray.svelte';
import { isRowActive } from '$lib/content/sources.svelte';
import { EffectsEditor } from './effects-editor.svelte';
import { SheetRolls } from './sheet-rolls.svelte';
import { ActionExecutor } from './action-executor.svelte';
import { PanelLayout } from './panel-layout.svelte';
import { SpellCasting } from './spell-casting.svelte';
import { TurnEconomy } from './turn-economy.svelte';
import { ResourceTracker } from './resource-tracker.svelte';

/** The passive-senses row's default skills when the character hasn't customized it (ui.passiveSkills). */
const DEFAULT_PASSIVE_SKILLS: SkillId[] = ['perception', 'investigation', 'insight'];

/**
 * D1 — still over the 400-line lint (warn-only), being cut down slice by slice into the subsystems
 * beside it, each owning its slice behind an accessor.
 *
 * **HP + death is NOT a clean slice — do not start it expecting one.** `hpMax` is read from seven
 * places (both rests, the level-up clamp, damage, heal, an action) and `die()` from four, one of
 * them in `effects-editor.svelte.ts` (exhaustion kills). HP is the spine the rest of the play-state
 * hangs off, so extracting it starts with a design call about whether everything else reads
 * `this.hp.hpMax` — and it is where a reactivity break costs the most.
 *
 * Cleaner candidates: rests + hit dice (bordering `ResourceTracker`, which already owns recharge),
 * then the action list and the menu/overlay plumbing.
 *
 * Every carve ends with `shot.mjs`: a bound scalar moves fine, but only if its binding is retargeted
 * with it (`bind:value={combat.effects.newEffectDuration}`), and unit tests do not cover that seam.
 */

class CombatVM {
	/** Dice-roll subsystem (tray state + log + roll execution) — see roll.svelte.ts. Each completed
	 *  roll is also persisted to the active character's `log.jsonl` (B4). */
	tray = new RollTray((e) => this.persistRoll(e));
	/** Panel-layout subsystem (columns, collapse, drag) — persists column order onto the character. */
	layout = new PanelLayout((cols) => {
		if (this.character) this.character.ui.panelColumns = cols;
	});
	/** Action-economy subsystem (pips, movement, turn/round, in-combat spend checks). */
	economy = new TurnEconomy(
		() => this.character,
		() => this.sheet,
	);
	/** Resource/rest subsystem (spell slots, resource pips, short/long rests). */
	resources = new ResourceTracker(
		() => this.character,
		() => this.sheet,
	);
	// read the shared reactive content store → a live content refresh (reloadContent) re-derives the
	// sheet with no page reload, while the character's play-state is left untouched
	/** Roll semantics (effect pickup, forced outcomes, the attack roll, Savage Attacker) — see
	 *  rolls.svelte.ts. */
	rolls = new SheetRolls(() => this);
	/* The roll verbs stay ON the view-model: every panel and the behavioural tests call them here,
	   and casting reads `effectsFor`/`openRoll` through the same names (§6.1). */
	effectsFor = (...a: Parameters<SheetRolls['effectsFor']>) => this.rolls.effectsFor(...a);
	openRoll = (...a: Parameters<SheetRolls['openRoll']>) => this.rolls.openRoll(...a);
	roll = (...a: Parameters<SheetRolls['roll']>) => this.rolls.roll(...a);
	attackRoll = (...a: Parameters<SheetRolls['attackRoll']>) => this.rolls.attackRoll(...a);
	savageReroll = () => this.rolls.savageReroll();
	get savageLabel() {
		return this.rolls.savageLabel;
	}
	get savagePendingEntry() {
		return this.rolls.savagePendingEntry;
	}
	graph = $derived(content.graph);
	character = $state<Character | null>(null);
	/** Fully reactive: recomputes whenever the character (HP, effects, shield, auto-calc…), the
	 *  content graph, or the enabled-plugin set changes — so every play-state edit AND a plugin
	 *  enable/disable reflect live in the derived stats. */
	sheet = $derived.by<CharacterSheet | null>(() => {
		void plugins.version; // the plugin registry isn't reactive itself — this tick is its signal
		return this.character && this.graph
			? deriveSheet(this.character, this.graph, isRowActive)
			: null;
	});

	// play / UI state. The round counter is the PERSISTED one (play.round) — no separate VM copy to
	// drift; entering combat sets it to 1, Next turn advances it, and effect expiry reads it.
	get round(): number {
		return this.character?.play.round ?? 0;
	}
	// B19: any round-timed effect currently ticking. Gates the out-of-combat "pass time" control — a
	// timed buff cast outside a fight has no turn advance to expire it, so it'd hang until a rest.
	hasTimedEffects = $derived(
		(this.character?.play.effects ?? []).some((e) => e.durationRounds != null),
	);
	// D3: pins persist per character in ui.spellsPinned (bare ids), not a demo hardcode. Exposed as a
	// boolean map for the panel's `pinned[id]` lookup; toggle via togglePin so the array stays the source.
	pinned = $derived<Record<string, boolean>>(
		Object.fromEntries((this.character?.ui.spellsPinned ?? []).map((id) => [id, true])),
	);
	togglePin = (id: string) => {
		const ui = this.character?.ui;
		if (!ui) return;
		const cur = ui.spellsPinned ?? [];
		ui.spellsPinned = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
	};
	// menus open as dropdowns anchored under their trigger button (not centered modals)
	overlay = $state<null | {
		kind: MenuKind;
		top: number;
		left: number | null;
		right: number | null;
	}>(null);
	hiddenActions = $state<Record<string, boolean>>({});
	tempHpInput = $state(5);
	customEffectLabel = $state('');
	spellGroupBy = $state<GroupMode>('level');
	// which skills show in the passive-senses row — PERSISTED per character in ui.passiveSkills
	// (D19/D3), falling back to the default trio; toggling saves.
	get passiveSkills(): SkillId[] {
		return (this.character?.ui.passiveSkills as SkillId[] | undefined) ?? DEFAULT_PASSIVE_SKILLS;
	}

	// true once `load` resolves with NO active character (empty roster / the user deleted the demo) →
	// the page shows the shared <NoCharacter> empty state instead of the sheet. Distinct from the
	// still-loading state (character null but load not finished).
	noCharacter = $state(false);

	load = async () => {
		await loadContentStore(); // populate the shared graph; `this.graph` derives from it
		// the character opened from the Roster, else a sensible default (demo on first run, else the
		// user's first save, else none → the empty state)
		const c = await ensureActiveCharacter();
		if (!c) {
			this.noCharacter = true;
			return;
		}
		this.character = c;
		// once-per-session snapshot of this character for the rolling backup ring (B3)
		void snapshotCharacterOnLaunch(getUserStorage(), c.id);
		// restore this character's saved panel layout (falls back to the default columns)
		this.layout.restore(c.ui.panelColumns);
		// restore the persisted roll history so the log isn't empty after a reload (B4)
		const hist = await readLog(getUserStorage(), c.id);
		this.tray.seed(
			hist.map((le) => ({ label: le.label, expr: le.detail ?? '', total: le.result ?? NaN })),
		);
	};

	/** Persist one completed roll to the active character's `log.jsonl` (B4). Fire-and-forget: a log
	 *  write must never block or fail a roll. */
	private persistRoll = (e: RollLogEntry): void => {
		const id = this.character?.id;
		if (!id) return;
		const entry: LogEntry = { t: Date.now(), kind: 'roll', label: e.label };
		if (Number.isFinite(e.total)) entry.result = e.total;
		if (e.expr) entry.detail = e.expr;
		void appendLog(getUserStorage(), id, entry);
	};

	openMenu = (kind: MenuKind, e: Event) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const anchorRight = r.left > window.innerWidth / 2;
		// document coords (+scroll) so the dropdown scrolls WITH the page/button, not the viewport
		this.overlay = {
			kind,
			top: r.bottom + window.scrollY + 6,
			left: anchorRight ? null : r.left + window.scrollX,
			right: anchorRight ? document.documentElement.clientWidth - r.right : null,
		};
	};

	// structured custom modifier (GM "+1 AC" in a few clicks): target · sign · amount → a
	// flat_bonus token the effects engine already applies (now live, via the reactive sheet).
	customModTarget = $state('ac');
	customModSign = $state<'+' | '-'>('+');
	customModAmount = $state(1);
	addCustomModifier = () => {
		const amount = Math.abs(Math.round(this.customModAmount)) || 1;
		const token = `flat_bonus:${this.customModTarget}${this.customModSign}${amount}`;
		const label =
			this.customEffectLabel.trim() ||
			`${this.customModSign}${amount} ${modTargetLabel(this.customModTarget)}`;
		this.effects.addEffect({ label, tokens: [token], positive: this.customModSign === '+' });
		this.customEffectLabel = '';
		this.customModAmount = 1;
	};

	openDice = (e: Event) => {
		this.tray.reset();
		this.openMenu('dice', e);
	};

	/** Open a menu with NO anchor event — a centered dropdown near the top. Used by the D8 tray seam,
	 *  where a request arrives from a generic RollButton that doesn't hand us its DOM node. */
	openMenuCentered = (kind: MenuKind) => {
		if (typeof window === 'undefined') return;
		this.overlay = {
			kind,
			top: window.scrollY + 80,
			left: Math.max(8, window.innerWidth / 2 - 150),
			right: null,
		};
	};

	/** D8: the ONE dice-tray seam, implemented by the rich combat tray. Registered on mount (see
	 *  +page), so a generic `openDiceTray({label, formula})` anywhere in combat opens THIS tray (pool,
	 *  advantage, attack→damage chain) instead of the instant-roll fallback. A caller may pass a
	 *  pre-split `pool`/`mod`; otherwise the formula↔pool adapter (`parseDamageParts`) fills the tray. */
	handleTrayRequest = (req: DiceTrayRequest) => {
		const [parsed] = req.pool ? [] : parseDamageParts(req.formula);
		const pool = req.pool ?? parsed?.pool ?? {};
		const mod = req.mod ?? parsed?.mod ?? 0;
		this.tray.prefill({
			label: req.label,
			dice: pool,
			mod,
			advantage: req.advantage ?? 0,
			mods: req.mods ?? {},
		});
		if (req.queuedDamage)
			this.tray.queueDamage({
				label: req.queuedDamage.label,
				parts: [
					{
						dice: req.queuedDamage.dice,
						mod: req.queuedDamage.mod,
						type: '',
						...(req.queuedDamage.mods ? { mods: req.queuedDamage.mods } : {}),
					},
				],
			});
		this.openMenuCentered('dice');
	};

	/** Register this tray as the live `DiceTrayRequest` handler; returns an unregister fn (called on
	 *  combat unmount so leaving the route restores the instant-roll fallback). */
	registerTray = () => registerDiceTray(this.handleTrayRequest);

	/** EFX-ROLL: feature-granted named rollables (Sneak Attack, Bardic Inspiration die) — the derive
	 *  already resolved each expr to a dice formula against this character's levels. */
	featureRolls = $derived(this.sheet?.facts.rolls ?? []);
	/** Roll a feature rollable through the tray seam (registered above → opens the rich tray). */
	rollFeature = (r: { label: string; formula: string }) =>
		openDiceTray({ label: r.label, formula: r.formula });

	/** Piece 3: spend-options on granted resources (Ki → Flurry of Blows…), shown in the actions
	 *  block with a cost chip. `left` is the pool remaining so the UI can disable an unaffordable one. */
	resourceOptions = $derived(
		(this.sheet?.resourceOptions ?? []).map((o) => ({
			...o,
			left:
				(this.sheet?.resources.find((r) => r.id === o.resourceId)?.max ?? 0) -
				this.resources.resourceSpent(o.resourceId),
		})),
	);

	/** Hit-dice pools for the panel: each die size with its spent/left counts (left disables the spend
	 *  button when the pool is empty — refilled on a long rest). */
	hitDice = $derived(
		(this.sheet?.hitDice ?? []).map((h) => ({
			...h,
			spent: this.resources.hitDiceSpent(h.die),
			left: h.max - this.resources.hitDiceSpent(h.die),
		})),
	);
	/** Spend one Hit Die of the given size (short-rest healing): roll the die + CON mod, heal a MINIMUM
	 *  of 1 HP (RAW) clamped to max, log it, and mark the die spent. Blocked when that pool is empty. */
	spendHitDie = (die: string) => {
		const c = this.character;
		const pool = this.sheet?.hitDice.find((h) => h.die === die);
		if (!c || !pool) return;
		if (pool.max - this.resources.hitDiceSpent(die) <= 0) {
			toast(`No ${die} Hit Dice left`, { description: 'Regain some on a long rest' });
			return;
		}
		const conMod = this.sheet?.abilities.con.mod ?? 0;
		const r = rollFormula(`1${die}${conMod >= 0 ? `+${conMod}` : conMod}`);
		c.play.hp.current = Math.min(this.hpMax, c.play.hp.current + Math.max(1, r.total)); // min 1 HP/die
		c.play.hitDiceSpent = { ...c.play.hitDiceSpent, [die]: this.resources.hitDiceSpent(die) + 1 };
		this.tray.pushRoll(`Hit Die ${die}`, r);
	};

	/** The character's short-rest healing model (per-character rules variant; `dice` = RAW default). */
	get shortRestMode(): ShortRestMode {
		return this.character?.ui.shortRestMode ?? 'dice';
	}
	/** Hit dice chosen to spend in the short-rest popover (die size → count). Reset when it opens. */
	hdPick = $state<Record<string, number>>({});
	/** Total hit dice currently selected in the popover. */
	hdPickCount = $derived(Object.values(this.hdPick).reduce((n, v) => n + v, 0));
	/** Bump the chosen count of one die size, clamped to [0, the pool's remaining]. */
	hdPickInc = (die: string, delta: number) => {
		const left = this.hitDice.find((h) => h.die === die)?.left ?? 0;
		this.hdPick = {
			...this.hdPick,
			[die]: Math.max(0, Math.min(left, (this.hdPick[die] ?? 0) + delta)),
		};
	};
	/** Press "☾ Short": the `half` model heals ½ max HP right away; the `dice` model opens the picker
	 *  popover (choose how many Hit Dice to spend). Both run the shared short-rest recharge (pools /
	 *  pact slots / effect expiry). */
	startShortRest = (e: Event) => {
		if (this.shortRestMode === 'half') return this.doHalfShortRest();
		this.hdPick = {}; // a fresh selection each time the picker opens
		this.openMenu('restshort', e);
	};
	/** The `half` short rest (BG3 / house variant): recharge + heal ½ max HP, no Hit Dice spent. */
	private doHalfShortRest() {
		const p = this.character?.play;
		if (!p) return;
		this.resources.rest('short');
		const heal = shortRestHalfHeal(this.hpMax);
		p.hp.current = Math.min(this.hpMax, p.hp.current + heal);
		this.tray.logMarker(`Short rest — +${heal} HP (½ max)`);
		toast(`Short rest — healed ${heal} HP`);
	}
	/** Commit the `dice` short rest: recharge, then spend each chosen Hit Die (roll + CON, min 1 HP —
	 *  each shows its own roll in the log), and close the picker. */
	commitShortRest = () => {
		this.resources.rest('short');
		for (const [die, count] of Object.entries(this.hdPick))
			for (let i = 0; i < count; i++) this.spendHitDie(die);
		this.hdPick = {};
		this.overlay = null;
		toast('Short rest taken');
	};

	setTempHp = () => {
		if (this.character) this.character.play.hp.temp = Math.max(0, this.tempHpInput);
		this.overlay = null;
	};

	// --- HP: apply damage / healing to the play-state (temp HP soaks damage first) -------------
	hpAmount = $state(1);
	/** B4 concentration-save banner: a CON save the player owes after taking damage while concentrating.
	 *  `dc` is the suggested-but-editable DC; `failed` is set once a rolled save misses (the banner then
	 *  offers Drop). Null = no check due. Set in `damage()`, cleared on a passed roll / drop / when
	 *  concentration ends. */
	pendingConcentrationSave = $state<{ dc: number; failed?: boolean } | null>(null);
	/** The CON saving-throw bonus a concentration save rolls (d20 + this); already folds save.con flat
	 *  effects, so the roll must NOT re-add `fx.flat` (roll.ts: saves are pre-folded into the sheet). */
	concentrationSaveMod = $derived(this.sheet?.abilities.con.save.value ?? 0);
	/** Selected damage type for the next Damage press (B20). Null = untyped (no resist/vuln math). */
	damageType = $state<string | null>(null);
	get hpMax(): number {
		if (!this.sheet) return this.character?.play.hp.max ?? 0;
		// A14: a manual max no longer silences hp_max effects — they re-fold on top of it.
		return effectiveHpMax(this.character?.play.hp.max ?? null, this.sheet.maxHp);
	}
	/** A14: pull play HP current down to the live effective max — call reactively so an expired
	 *  hp_max effect (Aid) or a dropped manual max reduces current. Idempotent (no-op once
	 *  current ≤ max), so it can't loop the autosave debounce. */
	clampCurrentHp = () => {
		const p = this.character?.play;
		if (p && p.hp.current > this.hpMax) p.hp.current = this.hpMax;
	};
	/** The damage types the character has ANY defense for — the only ones worth offering in the
	 *  type picker (any other type resolves identically to untyped). Empty → no picker shown. */
	damageTypeOptions = $derived.by<string[]>(() => {
		const d = this.sheet?.defenses;
		if (!d) return [];
		return [...new Set([...d.resist, ...d.immune, ...d.vulnerable])].sort();
	});
	damage = () => {
		const p = this.character?.play;
		if (!p) return;
		const raw = Math.max(0, Math.round(this.hpAmount));
		// B20: resist/immune/vulnerable modify the damage BEFORE temp HP soaks it (RAW ordering).
		const defenses = this.sheet?.defenses ?? { resist: [], immune: [], vulnerable: [] };
		const taken = applyDefense(raw, this.damageType, defenses).final;
		let n = taken;
		const soaked = Math.min(p.hp.temp, n); // temp HP absorbs first (5e rule)
		p.hp.temp -= soaked;
		n -= soaked;
		const before = p.hp.current;
		p.hp.current = Math.max(0, before - n);
		// INSTANT DEATH (SRD 5.1 "Instant Death", verified): damage reduces you to 0 AND the damage
		// REMAINING equals/exceeds your hit-point MAXIMUM (the FULL max, not half) → you die outright,
		// no death saves. The same threshold also covers "Damage at 0 Hit Points" (already at 0 → the
		// leftover is the whole hit). The 2024 SRD 5.2.1 omits the "Playing the Game" chapter that
		// carries this rule (it only cross-references it), so both editions run the 5.1 text — the 2024
		// PHB keeps the same threshold. [[charnik-srd-raw-fidelity]]
		if (p.hp.current === 0 && n - before >= this.hpMax) this.die('massive_damage');
		// B4: taking damage while concentrating opens the "check due" banner — a CON save at DC
		// max(10, ⌊dmg/2⌋), capped 30 in 2024 (RAW). Suggested-but-editable DC, PLAYER-rolled, never an
		// auto-drop (play-tracker surfaces, never forces). 0 HP already ends it via endConcentrationIfBroken.
		if (taken > 0 && p.concentration && p.hp.current > 0) {
			const cap = this.character?.system === '5.5e' ? 30 : Number.POSITIVE_INFINITY;
			this.pendingConcentrationSave = { dc: Math.min(cap, Math.max(10, Math.floor(taken / 2))) };
		}
	};
	heal = () => {
		const p = this.character?.play;
		if (!p) return;
		p.hp.current = Math.min(this.hpMax, p.hp.current + Math.max(0, Math.round(this.hpAmount)));
	};

	/** Roll the owed concentration save (B4 banner). Instant + auto-applied like a death save — the tray
	 *  has no result callback, and save.con effects (Bless bonus dice, War Caster advantage) already fold
	 *  through `effectsFor`. `mod` is the sheet CON-save value (flat effects pre-folded → do NOT add
	 *  `fx.flat`, roll.ts). Pass → the check clears. Fail → RAW the spell ends, but we mark the banner
	 *  `failed` and OFFER Drop rather than auto-dropping (surface, never force). */
	rollConcentrationSave = () => {
		const pend = this.pendingConcentrationSave;
		if (!pend || pend.failed || !this.character?.play.concentration) return;
		const fx = this.rolls.effectsFor('save.con');
		const r = rollPool({ 20: 1 }, this.concentrationSaveMod, netAdvantage(fx), fx.bonusDice, fx);
		this.tray.pushRoll('Concentration save', r);
		if (r.total >= pend.dc) {
			toast(`Concentration held — ${r.total} ≥ DC ${pend.dc}`);
			this.pendingConcentrationSave = null;
		} else {
			toast(`Concentration save failed — ${r.total} < DC ${pend.dc}`, {
				description: 'The spell ends — tap Drop to confirm.',
			});
			this.pendingConcentrationSave = { dc: pend.dc, failed: true };
		}
	};
	/** The B4 banner's "Drop spell" — deliberately END concentration (either instead of rolling, or to
	 *  confirm the RAW consequence of a failed save). Ends the spell AND dismisses the banner. */
	dropConcentrationFromSave = () => {
		this.clearConcentration();
		this.pendingConcentrationSave = null;
	};
	/** The B4 banner's ✕ — dismiss the reminder WITHOUT ending concentration. Unlike Drop, the spell
	 *  keeps going: the player is waving off the check (they'll roll physically, have a feature that
	 *  ignores it, or just don't care). Surface, never force — a reminder must be dismissable. */
	dismissConcentrationSave = () => {
		this.pendingConcentrationSave = null;
	};
	/** The N2 action executor (spend-options, action verbs, entering combat) — see executor.svelte.ts. */
	executor = new ActionExecutor(() => this);
	/* These three stay ON the view-model: they read as SHEET verbs, not as a subsystem's API, and
	   they are what the panels and the behavioural tests call (§6.1). */
	activateResourceOption = (...args: Parameters<ActionExecutor['activateResourceOption']>) =>
		this.executor.activateResourceOption(...args);
	useResourceOrEnter = (...args: Parameters<ActionExecutor['useResourceOrEnter']>) =>
		this.executor.useResourceOrEnter(...args);
	toggleCombat = () => this.executor.toggleCombat();
	groupByLabel = $derived(
		{ level: 'By level', prepared: 'Prepared', school: 'By school' }[this.spellGroupBy],
	);
	cycleGroupBy = () =>
		(this.spellGroupBy =
			GROUP_MODES[(GROUP_MODES.indexOf(this.spellGroupBy) + 1) % GROUP_MODES.length] ?? 'level');

	className = $derived.by(() => {
		if (!this.character || !this.graph) return '';
		const graph = this.graph;
		const classes = this.character.build.classes;
		if (classes.length === 0) return `Level ${this.sheet?.level ?? ''}`;
		// multiclass renders every class ("Wizard 2 / Fighter 3"), not just classes[0]
		return classes
			.map((c) => {
				const row = graph.get(c.class);
				return row ? `${row.data.name_en} ${c.level}` : `Level ${c.level}`;
			})
			.join(' / ');
	});
	speciesName = $derived.by(() =>
		this.character?.build.species && this.graph
			? String(this.graph.get(this.character.build.species)?.data.name_en ?? '')
			: '',
	);
	/** The spell currently concentrated on (resolved to a display label), or null. Reads the schema's
	 *  `play.concentration` ref — set on cast, cleared by tapping the indicator. */
	conc = $derived.by<{ ref: string; label: string } | null>(() => {
		const ref = this.character?.play.concentration;
		if (!ref) return null;
		const name = this.graph?.get(ref)?.data.name_en;
		return { ref, label: name ? String(name) : ref };
	});
	/** Remove the cast-applied effect linked to a spell ref (`source === ref`) — dropping or
	 *  replacing concentration takes the spell's own buff down with it. */
	removeLinkedEffect(ref: string) {
		const c = this.character;
		if (c) c.play.effects = c.play.effects.filter((e) => e.source !== ref);
	}
	/** Stop concentrating (tap the concentration indicator). */
	clearConcentration = () => {
		const c = this.character;
		if (!c) return;
		if (c.play.concentration) this.removeLinkedEffect(c.play.concentration);
		c.play.concentration = null;
		this.pendingConcentrationSave = null; // no spell → no owed save (B4 banner dismisses)
	};
	/** A state forbids Concentration — a `blocks_concentration` marker is live on the sheet (RAW Rage:
	 *  "you can't maintain Concentration"). DATA-DRIVEN (the token, authored on the Rage condition), not a
	 *  hardcoded id, so any homebrew state carrying the marker behaves the same. */
	cantConcentrate = $derived(this.sheet?.facts.breaksConcentration ?? false);
	/** RAW: dropping to 0 HP, becoming incapacitated, OR gaining a `blocks_concentration` state (Rage)
	 *  ENDS concentration (CONCENTRATION-PLAN §7). Called reactively from the combat page so it fires the
	 *  instant HP hits 0 (Damage), an incapacitating condition lands, or Rage is entered. Idempotent —
	 *  a no-op once concentration is already gone. */
	endConcentrationIfBroken = () => {
		const c = this.character;
		if (!c?.play.concentration) return;
		if (c.play.hp.current <= 0 || this.economy.incapacitated || this.cantConcentrate)
			this.clearConcentration();
	};

	// configurable passive-sense skills (Pin skills)
	passives = $derived.by(() => {
		const sheet = this.sheet;
		if (!sheet) return [];
		return this.passiveSkills.map((k) => ({
			key: k,
			name: titleCase(k),
			comp: sheet.passives[k], // effect-adjusted (adv/dis ±5, passive.<skill>), not bare 10+mod
		}));
	});
	togglePassive = (k: SkillId) => {
		const c = this.character;
		if (!c) return;
		const cur = this.passiveSkills;
		c.ui.passiveSkills = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
		void saveCharacterToStore(c);
	};

	// --- level-up: advance an existing character's class by one level ---------------------------
	/** Total character level across all classes. */
	totalLevel = $derived(this.character?.build.classes.reduce((n, c) => n + c.level, 0) ?? 0);
	/** Can still gain a level (hard cap 20 total). */
	canLevelUp = $derived(this.totalLevel < 20 && (this.character?.build.classes.length ?? 0) > 0);
	/** The character's classes with their live names, for the level-up menu. */
	levelUpClasses = $derived.by(() =>
		(this.character?.build.classes ?? []).map((c, i) => ({
			index: i,
			level: c.level,
			name: this.graph ? String(this.graph.get(c.class)?.data.name_en ?? 'Class') : 'Class',
		})),
	);
	/** Add one level to a class and persist (the sheet re-derives HP/prof/slots/features live).
	 *  New choices at this level — ASI/feat/spells — are picked in the builder; here we advance the
	 *  mechanical level (lenient), flag the rest. */
	levelUp = (classIndex: number) => {
		const c = this.character;
		if (!c || !this.canLevelUp) return;
		c.build.classes = c.build.classes.map((cl, i) =>
			i === classIndex ? { ...cl, level: cl.level + 1 } : cl,
		);
		void saveCharacterToStore(c);
		this.overlay = null;
		const cls = c.build.classes[classIndex];
		if (cls)
			toast(`Level up — ${this.graph?.get(cls.class)?.data.name_en ?? 'class'} ${cls.level}`, {
				description: 'HP & slots updated. Set any new ASI/feat/spells in the builder.',
			});
	};

	/** Roll a death save (shown while at 0 HP): a d20 vs 10 — `save.death`-targeted effects (and
	 *  the `saves`/`d20_tests` groups: Bless, exhaustion) apply. Outcomes per RAW: nat 20 → back up
	 *  at 1 HP; nat 1 → two failures; 10+ → success; three successes → stable (counters reset). */
	deathSave = () => {
		const c = this.character;
		if (!c) return;
		const fx = this.rolls.effectsFor('save.death');
		// SMELL-6: always roll instantly + auto-apply the outcome. Unlike other rolls, a death save
		// MUTATES play-state (pips / nat20→1 HP), and the tray contract has no result callback — a tray
		// roll couldn't apply it. A death save is a fixed d20-vs-10 with nothing to customize
		// (advantage/effects already fold via `fx`), so there's no reason to offer the tray here.
		const r = rollPool({ 20: 1 }, fx.flat, netAdvantage(fx), fx.bonusDice, fx);
		this.tray.pushRoll('Death save', r);
		const ds = c.play.deathSaves;
		if (r.natural === 20) {
			c.play.hp.current = 1;
			c.play.deathSaves = { successes: 0, failures: 0 };
			toast('Natural 20 — back on your feet at 1 HP');
		} else if (r.natural === 1) {
			ds.failures = Math.min(3, ds.failures + 2);
			toast('Natural 1 — two death-save failures');
		} else if (r.total >= 10) {
			ds.successes = Math.min(3, ds.successes + 1);
			if (ds.successes >= 3) {
				c.play.deathSaves = { successes: 0, failures: 0 };
				toast('Three successes — stable at 0 HP');
			}
		} else {
			ds.failures = Math.min(3, ds.failures + 1);
		}
		// "On your third failure, you die" — checked once, after every branch, so a natural 1's DOUBLE
		// failure is as lethal as a third single one (it wasn't, before).
		if (c.play.deathSaves.failures >= 3) this.die('death_saves');
	};

	/** Manually set a death-save track (players track by hand too): clicking pip `index` fills to it,
	 *  or clears it when it's already the last filled one. `kind` is 'successes' | 'failures'. */
	toggleDeathSave = (kind: 'successes' | 'failures', index: number) => {
		const ds = this.character?.play.deathSaves;
		if (!ds) return;
		ds[kind] = ds[kind] === index + 1 ? index : index + 1;
		if (kind === 'failures' && ds.failures >= 3) this.die('death_saves');
	};

	/** Record a death. The three lethal rules (massive damage · three death-save failures · the top of
	 *  the exhaustion ladder) all land HERE, so "what happens when you die" is one place. Idempotent —
	 *  the first cause sticks, so re-entering the same state doesn't re-toast. Death is AUTOMATIC in
	 *  RAW (no "you can"), so like the initiative regain it auto-applies and NOTIFIES; the player still
	 *  owns the way back (`revive`). */
	die = (cause: DeathCause) => {
		const p = this.character?.play;
		if (!p || p.death) return;
		p.death = { cause };
		toast('The character has died', { description: DEATH_CAUSE_LABEL[cause] });
	};
	/** "I was revived" — the way back from the dead screen. RAW leaves the HP to the revival effect, so
	 *  we apply the Revivify FLOOR (at least 1 HP, never taking hit points away — a character who died
	 *  of Exhaustion at full HP keeps them) and clear the death-save track (it resets on regaining HP).
	 *  Exhaustion drops by one, per the 2024 glossary ("If the creature died with any Exhaustion levels,
	 *  it returns with 1 fewer level") — applied in BOTH editions because reviving straight back onto a
	 *  lethal exhaustion 6 would kill you again on the spot; RAW is silent in 2014, so RAI wins
	 *  ([[charnik-srd-raw-fidelity]]). Everything else (conditions, curses) survives death per RAW. */
	revive = () => {
		const p = this.character?.play;
		if (!p) return;
		p.death = null;
		p.deathSaves = { successes: 0, failures: 0 };
		p.exhaustion = Math.max(0, p.exhaustion - 1);
		p.hp = { ...p.hp, current: Math.max(1, p.hp.current) };
		toast('Back from the dead — 1 HP');
	};

	/** Click a standard action (Dash, Hide, …). Spends an action; roll-type ones open their roll,
	 *  no-roll ones just consume the slot. The "Attack" row is a pointer to the Attacks panel. */
	actionClick = (a: StandardAction, e: Event) => {
		if (a.id === 'attack') return; // routes to the Attacks panel; not itself an action spend
		if (!this.economy.trySpend('action')) return;
		if (a.roll) this.rolls.roll(a.roll[0], a.roll[1], e);
		else toast(`${a.name} — action used`);
	};
	/** Spell casting (slots, upcast, the rolls a cast makes) — see casting.svelte.ts. */
	casting = new SpellCasting(this);
	/* The casting API stays ON the view-model: it is the boundary the markup and the behavioural
	   tests are written against (§6.1), and moving 434 lines of implementation out is no reason to
	   move the seam people call. */
	cast = (...args: Parameters<SpellCasting['cast']>) => this.casting.cast(...args);
	castAtSlot = (...args: Parameters<SpellCasting['castAtSlot']>) =>
		this.casting.castAtSlot(...args);
	castPreview = (...args: Parameters<SpellCasting['castPreview']>) =>
		this.casting.castPreview(...args);
	castableSlots = (...args: Parameters<SpellCasting['castableSlots']>) =>
		this.casting.castableSlots(...args);
	openUpcast = (...args: Parameters<SpellCasting['openUpcast']>) =>
		this.casting.openUpcast(...args);
	togglePrepared = (...args: Parameters<SpellCasting['togglePrepared']>) =>
		this.casting.togglePrepared(...args);
	get upcastSpell() {
		return this.casting.upcastSpell;
	}
	set upcastSpell(v) {
		this.casting.upcastSpell = v;
	}

	attacks = $derived.by<Attack[]>(() =>
		this.character && this.sheet && this.graph
			? computeAttacks(this.character, this.sheet, this.graph)
			: [],
	);

	// standard actions (from d-charnik); roll ones reference live skills — pure builder in helpers
	actions = $derived.by<StandardAction[]>(() =>
		standardActions(this.sheet, this.character?.system ?? DEFAULT_SYSTEM),
	);
	visibleActions = $derived(this.actions.filter((a) => !this.hiddenActions[a.id]));

	spellGroups = $derived.by(() =>
		this.character && this.graph
			? buildSpellGroups({
					character: this.character,
					sheet: this.sheet,
					graph: this.graph,
					groupBy: this.spellGroupBy,
					pinned: this.pinned,
					hidden: this.character.ui.spellsHidden,
				})
			: [],
	);
	// B9: worn non-proficient armor blocks spellcasting (RAW rule-block). Surfaced on the spells panel.
	armorBlock = $derived(this.sheet?.spellcasting.armorBlock);
	// A18-tail: per-class prepared accounting (each prepared spell attributed to the class that grants
	// it). Drives the header (via PreparedCaps); the toggle gate uses canTogglePreparedFor directly.
	preparedTallies = $derived(
		preparedTalliesByClass(this.character?.build.spells ?? [], this.sheet),
	);

	hpBar = $derived.by(() => {
		if (!this.character || !this.sheet) return { cur: 0, tmp: 0 };
		// `|| 1` guards a 0 max (unset HP) so the bar math can't divide → NaN/Infinity (D19)
		// A14: effectiveHpMax so a manual max still stacks hp_max effects (Aid) on top.
		const max = effectiveHpMax(this.character.play.hp.max ?? null, this.sheet.maxHp) || 1;
		return {
			cur: Math.max(0, Math.min(100, (this.character.play.hp.current / max) * 100)),
			tmp: (this.character.play.hp.temp / max) * 100,
		};
	});

	// conditions for THIS character's system (not a hardcoded edition). Carries the row `id` (not just
	// the label) so applying one emits `apply_condition:<id>` — the DAG then expands the condition
	// row's own `effects` tokens and registers the id in facts.conditions (what the economy + guards
	/** Effects & conditions (catalog, durations, exhaustion) — see effects.svelte.ts. */
	effects = new EffectsEditor(() => this);
}

/** The single shared Combat view-model instance. */
export const combat = new CombatVM();
