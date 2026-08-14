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
import {
	deriveSheet,
	type CharacterSheet,
	type SkillId,
	type ResourceOption
} from '$lib/character/derive';
import { plugins } from '$lib/effects/plugin-store.svelte';
import { rollPool, rollFormula } from '$lib/rules/dice';
import { shortRestHalfHeal } from '$lib/rules/core';
import { DEFAULT_SYSTEM } from '$lib/rules/pipeline';
import type { Character, DeathCause, ShortRestMode } from '$lib/character/schema';
import {
	titleCase,
	wantsTray,
	GROUP_MODES,
	type GroupMode,
	remainingRounds,
	rollEffectsFor,
	autoOutcome,
	netAdvantage,
	NO_ROLL_EFFECTS,
	type RollEffects,
	computeAttacks,
	standardActions,
	buildSpellGroups,
	preparedTalliesByClass,
	parseDamageParts,
	rollDamageParts,
	dealsDamage,
	modTargetLabel,
	applyDefense,
	effectiveHpMax,
	DEATH_CAUSE_LABEL,
	type Attack,
	type DamagePartSpec,
	type TypedRoll,
	type MenuKind,
	type StandardAction,
	type ActionSlot
} from '$lib/combat/helpers';
import { RollTray, type RollSpec } from './roll.svelte';
import {
	appendLog,
	readLog,
	snapshotCharacterOnLaunch,
	type LogEntry
} from '$lib/character/repository';
import { getUserStorage } from '$lib/storage/provider';
import type { RollLogEntry } from '$lib/combat/helpers';
import { registerDiceTray, openDiceTray, type DiceTrayRequest } from '$lib/dice/tray.svelte';
import { toastRoll } from '$lib/dice/roll-toast';
import { isRowActive } from '$lib/content/sources.svelte';
import { PanelLayout } from './panel.svelte';
import { SpellCasting } from './casting.svelte';
import { TurnEconomy } from './economy.svelte';
import { ResourceTracker } from './resources.svelte';

/** The passive-senses row's default skills when the character hasn't customized it (ui.passiveSkills). */
const DEFAULT_PASSIVE_SKILLS: SkillId[] = ['perception', 'investigation', 'insight'];

/** A resource-option's `action_type` → the turn-economy slot it consumes (`free` = none). */
const ACTION_TYPE_SLOT: Record<ResourceOption['actionType'], ActionSlot | null> = {
	action: 'action',
	bonus_action: 'bonus',
	reaction: 'reaction',
	free: null
};

/**
 * D1 — this file is still over the 400-line lint (warn-only) and is being cut down slice by slice.
 *
 * Out already: pure math → `$lib/combat/helpers`; five subsystems (`tray`/`layout`/`economy`/
 * `resources`/`casting`), each owning its slice behind an accessor. Spell casting went 2026-08-14
 * (434 lines, `casting.svelte.ts`) — its public API stayed HERE as delegating fields, because that
 * is the boundary the markup and the behavioural tests are written against.
 *
 * Next slice, in order of payoff: the effects/conditions editor, then HP + death. Both are bigger
 * risks than casting was, since they touch the `bind:`-ed scalars (`tempHpInput`,
 * `customEffectLabel`, `newEffectDuration`, `customMod*`) that CombatMenus and the panels bind to —
 * and a reactivity break across the component↔VM seam does not show up in unit tests, only in the
 * running UI. So: extract mechanically (§7.1), then verify with `shot.mjs`, never blind.
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
		() => this.sheet
	);
	/** Resource/rest subsystem (spell slots, resource pips, short/long rests). */
	resources = new ResourceTracker(
		() => this.character,
		() => this.sheet
	);
	// read the shared reactive content store → a live content refresh (reloadContent) re-derives the
	// sheet with no page reload, while the character's play-state is left untouched
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
		(this.character?.play.effects ?? []).some((e) => e.durationRounds != null)
	);
	// Savage Attacker (N2, `damage_reroll` fact): the last weapon-damage roll the player MAY reroll,
	// keeping the higher weapon-dice total — once per turn (2024). Held until used or superseded by the
	// next attack. The per-turn gate is `savageUsedRound` vs `round`: `round` advances on Next turn, so
	// the use auto-frees each turn with no reset hook. Whether it's OFFERED is fully data-driven — only
	// when a feature contributes a `damage_reroll` fact, and the button is labelled from that feature's
	// own name (see the `damage_reroll` token in token-parser.ts; no feat id/string is hardcoded here).
	private savagePending = $state<{
		spec: DamagePartSpec;
		roll: TypedRoll;
		entry: RollLogEntry;
	} | null>(null);
	private savageUsedRound = $state<number | null>(null);
	/** The feature name offering a once-per-turn weapon-damage reroll RIGHT NOW, or null when none is
	 *  pending / the per-turn use is spent / no `damage_reroll` feature is active. Drives the offer UI. */
	get savageLabel(): string | null {
		if (!this.savagePending || this.savageUsedRound === this.round) return null;
		return this.sheet?.facts.damageReroll[0]?.source ?? null;
	}
	/** The log entry the pending reroll would rewrite — so the roll log can put the button on that row. */
	get savagePendingEntry(): RollLogEntry | null {
		return this.savagePending?.entry ?? null;
	}
	// D3: pins persist per character in ui.spellsPinned (bare ids), not a demo hardcode. Exposed as a
	// boolean map for the panel's `pinned[id]` lookup; toggle via togglePin so the array stays the source.
	pinned = $derived<Record<string, boolean>>(
		Object.fromEntries((this.character?.ui.spellsPinned ?? []).map((id) => [id, true]))
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
			hist.map((le) => ({ label: le.label, expr: le.detail ?? '', total: le.result ?? NaN }))
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
			right: anchorRight ? document.documentElement.clientWidth - r.right : null
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
		this.addEffect({ label, tokens: [token], positive: this.customModSign === '+' });
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
			right: null
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
			mods: req.mods ?? {}
		});
		if (req.queuedDamage)
			this.tray.queueDamage({
				label: req.queuedDamage.label,
				parts: [
					{
						dice: req.queuedDamage.dice,
						mod: req.queuedDamage.mod,
						type: '',
						...(req.queuedDamage.mods ? { mods: req.queuedDamage.mods } : {})
					}
				]
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
				this.resources.resourceSpent(o.resourceId)
		}))
	);

	/** Hit-dice pools for the panel: each die size with its spent/left counts (left disables the spend
	 *  button when the pool is empty — refilled on a long rest). */
	hitDice = $derived(
		(this.sheet?.hitDice ?? []).map((h) => ({
			...h,
			spent: this.resources.hitDiceSpent(h.die),
			left: h.max - this.resources.hitDiceSpent(h.die)
		}))
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
			[die]: Math.max(0, Math.min(left, (this.hdPick[die] ?? 0) + delta))
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
	private get hpMax(): number {
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
		const fx = this.effectsFor('save.con');
		const r = rollPool({ 20: 1 }, this.concentrationSaveMod, netAdvantage(fx), fx.bonusDice, fx);
		this.tray.pushRoll('Concentration save', r);
		if (r.total >= pend.dc) {
			toast(`Concentration held — ${r.total} ≥ DC ${pend.dc}`);
			this.pendingConcentrationSave = null;
		} else {
			toast(`Concentration save failed — ${r.total} < DC ${pend.dc}`, {
				description: 'The spell ends — tap Drop to confirm.'
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

	/** N2 executor (first slice): activate a resource spend-option. Validate the resource cost AND the
	 *  turn slot ALL-OR-NOTHING (ACTIONS.md), then deduct both and run the action token. The turn cost
	 *  was the piece-3 gap — spending an option (Flurry, Second Wind…) now actually consumes its
	 *  action/bonus/reaction, not just the resource. */
	activateResourceOption = (opt: ResourceOption, amount = 1) => {
		if (!this.character) return;
		const slot = ACTION_TYPE_SLOT[opt.actionType]; // null for a free action
		// the `available` L2 guard is a RULE, not a UI state: ActionsPanel greys the row, but the
		// resource chip reaches the same option, so the check belongs here where every caller passes
		// (else a chip could fire Persistent Rage outside its combat-start window).
		if (!opt.available) {
			toast(`${opt.name} — not available right now`);
			return;
		}
		if (!this.resources.canAffordOption(opt, amount)) {
			toast(`${opt.name} — not enough ${opt.resourceId}`, { description: 'Recharge on a rest' });
			return;
		}
		if (slot && !this.economy.canSpend(slot)) {
			toast(`No ${slot} left this turn`, { description: 'Press “Next turn” to refresh.' });
			return;
		}
		if (slot) this.economy.trySpend(slot); // both spends succeed — validated above
		this.resources.spendOption(opt, amount); // deduct the resource (+ its own toast)
		this.runActionToken(opt);
	};

	/** The resource CHIP's primary "use one" gesture. When the pool has exactly ONE action-option, using
	 *  the resource IS that action — so the chip runs it through the executor (validate → spend the pool
	 *  → charge the turn slot → run the action token), identical to clicking the row in Actions. Any
	 *  other split would lie: it was `apply_effect`-only before, so the Second Wind chip silently ticked
	 *  a counter down while healing nothing and charging no Bonus Action (UBUG-16).
	 *  A pool with SEVERAL options (Focus → Flurry / Patient Defense / Step of the Wind) has no single
	 *  action to infer, and a pool with none has nothing to run: both stay a plain decrement, which is
	 *  also the honest escape hatch for spending a point on something the app doesn't model. */
	useResourceOrEnter = (id: string, max: number) => {
		const options = (this.sheet?.resourceOptions ?? []).filter((o) => o.resourceId === id);
		const [only] = options;
		if (options.length === 1 && only) this.activateResourceOption(only);
		else this.resources.useResource(id, max);
	};

	/** Enter/leave combat. Wraps `economy.toggleCombat` (which flips `inCombat` + resets the round) so
	 *  that ENTERING combat = "rolling Initiative" also fires the auto event features. */
	toggleCombat = () => {
		this.economy.toggleCombat();
		if (this.character?.play.inCombat) this.fireInitiativeRegen();
	};

	/** AUTO event on combat start ("when you roll Initiative"): every `regain_on_initiative` feature
	 *  restores its pool up to N and NOTIFIES what happened — auto-apply + toast, the maintainer's call
	 *  for these NO-CHOICE features (Perfect Focus → Focus 4, etc.), the tracker's first event-driven
	 *  auto-mutation. Data-driven (any feature carrying the token fires; notice labelled from its name).
	 *  Gated on auto-calc: with it OFF the player manages pools by hand, so the app doesn't touch them. */
	private fireInitiativeRegen() {
		const c = this.character;
		if (!c?.play.autoCalc) return;
		for (const r of this.sheet?.facts.initiativeRegain ?? []) {
			const def = this.sheet?.resources.find((x) => x.id === r.id);
			if (!def) continue;
			const before = def.max - (c.play.resourcesSpent?.[r.id] ?? 0);
			const after = this.resources.restoreUpTo(r.id, r.upTo);
			if (after > before)
				toast(r.source, { description: `${titleCase(r.id)} restored — now ${after}` });
		}
	}

	/** Run a resource-option's RESOLVED action token (a `heal:`/`roll:` formula is already L2-resolved
	 *  at derive). Each verb lands on an EXISTING system (ACTIONS.md §2 — no new mutation paths):
	 *  `heal:` → HP path (clamped), `roll:` → tray + log, `apply_condition:` → the effect add path,
	 *  `apply_effect:<id>` → apply a NAMED effects.csv buff/debuff (Rage) via the "+"-catalog add path
	 *  (ref/negative/duration all read from the row), `gain_action` → refund one action this turn
	 *  (Action Surge), `rest:short|long` → take that rest
	 *  (recharge pools / reset slots / restore HP — a Potion of Angelic Slumber, 2024 short-rest
	 *  spells), `restore_resource:<id>` → regain ALL uses of a pool (Persistent Rage, Uncanny
	 *  Metabolism), `note:` → the spendOption toast. */
	private runActionToken(opt: ResourceOption) {
		// a `;`-separated action is a MULTI-action (Uncanny Metabolism = restore focus AND heal): run each
		// sub-token in order on the ONE activation (cost + turn slot were validated once, up front).
		for (const token of opt.action.split(';')) {
			const t = token.trim();
			if (t) this.runOneAction(opt, t);
		}
	}

	/** Run ONE resolved action verb (`opt.action` may hold several, `;`-joined — see `runActionToken`).
	 *  Each verb lands on an EXISTING system (ACTIONS.md §2 — no new mutation paths). */
	private runOneAction(opt: ResourceOption, action: string) {
		const p = this.character?.play;
		if (!p) return;
		const sep = action.indexOf(':');
		const verb = sep === -1 ? action : action.slice(0, sep);
		const arg = sep === -1 ? '' : action.slice(sep + 1);
		if (verb === 'heal' && arg) {
			const r = rollFormula(arg);
			p.hp.current = Math.min(this.hpMax, p.hp.current + Math.max(0, r.total));
			this.tray.pushRoll(`${opt.name} — heal`, r);
		} else if (verb === 'roll' && arg) {
			this.tray.pushRoll(opt.name, rollFormula(arg));
		} else if (verb === 'apply_condition' && arg) {
			this.addEffect({ label: opt.name, tokens: [action], positive: false });
		} else if (verb === 'apply_effect' && arg) {
			this.applyCatalogEffect(opt, arg);
		} else if (verb === 'gain_action') {
			p.turn.action = Math.max(0, p.turn.action - 1); // one additional action this turn
		} else if (verb === 'restore_resource' && arg) {
			this.resources.restoreAll(arg); // regain all uses of the pool (Persistent Rage / Uncanny Metabolism)
		} else if (verb === 'rest' && (arg === 'short' || arg === 'long')) {
			// grant a rest: lands on the SAME rest system the rest buttons use (recharge pools by type,
			// reset slots, restore HP + hit dice on a long rest, expire outlasted timed effects). A
			// consumable that grants a rest MUST have recharge `other` so the rest it triggers doesn't
			// refund its own charge (see ACTIONS.md §2).
			this.resources.rest(arg);
			toast(`${opt.name} — ${arg} rest taken`);
		}
	}

	/** `apply_effect:<id>` — apply a NAMED catalog buff/debuff (Rage, Bless-as-action…) via the SAME add
	 *  path the "+" picker uses: its `ref` re-resolves the tokens LIVE at derive, `negative` sets
	 *  buff/debuff, `duration_rounds` gives the timer (round-counter auto-expires it). Missing id →
	 *  surface, not a silent no-op. Split out of `runOneAction` to keep its verb-dispatch under budget. */
	private applyCatalogEffect(opt: ResourceOption, arg: string) {
		const p = this.character?.play;
		if (!p) return;
		const cat = this.effectCatalog.find((eff) => eff.ref.split(':').pop() === arg);
		if (!cat) {
			toast(`${opt.name} — effect “${arg}” not found`, { description: 'Check effects.csv' });
			return;
		}
		// a named STATE doesn't stack — you're raging or you're not (RAW/RAI). Re-entering refreshes
		// (drop any live instance of the same catalog ref first), never adds a second Rage.
		p.effects = p.effects.filter((e) => e.source !== cat.ref);
		this.addEffect({
			label: cat.label,
			tokens: cat.tokens,
			positive: !cat.negative,
			ref: cat.ref,
			...(cat.durationRounds != null ? { durationRounds: cat.durationRounds } : {})
		});
	}

	groupByLabel = $derived(
		{ level: 'By level', prepared: 'Prepared', school: 'By school' }[this.spellGroupBy]
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
			: ''
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
			comp: sheet.passives[k] // effect-adjusted (adv/dis ±5, passive.<skill>), not bare 10+mod
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
			name: this.graph ? String(this.graph.get(c.class)?.data.name_en ?? 'Class') : 'Class'
		}))
	);
	/** Add one level to a class and persist (the sheet re-derives HP/prof/slots/features live).
	 *  New choices at this level — ASI/feat/spells — are picked in the builder; here we advance the
	 *  mechanical level (lenient), flag the rest. */
	levelUp = (classIndex: number) => {
		const c = this.character;
		if (!c || !this.canLevelUp) return;
		c.build.classes = c.build.classes.map((cl, i) =>
			i === classIndex ? { ...cl, level: cl.level + 1 } : cl
		);
		void saveCharacterToStore(c);
		this.overlay = null;
		const cls = c.build.classes[classIndex];
		if (cls)
			toast(`Level up — ${this.graph?.get(cls.class)?.data.name_en ?? 'class'} ${cls.level}`, {
				description: 'HP & slots updated. Set any new ASI/feat/spells in the builder.'
			});
	};

	/** Advantage/disadvantage + flat + bonus dice + reroll/min_die a roll picks up from active
	 *  effects (gated on the effects-auto toggle). Reads the sheet's typed-facts object (D7: guards
	 *  evaluated, conditions expanded, expression values resolved — B21), not raw `play.effects`. */
	effectsFor(key: string, weaponScopes?: Set<string>): RollEffects {
		const c = this.character;
		if (!c || !c.play.autoCalc || !this.sheet) return NO_ROLL_EFFECTS; // effects-auto off → plain rolls
		return rollEffectsFor(this.sheet.facts, key, weaponScopes);
	}

	/** A forced outcome (paralyzed → auto-fail STR/DEX saves) for a roll key, or null. Gated on the
	 *  same effects-auto toggle as `effectsFor`, so turning auto off restores plain rolls. */
	private autoOutcomeFor(key: string): 'fail' | 'succeed' | null {
		const c = this.character;
		if (!c || !c.play.autoCalc || !this.sheet) return null;
		return autoOutcome(this.sheet.facts, key);
	}

	// open the roll builder prefilled + anchored, so the player can pick advantage then Roll
	openRoll = (spec: RollSpec, e: Event) => {
		this.tray.prefill(spec);
		this.openMenu('dice', e);
	};
	// EVERY roll site: normal tap rolls instantly; Alt/Ctrl-click opens the prefilled tray. `key`
	// (e.g. "save.dex", "skill.stealth", "attack") lets the roll pick up matching effects. NB the
	// flat part is IGNORED for save/skill keys — it's already folded into the sheet value `mod`.
	roll = (label: string, mod: number, e: Event, key?: string) => {
		// a forced outcome (paralyzed → auto-fail its STR/DEX save) skips the die entirely — the result
		// is decided by the condition, not the roll; logged as a no-roll marker so it's still visible
		const forced = key ? this.autoOutcomeFor(key) : null;
		if (forced) {
			this.tray.logMarker(`${label} — auto-${forced}`);
			toast(`${label}: automatic ${forced === 'fail' ? 'failure' : 'success'}`);
			return;
		}
		const fx = key ? this.effectsFor(key) : null;
		const adv = fx ? netAdvantage(fx) : 0;
		if (wantsTray(e))
			this.openRoll({ label, dice: { 20: 1 }, mod, advantage: adv, mods: fx ?? {} }, e);
		else
			this.tray.rollDiceNow({
				label,
				dice: { 20: 1 },
				mod,
				advantage: adv,
				bonusDice: fx?.bonusDice ?? [],
				mods: fx ?? {}
			});
	};

	/** Roll a death save (shown while at 0 HP): a d20 vs 10 — `save.death`-targeted effects (and
	 *  the `saves`/`d20_tests` groups: Bless, exhaustion) apply. Outcomes per RAW: nat 20 → back up
	 *  at 1 HP; nat 1 → two failures; 10+ → success; three successes → stable (counters reset). */
	deathSave = () => {
		const c = this.character;
		if (!c) return;
		const fx = this.effectsFor('save.death');
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
	private die = (cause: DeathCause) => {
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

	/** Roll a weapon/unarmed attack (the Attack action → spends an action in combat). A normal tap
	 *  rolls the to-hit (picks up attack advantage/flat/dice effects) THEN the weapon damage (with
	 *  `damage`-keyed effects — Rage +2, sneak/hemocraft dice); Alt/Ctrl-click opens the roll tray. */
	attackRoll = (at: Attack, e: Event) => {
		if (!this.economy.trySpend('action')) return;
		// §A/§B: pass this weapon's category tags so a scoped effect (GWF's min_die on two-handed melee
		// damage) applies only to matching weapons; unscoped effects (Bless, Rage) apply regardless.
		const scopes = new Set(at.scopes);
		const fx = this.effectsFor('attack', scopes);
		const dmgFx = this.effectsFor('damage', scopes);
		// Damage effects (Bless-style flat/dice, reroll/min_die) fold onto the PRIMARY part only — RAW
		// adds them to the weapon's base damage, not to a second damage type's dice.
		const parts: DamagePartSpec[] = at.damageParts.map((p, i) => ({
			dice: p.pool,
			mod: p.mod + (i === 0 ? dmgFx.flat : 0),
			type: p.type,
			...(i === 0 ? { bonusDice: dmgFx.bonusDice, mods: dmgFx } : {})
		}));
		// asked AFTER the effects fold in, so a flat damage effect on a damage-less weapon still counts
		const hasDmg = dealsDamage(parts);
		if (wantsTray(e)) {
			// tray on the TO-HIT (pick advantage), then Roll fires the damage as one combined entry
			this.openRoll(
				{
					label: at.name,
					dice: { 20: 1 },
					mod: at.toHit + fx.flat,
					advantage: netAdvantage(fx),
					mods: fx
				},
				e
			);
			if (hasDmg) this.tray.queueDamage({ label: `${at.name} damage`, parts });
			return;
		}
		// instant: to-hit (with effect advantage/flat/dice) + per-type damage → one combined entry
		const toHit = rollPool({ 20: 1 }, at.toHit + fx.flat, netAdvantage(fx), fx.bonusDice, fx);
		const dmgRolls = hasDmg ? rollDamageParts(parts) : undefined;
		// N2 Savage Attacker: does THIS weapon damage qualify for a reroll? The offer itself is not
		// attached to the toast — a toast expires mid-decision, so it announces and the always-visible
		// Playbar (and the log, forever) carries the control, as the ↻ on the damage pill it rerolls.
		// (The Alt-click tray path rolls damage later, so the offer rides the instant tap; a v1 gap.)
		const savage = this.savageOffer(parts[0], dmgRolls);
		const entry = this.tray.pushRoll(at.name, toHit, dmgRolls);
		if (savage) this.savagePending = { spec: savage.spec, roll: savage.roll, entry };
	};

	/** Does the attack about to be toasted qualify for a Savage Attacker reroll? ONLY when a feature
	 *  contributes a `damage_reroll` fact, the attack rolled damage dice, and the per-turn use is free.
	 *  Returns the PRIMARY damage part (so the reroll reproduces it) + the roll it made; the caller
	 *  pairs it with the log entry. Fully data-driven — no feat id/name in code. */
	private savageOffer(
		primary: DamagePartSpec | undefined,
		dmgRolls: TypedRoll[] | undefined
	): { spec: DamagePartSpec; roll: TypedRoll } | null {
		const primaryRoll = dmgRolls?.[0];
		// there must be DICE to reroll — a flat-damage attack (Unarmed Strike) now rolls and toasts its
		// damage too, so "damage was rolled" no longer implies "dice were rolled" for this caller
		if (!primary || !primaryRoll || Object.keys(primary.dice).length === 0) return null;
		const label = this.sheet?.facts.damageReroll[0]?.source;
		if (!label || this.savageUsedRound === this.round) return null;
		return { spec: primary, roll: primaryRoll };
	}

	/** Savage Attacker: reroll the pending weapon damage and KEEP THE HIGHER total, rewriting the log
	 *  entry in place (truthful record) and spending the once-per-turn use. Rerolls the whole PRIMARY
	 *  damage part — RAW rerolls only the weapon's own dice, so any bonus die riding that part (Bless) is
	 *  rerolled too: a negligible, arguably-faithful deviation ("use either roll"). */
	savageReroll = () => {
		const p = this.savagePending;
		const label = this.savageLabel;
		if (!p || !label) return;
		const re = rollDamageParts([p.spec])[0];
		if (!re) return;
		const keptRe = re.total > p.roll.total;
		const keep = keptRe ? re : p.roll;
		const dropped = keptRe ? p.roll : re;
		const revised: RollLogEntry = {
			...p.entry,
			damage: [keep, ...(p.entry.damage ?? []).slice(1)],
			note: `${label}: kept ${keep.total} (other roll ${dropped.total})`
		};
		this.tray.reviseEntry(p.entry, revised);
		this.savageUsedRound = this.round;
		this.savagePending = null;
		// re-toast the REVISED roll, not a summary line: the reroll changed the damage, so the player
		// should see the same card again with the kept dice in it
		toastRoll(revised);
	};
	/** Click a standard action (Dash, Hide, …). Spends an action; roll-type ones open their roll,
	 *  no-roll ones just consume the slot. The "Attack" row is a pointer to the Attacks panel. */
	actionClick = (a: StandardAction, e: Event) => {
		if (a.id === 'attack') return; // routes to the Attacks panel; not itself an action spend
		if (!this.economy.trySpend('action')) return;
		if (a.roll) this.roll(a.roll[0], a.roll[1], e);
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
			: []
	);

	// standard actions (from d-charnik); roll ones reference live skills — pure builder in helpers
	actions = $derived.by<StandardAction[]>(() =>
		standardActions(this.sheet, this.character?.system ?? DEFAULT_SYSTEM)
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
					hidden: this.character.ui.spellsHidden
				})
			: []
	);
	// B9: worn non-proficient armor blocks spellcasting (RAW rule-block). Surfaced on the spells panel.
	armorBlock = $derived(this.sheet?.spellcasting.armorBlock);
	// A18-tail: per-class prepared accounting (each prepared spell attributed to the class that grants
	// it). Drives the header (via PreparedCaps); the toggle gate uses canTogglePreparedFor directly.
	preparedTallies = $derived(
		preparedTalliesByClass(this.character?.build.spells ?? [], this.sheet)
	);

	hpBar = $derived.by(() => {
		if (!this.character || !this.sheet) return { cur: 0, tmp: 0 };
		// `|| 1` guards a 0 max (unset HP) so the bar math can't divide → NaN/Infinity (D19)
		// A14: effectiveHpMax so a manual max still stacks hp_max effects (Aid) on top.
		const max = effectiveHpMax(this.character.play.hp.max ?? null, this.sheet.maxHp) || 1;
		return {
			cur: Math.max(0, Math.min(100, (this.character.play.hp.current / max) * 100)),
			tmp: (this.character.play.hp.temp / max) * 100
		};
	});

	// conditions for THIS character's system (not a hardcoded edition). Carries the row `id` (not just
	// the label) so applying one emits `apply_condition:<id>` — the DAG then expands the condition
	// row's own `effects` tokens and registers the id in facts.conditions (what the economy + guards
	// read). An empty effects column still registers the id, so mechanics can be authored incrementally.
	conditionList = $derived.by<{ id: string; label: string }[]>(() => {
		const system = this.character?.system;
		if (!this.graph || !system) return [];
		return (
			this.graph
				.list('condition', { system })
				// leveled conditions (exhaustion, max_level>1) are a stepper, not a binary toggle — they
				// don't belong in this multi-select (they'd double-count with gatherExhaustion). D19.
				.filter((r) => Number(r.data.max_level ?? 1) <= 1)
				.map((r) => ({ id: r.id, label: String(r.data.name_en) }))
		);
	});
	/** The exhaustion ladder height for this character's system (0 = no exhaustion row loaded → the
	 *  stepper hides). Data-driven cap (the row's `max_level`); a taller homebrew ladder Just Works. */
	exhaustionMax = $derived.by<number>(() => {
		const system = this.character?.system;
		if (!this.graph || !system) return 0;
		const row = this.graph.list('condition', { system }).find((r) => r.id === 'exhaustion');
		return row ? Number(row.data.max_level ?? 1) : 0;
	});
	/** Set the exhaustion level, clamped to [0, max]. Play-state mutation (autosaves like HP). The TOP
	 *  of the ladder is lethal — RAW "You die if your Exhaustion level is 6" (2024 glossary; 2014's
	 *  level-6 row is likewise "Death"). The threshold is the DATA cap (`max_level`), so a homebrew
	 *  ladder of a different height still kills at its own top. */
	setExhaustion = (level: number): void => {
		const p = this.character?.play;
		if (!p) return;
		const max = this.exhaustionMax;
		p.exhaustion = Math.max(0, Math.min(max, Math.round(level)));
		if (max > 0 && p.exhaustion >= max) this.die('exhaustion');
	};
	/** A condition's rules text (English, consistent with the panel's other content labels), looked up
	 *  by id — the G2 info channel: the "attacks against you have advantage", concealed, auto-crit
	 *  parts a single-character sheet can't fold onto any stat still reach the player as reference. */
	conditionText = (id: string): string | null => {
		const system = this.character?.system;
		if (!this.graph || !system) return null;
		const row = this.graph.list('condition', { system }).find((r) => r.id === id);
		const text = row ? String(row.data.text_en ?? '') : '';
		return text || null;
	};

	/** A condition's own effect tokens (its `effects` column) — what the panel renders as tags for an
	 *  applied condition, since the effect INSTANCE only carries `apply_condition:<id>`. So a Poisoned
	 *  row shows its disadvantage tags + the display-only `note:` mechanics, not a bare "Poisoned". */
	conditionTokens = (id: string): string[] => {
		const system = this.character?.system;
		if (!this.graph || !system) return [];
		const row = this.graph.list('condition', { system }).find((r) => r.id === id);
		return row?.data.effects ?? [];
	};

	/** The "+" picker catalog — the `effects.csv` CONTENT type scoped to the character's edition
	 *  (user-extendable like all content), not a hardcoded preset list. A row's `duration_rounds`
	 *  is its default duration; blank falls back to the menu's duration picker. */
	effectCatalog = $derived.by(() => {
		const system = this.character?.system;
		if (!this.graph || !system) return [];
		return this.graph.list('effect', { system }).map((r) => ({
			// B17: carry the catalog ref so an added effect resolves LIVE at derive (fixes propagate),
			// with the baked label/tokens kept as the orphan fallback.
			ref: r.effectiveId,
			label: String(r.data.name_en),
			tokens: r.data.effects,
			negative: r.data.negative,
			durationRounds: r.data.duration_rounds ?? null
		}));
	});
	/** Duration (in rounds) applied to the NEXT effect added from the add-effect / custom menus.
	 *  0 = indefinite (lasts until the player removes it). Editable in the add-effect menu. */
	newEffectDuration = $state(10);
	addEffect = (spec: {
		label: string;
		tokens: string[];
		/** Buff (true, default) vs debuff (false) — drives the Buffs/Debuffs split. */
		positive?: boolean;
		/** Rounds it lasts; 0/omitted → the add-effect menu's `newEffectDuration`. */
		durationRounds?: number;
		/** B17: the catalog ref (effectiveId) when added from the "+" catalog — stored so derive
		 *  resolves the effect LIVE (fixes propagate); omitted for custom/GM effects (baked only). */
		ref?: string;
	}) => {
		if (!this.character) return;
		const durationRounds = spec.durationRounds ?? this.newEffectDuration;
		// 0 / negative → indefinite: omit the duration fields entirely (schema: absent = until removed)
		const duration =
			durationRounds > 0
				? { durationRounds: Math.round(durationRounds), startedRound: this.round }
				: {};
		this.character.play.effects = [
			...this.character.play.effects,
			{
				iid: crypto.randomUUID(),
				label: spec.label,
				effects: spec.tokens,
				positive: spec.positive ?? true,
				...(spec.ref !== undefined ? { source: spec.ref } : {}),
				...duration
			}
		];
		this.overlay = null;
	};
	/** Remove an active effect from the panel (the ✕). */
	removeEffect = (iid: string) => {
		const c = this.character;
		if (c) c.play.effects = c.play.effects.filter((e) => e.iid !== iid);
	};
	/** Set an active effect's remaining duration to an exact round count (typed into the panel field).
	 *  The typed number means "rounds from NOW" — the start is re-anchored to the current round.
	 *  0 / blank → indefinite: the duration fields are removed ("until removed"). */
	setEffectDuration = (iid: string, rounds: number) => {
		const c = this.character;
		if (!c) return;
		const n = Math.max(0, Math.round(rounds || 0));
		c.play.effects = c.play.effects.map((e) => {
			if (e.iid !== iid) return e;
			if (n === 0) {
				const { durationRounds: _d, startedRound: _s, ...rest } = e;
				return rest;
			}
			return { ...e, durationRounds: n, startedRound: this.round };
		});
	};
	/** Nudge an active effect's REMAINING duration by ±1 round from the panel. Dropping to 0 makes it
	 *  indefinite again (the duration fields are removed), so − past 1 == "until removed". */
	bumpEffectDuration = (iid: string, delta: number) => {
		const e = this.character?.play.effects.find((x) => x.iid === iid);
		const cur = e ? (remainingRounds(e, this.round) ?? 0) : 0;
		this.setEffectDuration(iid, cur + delta);
	};
}

/** The single shared Combat view-model instance. */
export const combat = new CombatVM();
