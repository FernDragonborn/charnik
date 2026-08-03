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
import { tokensOf, type ContentGraph } from '$lib/content/loader';
import { rollPool, rollFormula } from '$lib/rules/dice';
import type { Character } from '$lib/character/schema';
import {
	titleCase,
	wantsTray,
	GROUP_MODES,
	type GroupMode,
	durationToRounds,
	remainingRounds,
	rollEffectsFor,
	autoOutcome,
	netAdvantage,
	NO_ROLL_EFFECTS,
	type RollEffects,
	computeAttacks,
	standardActions,
	buildSpellGroups,
	casterForSpell,
	preparedTalliesByClass,
	canTogglePreparedFor,
	parseDamageParts,
	formatDamageParts,
	rollDamageParts,
	modTargetLabel,
	metres,
	applyDefense,
	effectiveHpMax,
	type Attack,
	type DamagePart,
	type DamagePartSpec,
	type SpellRow,
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
import type { SpellcastingClass } from '$lib/character/spellcasting';
import { registerDiceTray, openDiceTray, type DiceTrayRequest } from '$lib/dice/tray.svelte';
import { isRowActive } from '$lib/content/sources.svelte';
import { PanelLayout } from './panel.svelte';
import { TurnEconomy } from './economy.svelte';
import { ResourceTracker } from './resources.svelte';
import { slotToSpend, castableSlotLevels } from '$lib/rules/spellcasting';
import { withCastSlot, withSpellcastingMod } from '$lib/effects/context';
import type { ExprContext } from '$lib/effects/expression-evaluator';
import { evalUpcast, combinePools } from '$lib/effects/upcast';

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
 * D1 EXCEPTION — file over the 400-line lint (warn-only). Split DEFERRED, not forbidden: it's not
 * worth the churn / reactivity-regression risk right now, not that it can't be done.
 *
 * Already out: pure math → `$lib/combat/helpers`; four subsystems (`tray`/`layout`/`economy`/
 * `resources`) each own their slice behind a callback accessor. The remaining `bind:`-surface is
 * actually small — a handful of scalars (`customModTarget`/`customModSign`/`customModAmount`, `tempHpInput`,
 * `customEffectLabel`, `newEffectDuration`) `bind:`-ed in CombatMenus / the panels — so a split is
 * mostly re-threading those, and reactivity bugs across the component↔VM seam don't show up in unit
 * tests (only in the running UI). If we DO cut, the cleanest next slice is spell/cast (~200 lines,
 * zero bound state → extractable via the proven subsystem pattern like economy/resources), then the
 * HP slice; verify in the live app (shot.mjs), never blind. Until a real need, staying over is fine.
 */
/** The upcast contribution to ONE cast: the folded damage/heal deltas as typed parts (item 2 —
 *  `damage:cold:…` routes to the cold part), plus a provenance label suffix ("(slot 5)"). */
type UpcastCast = { deltas: DamagePart[]; suffix: string };

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

	load = async () => {
		await loadContentStore(); // populate the shared graph; `this.graph` derives from it
		// the character opened from the Roster, else the persisted demo (same instance the Spellbook edits)
		this.character = await ensureActiveCharacter();
		// once-per-session snapshot of this character for the rolling backup ring (B3)
		void snapshotCharacterOnLaunch(getUserStorage(), this.character.id);
		// restore this character's saved panel layout (falls back to the default columns)
		this.layout.restore(this.character.ui.panelColumns);
		// restore the persisted roll history so the log isn't empty after a reload (B4)
		const hist = await readLog(getUserStorage(), this.character.id);
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

	setTempHp = () => {
		if (this.character) this.character.play.hp.temp = Math.max(0, this.tempHpInput);
		this.overlay = null;
	};

	// --- HP: apply damage / healing to the play-state (temp HP soaks damage first) -------------
	hpAmount = $state(1);
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
		p.hp.current = Math.max(0, p.hp.current - n);
		// §6: taking damage while concentrating prompts a CON save (DC = max(10, ⌊damage/2⌋)) — a
		// REMINDER, not an auto-drop (play-tracker surfaces, never forces). 0-HP already ends it via
		// endConcentrationIfBroken, so only remind while still up.
		if (taken > 0 && p.concentration && p.hp.current > 0) {
			const dc = Math.max(10, Math.floor(taken / 2));
			toast(`Concentration — roll a CON save (DC ${dc})`, {
				description: 'Fail → the spell ends. Tap the concentration indicator to drop it.'
			});
		}
	};
	heal = () => {
		const p = this.character?.play;
		if (!p) return;
		p.hp.current = Math.min(this.hpMax, p.hp.current + Math.max(0, Math.round(this.hpAmount)));
	};

	/** N2 executor (first slice): activate a resource spend-option. Validate the resource cost AND the
	 *  turn slot ALL-OR-NOTHING (ACTIONS.md), then deduct both and run the action token. The turn cost
	 *  was the piece-3 gap — spending an option (Flurry, Second Wind…) now actually consumes its
	 *  action/bonus/reaction, not just the resource. */
	activateResourceOption = (opt: ResourceOption, amount = 1) => {
		if (!this.character) return;
		const slot = ACTION_TYPE_SLOT[opt.actionType]; // null for a free action
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

	/** Run a resource-option's RESOLVED action token (a `heal:`/`roll:` formula is already L2-resolved
	 *  at derive). Each verb lands on an EXISTING system (ACTIONS.md §2 — no new mutation paths):
	 *  `heal:` → HP path (clamped), `roll:` → tray + log, `apply_condition:` → the effect add path,
	 *  `gain_action` → refund one action this turn (Action Surge), `rest:short|long` → take that rest
	 *  (recharge pools / reset slots / restore HP — a Potion of Angelic Slumber, 2024 short-rest
	 *  spells), `note:` → the spendOption toast. */
	private runActionToken(opt: ResourceOption) {
		const p = this.character?.play;
		if (!p) return;
		const sep = opt.action.indexOf(':');
		const verb = sep === -1 ? opt.action : opt.action.slice(0, sep);
		const arg = sep === -1 ? '' : opt.action.slice(sep + 1);
		if (verb === 'heal' && arg) {
			const r = rollFormula(arg);
			p.hp.current = Math.min(this.hpMax, p.hp.current + Math.max(0, r.total));
			this.tray.pushRoll(`${opt.name} — heal`, r);
		} else if (verb === 'roll' && arg) {
			this.tray.pushRoll(opt.name, rollFormula(arg));
		} else if (verb === 'apply_condition' && arg) {
			this.addEffect({ label: opt.name, tokens: [opt.action], positive: false });
		} else if (verb === 'gain_action') {
			p.turn.action = Math.max(0, p.turn.action - 1); // one additional action this turn
		} else if (verb === 'rest' && (arg === 'short' || arg === 'long')) {
			// grant a rest: lands on the SAME rest system the rest buttons use (recharge pools by type,
			// reset slots, restore HP + hit dice on a long rest, expire outlasted timed effects). A
			// consumable that grants a rest MUST have recharge `other` so the rest it triggers doesn't
			// refund its own charge (see ACTIONS.md §2).
			this.resources.rest(arg);
			toast(`${opt.name} — ${arg} rest taken`);
		}
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
	private removeLinkedEffect(ref: string) {
		const c = this.character;
		if (c) c.play.effects = c.play.effects.filter((e) => e.source !== ref);
	}
	/** Stop concentrating (tap the concentration indicator). */
	clearConcentration = () => {
		const c = this.character;
		if (!c) return;
		if (c.play.concentration) this.removeLinkedEffect(c.play.concentration);
		c.play.concentration = null;
	};
	/** RAW: dropping to 0 HP or becoming incapacitated ENDS concentration (CONCENTRATION-PLAN §7).
	 *  Called reactively from the combat page so it fires the instant HP hits 0 (Damage) or an
	 *  incapacitating condition lands. Idempotent — a no-op once concentration is already gone. */
	endConcentrationIfBroken = () => {
		const c = this.character;
		if (!c?.play.concentration) return;
		if (c.play.hp.current <= 0 || this.economy.incapacitated) this.clearConcentration();
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
	private effectsFor(key: string, weaponScopes?: Set<string>): RollEffects {
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
			if (ds.failures >= 3) toast('Three failures — the character has died', { description: '💀' });
		}
	};

	/** Manually set a death-save track (players track by hand too): clicking pip `index` fills to it,
	 *  or clears it when it's already the last filled one. `kind` is 'successes' | 'failures'. */
	toggleDeathSave = (kind: 'successes' | 'failures', index: number) => {
		const ds = this.character?.play.deathSaves;
		if (!ds) return;
		ds[kind] = ds[kind] === index + 1 ? index : index + 1;
	};

	/** Roll a weapon/unarmed attack (the Attack action → spends an action in combat). A normal tap
	 *  rolls the to-hit (picks up attack advantage/flat/dice effects) THEN the weapon damage (with
	 *  `damage`-keyed effects — Rage +2, sneak/hemocraft dice); Alt/Ctrl-click opens the roll tray. */
	attackRoll = (at: Attack, e: Event) => {
		if (!this.economy.trySpend('action')) return;
		const hasDice = at.damageParts.some((p) => Object.keys(p.pool).length > 0);
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
			if (hasDice) this.tray.queueDamage({ label: `${at.name} damage`, parts });
			return;
		}
		// instant: to-hit (with effect advantage/flat/dice) + per-type damage → one combined entry
		const toHit = rollPool({ 20: 1 }, at.toHit + fx.flat, netAdvantage(fx), fx.bonusDice, fx);
		this.tray.pushRoll(at.name, toHit, hasDice ? rollDamageParts(parts) : undefined);
	};
	/** Click a standard action (Dash, Hide, …). Spends an action; roll-type ones open their roll,
	 *  no-roll ones just consume the slot. The "Attack" row is a pointer to the Attacks panel. */
	actionClick = (a: StandardAction, e: Event) => {
		if (a.id === 'attack') return; // routes to the Attacks panel; not itself an action spend
		if (!this.economy.trySpend('action')) return;
		if (a.roll) this.roll(a.roll[0], a.roll[1], e);
		else toast(`${a.name} — action used`);
	};

	/** Casting applies the spell's OWN effect tokens (EFX-2): they become a runtime effect on self,
	 *  expiring per the spell's duration text; linked via `source: r.ref` so dropping/replacing
	 *  concentration (or re-casting = refresh) removes/replaces it. No tokens → no-op. */
	private applySpellEffect(r: SpellRow, slotLevel: number) {
		const c = this.character;
		const spell = this.graph?.get(r.ref);
		const tokens = tokensOf(spell);
		// Model C (CONCENTRATION-PLAN): a CONCENTRATION spell ALWAYS gets a carrier effect — even
		// token-less — so its duration is TIMED (the carrier owns the clock; `play.concentration` is a
		// ref to it, and the carrier expiring ends concentration). Before, a token-less control spell
		// (Hold Person, Web…) had no carrier → its concentration hung until a long rest. A
		// NON-concentration spell with no tokens has nothing to track → still a no-op.
		// B3 (item 3): an hp_max upcast scales the magnitude of the effect the spell grants — Aid's base
		// `flat_bonus:hp_max+5` gets an ADDITIONAL `flat_bonus:hp_max+delta` per slot above base. hp_max
		// is a fold target, so the two tokens sum cleanly (no string-surgery over the base token).
		const hpMaxDelta = this.upcastFlatDelta(r, slotLevel, 'hp_max');
		const effects = hpMaxDelta > 0 ? [...tokens, `flat_bonus:hp_max+${hpMaxDelta}`] : tokens;
		if (!c || (!effects.length && !r.concentration)) return;
		this.removeLinkedEffect(r.ref); // re-cast refreshes instead of stacking a duplicate
		const rounds = this.carrierRounds(r, spell, slotLevel);
		c.play.effects = [
			...c.play.effects,
			{
				iid: crypto.randomUUID(),
				label: r.name,
				source: r.ref,
				effects,
				positive: true,
				...(rounds ? { durationRounds: rounds, startedRound: this.round } : {})
			}
		];
	}

	/** The carrier effect's duration in ROUNDS. A `duration` upcast (an ABSOLUTE total — Hunter's Mark
	 *  8 h → 24 h) wins over the spell's base duration text; `inf` (permanent) → null (no expiry). No
	 *  duration upcast (or effects-auto off) → the base `durationToRounds`. Units are the rounds canon
	 *  (CONCENTRATION-PLAN §8). */
	private carrierRounds(
		r: SpellRow,
		spell: ReturnType<ContentGraph['get']>,
		slotLevel: number
	): number | null {
		const base = spell?.type === 'spell' ? durationToRounds(String(spell.data.duration)) : null;
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res || res.kind !== 'duration') continue;
			if (res.isInfinite) return null; // permanent → no timer
			if (res.flat > 0) return res.flat; // absolute total rounds (0 = below first tier → keep base)
		}
		return base;
	}

	/** Reserve a leveled spell slot for a non-ritual cast (A17): returns the slot key to spend, or
	 *  null (nothing to spend — cantrip / pure-pact / ritual), or 'blocked' (+ a toast) when none
	 *  remain. Reserve-before-commit so a block returns BEFORE the action economy is touched. */
	private reserveSpellSlot(
		r: SpellRow,
		ritual: boolean,
		chosenLevel?: number
	): string | null | 'blocked' {
		const play = this.character?.play;
		if (ritual || !play) return null;
		const spend = slotToSpend(
			r.level,
			this.sheet?.spellcasting.pools ?? [],
			play.spellSlotsSpent,
			chosenLevel
		);
		if (spend && 'block' in spend) {
			toast(spend.block);
			return 'blocked';
		}
		return spend && 'key' in spend ? spend.key : null;
	}

	/** The roll half of a cast: an attack spell rolls its TO-HIT (attack-keyed effects) then queued
	 *  damage; a damage/heal spell rolls its dice (auto = healing + spellcasting mod); a no-roll cast
	 *  logs a marker. Uses the class the spell is cast AS (A18), not classes[0]. */
	/** Attack spell (r.resolution === 'hit'): roll the TO-HIT (attack-keyed effects) then its damage — tray
	 *  chains them (to-hit now, damage queued), instant folds both into one 3-line entry. */
	/** A spell's typed damage parts for the roll path (item 2): base parts (`r.damageParts`) with the
	 *  upcast deltas folded in BY TYPE — an untyped delta (`damage:per_slot`) onto the primary part, a
	 *  typed one (`damage:cold:per_slot` — Ice Knife) onto the part sharing its type, or as its OWN new
	 *  part when the base can't supply that type (N4/N9: Web adds fire to a fire-less base). `primaryFx`
	 *  (damage effects, or the heal's spellcasting-mod flat) rides the PRIMARY part only — RAW adds a
	 *  damage bonus / the ability mod once, to the base, never to a second type's dice. */
	private spellDamageParts(
		r: SpellRow,
		primaryFx: RollEffects,
		deltas: DamagePart[]
	): DamagePartSpec[] {
		const parts: DamagePart[] = r.damageParts.map((p) => ({
			pool: { ...p.pool },
			mod: p.mod,
			type: p.type
		}));
		for (const d of deltas) {
			const idx = d.type ? parts.findIndex((p) => p.type === d.type) : 0;
			const hit = idx >= 0 ? parts[idx] : undefined;
			if (hit) {
				const merged = combinePools(hit.pool, hit.mod, d.pool, d.mod);
				parts[idx] = { pool: merged.pool, mod: merged.flat, type: hit.type };
			} else parts.push({ pool: { ...d.pool }, mod: d.mod, type: d.type });
		}
		return parts.map((p, i) => ({
			dice: p.pool,
			mod: p.mod + (i === 0 ? primaryFx.flat : 0),
			type: p.type,
			...(i === 0 ? { bonusDice: primaryFx.bonusDice, mods: primaryFx } : {})
		}));
	}

	/** The ephemeral cast ctx for evaluating a spell's `upcast` (§4/§5): the post-derive sheet ctx
	 *  wrapped with the cast-only `{slot, spell_level}` vars, AND `spellcasting_mod` re-pointed at the
	 *  class the spell is CAST AS (`casterForSpell`) rather than the primary caster — so a formula
	 *  reading `spellcasting_mod` (an upcast that scales with the caster's ability) picks up the right
	 *  class's mod on a multiclass sheet (item 5, SPEC4). Falls back to the sheet's primary
	 *  `spellcasting_mod` when no class claims the spell. */
	private castCtxFor(r: SpellRow, base: ExprContext, slotLevel: number): ExprContext {
		const withSlot = withCastSlot(base, slotLevel, r.level);
		const caster = casterForSpell(this.sheet, r.ref);
		if (!caster) return withSlot;
		return withSpellcastingMod(withSlot, this.sheet?.abilities[caster.ability]?.mod ?? 0);
	}

	/** Evaluate a spell's `upcast` cell against its cast ctx at `slotLevel` — the ONE place the ephemeral
	 *  ctx is built, so the damage / duration / hp_max / temp_hp consumers below all read the same
	 *  evaluation. Empty when there's no `upcast` or no cast ctx (effects-auto off — N6 respects the
	 *  toggle). Pure read; each caller picks the kinds it cares about. */
	private evalUpcastAt(r: SpellRow, slotLevel: number): ReturnType<typeof evalUpcast> {
		const base = this.sheet?.castCtx;
		if (!r.upcast || !base) return [];
		return evalUpcast(r.upcast, this.castCtxFor(r, base, slotLevel));
	}

	/** The summed FLAT upcast delta for one magnitude kind (`hp_max` / `temp_hp`) at a cast slot — the
	 *  extra hit-point-max / temp-HP a spell grants per slot above its base (Aid, False Life). Broken
	 *  tokens degrade (toast), never a wrong number (H11). */
	private upcastFlatDelta(r: SpellRow, slotLevel: number, kind: 'hp_max' | 'temp_hp'): number {
		let acc = 0;
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res) {
				if (res.raw.startsWith(kind)) toast(`Upcast: ${res.error}`);
				continue;
			}
			if (res.kind === kind) acc += res.flat;
		}
		return acc;
	}

	/** The damage/heal upcast deltas as typed parts for a cast from `slotLevel` (item 2): evaluate the
	 *  spell's `upcast` cell against the ephemeral cast ctx (post-derive snapshot + {slot, spell_level})
	 *  and keep each damage/heal delta with its own type (`damage:cold:…` → a cold-typed delta the roll
	 *  path routes to the cold part). Empty when there's no `upcast`, no cast ctx (effects-auto off — N6
	 *  respects the toggle), or the slot equals the base level. count/area/duration are handled
	 *  elsewhere. A zero delta (base slot) is dropped so it adds no phantom part. A broken formula
	 *  degrades (toast + base only, H11), never silently-wrong dice. */
	private upcastDamageParts(r: SpellRow, slotLevel: number): DamagePart[] {
		const out: DamagePart[] = [];
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res) {
				toast(`Upcast: ${res.error}`);
				continue;
			}
			if ((res.kind !== 'damage' && res.kind !== 'heal') || res.combine !== 'delta') continue;
			if (Object.keys(res.pool).length === 0 && res.flat === 0) continue; // base slot → no delta
			out.push({ pool: res.pool, mod: res.flat, type: res.type ?? '' });
		}
		return out;
	}

	private rollSpellAttack(r: SpellRow, e: Event, caster: SpellcastingClass, up: UpcastCast): void {
		const fx = this.effectsFor('attack');
		const dmgFx = this.effectsFor('damage');
		const toHit = caster.attack.value + fx.flat;
		const parts = this.spellDamageParts(r, dmgFx, up.deltas);
		const hasDmg = parts.some((p) => Object.keys(p.dice).length > 0 || p.mod !== 0);
		if (wantsTray(e)) {
			this.openRoll(
				{
					label: `${r.name} (spell attack)`,
					dice: { 20: 1 },
					mod: toHit,
					advantage: netAdvantage(fx),
					mods: fx
				},
				e
			);
			if (hasDmg) this.tray.queueDamage({ label: `${r.name} damage${up.suffix}`, parts });
		} else {
			this.tray.pushRoll(
				`${r.name} (spell attack)`,
				rollPool({ 20: 1 }, toHit, netAdvantage(fx), fx.bonusDice, fx),
				hasDmg ? rollDamageParts(parts) : undefined
			);
		}
	}

	/** The typed roll parts + kind label for a non-attack cast: a `save` deals damage, `auto` heals,
	 *  `temp` grants temporary HP. A DICE heal (Cure Wounds "1d8 + mod") adds the spellcasting mod; a
	 *  FLAT heal (Heal's 70) and temp HP (False Life) do NOT — in SRD the ability mod rides dice-valued
	 *  HEALING only (item 6). Damage effects never ride a heal / temp-HP roll, so its "primary fx" is
	 *  just that mod (0 for temp) as a flat. temp HP scales via its OWN `temp_hp` upcast delta, damage /
	 *  heal via the typed damage/heal delta pool (item 3). */
	private spellOutcomeParts(
		r: SpellRow,
		caster: SpellcastingClass | undefined,
		up: UpcastCast,
		slotLevel: number
	): { parts: DamagePartSpec[]; kind: string } {
		const heal = r.resolution === 'auto';
		const temp = r.resolution === 'temp';
		const healDice = r.damageParts.some((p) => Object.keys(p.pool).length > 0);
		const healMod =
			heal && healDice && caster ? (this.sheet?.abilities[caster.ability]?.mod ?? 0) : 0;
		const primaryFx: RollEffects =
			heal || temp ? { ...NO_ROLL_EFFECTS, flat: healMod } : this.effectsFor('damage');
		const tempDelta = temp ? this.upcastFlatDelta(r, slotLevel, 'temp_hp') : 0;
		const deltas = temp ? (tempDelta ? [{ pool: {}, mod: tempDelta, type: '' }] : []) : up.deltas;
		return {
			parts: this.spellDamageParts(r, primaryFx, deltas),
			kind: temp ? 'temp HP' : heal ? 'healing' : 'damage'
		};
	}

	private rollSpellCast(r: SpellRow, e: Event, ritual: boolean, slotLevel: number): void {
		const alt = wantsTray(e);
		const caster = casterForSpell(this.sheet, r.ref) ?? this.sheet?.spellcasting.classes[0];
		// the upcast contribution + its provenance tag (B8): when actually upcast, the suffix names the
		// slot AND what it added ("(slot 5 · +2d6)") — reusing castPreview — so the roll log / toast
		// explains the boosted total instead of a bare number.
		const preview = slotLevel > r.level ? this.castPreview(r, slotLevel) : '';
		const up: UpcastCast = {
			deltas: this.upcastDamageParts(r, slotLevel),
			suffix: slotLevel > r.level ? ` (slot ${slotLevel}${preview ? ` · ${preview}` : ''})` : ''
		};
		if (r.resolution === 'hit' && caster) {
			this.rollSpellAttack(r, e, caster, up);
			return;
		}
		const { parts, kind } = this.spellOutcomeParts(r, caster, up, slotLevel);
		if (parts.some((p) => Object.keys(p.dice).length > 0 || p.mod !== 0)) {
			this.rollDamageEntry(`${r.name} ${kind}${up.suffix}`, parts, e, alt);
		} else {
			// a cast with no roll (buff/utility): a bare log marker, not a rolled total
			const suffix = ritual ? ' (ritual)' : '';
			this.tray.logMarker(`Cast ${r.name}${suffix}`);
			toast(`Cast ${r.name}${suffix}`);
		}
	}

	/** Roll a spell's damage/heal from its typed parts: the FIRST part is the primary (rolled + shown as
	 *  the entry); the rest are typed damage lines under it (Ice Knife's cold under its piercing). `alt`
	 *  opens the prefilled tray instead of rolling instantly (queuing the rest as its follow-up). */
	private rollDamageEntry(label: string, parts: DamagePartSpec[], e: Event, alt: boolean): void {
		const [primary, ...rest] = parts;
		if (!primary) return;
		if (alt) {
			this.openRoll(
				{
					label,
					dice: primary.dice,
					mod: primary.mod,
					...(primary.bonusDice ? { bonusDice: primary.bonusDice } : {}),
					...(primary.mods ? { mods: primary.mods } : {})
				},
				e
			);
			if (rest.length) this.tray.queueDamage({ label, parts: rest });
		} else {
			this.tray.pushRoll(
				label,
				rollPool(primary.dice, primary.mod, 0, primary.bonusDice ?? [], primary.mods ?? {}),
				rest.length ? rollDamageParts(rest) : undefined
			);
		}
	}

	/** Every slot level this spell can be cast from right now (the upcast picker's options; a UI can
	 *  offer these and pass the choice as `cast(r, e, { slot })`). Empty = no choice (cantrip / single
	 *  option / no open slot). */
	castableSlots = (r: SpellRow): number[] =>
		castableSlotLevels(
			r.level,
			this.sheet?.spellcasting.pools ?? [],
			this.character?.play.spellSlotsSpent ?? {}
		);

	/** The spell whose upcast slot-picker is open (drives the `upcast` overlay menu — item 1). */
	upcastSpell = $state<SpellRow | null>(null);
	/** Open the slot-picker for a leveled spell (the ⇡ affordance), anchored under the click. */
	openUpcast = (r: SpellRow, e: Event) => {
		this.upcastSpell = r;
		this.openMenu('upcast', e);
	};
	/** Cast the picker's spell at the chosen slot, then close the picker. */
	castAtSlot = (slot: number, e: Event) => {
		const r = this.upcastSpell;
		if (!r) return;
		this.overlay = null;
		this.cast(r, e, { slot });
	};
	/** A short human summary of what casting `r` from `slotLevel` yields BEYOND its base — the extra
	 *  damage/heal dice, the scaled count / area / duration / HP-max (items 1 + 8). Empty at the base
	 *  slot or a non-scaling spell. Area shows metric next to imperial (H10); the real count-roll is the
	 *  roller (deferred), so count is a display total for now. */
	castPreview = (r: SpellRow, slotLevel: number): string => {
		const bits: string[] = [];
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res) continue;
			if (res.kind === 'damage' || res.kind === 'heal') {
				if (Object.keys(res.pool).length === 0 && res.flat === 0) continue;
				bits.push(
					`+${formatDamageParts([{ pool: res.pool, mod: res.flat, type: res.type ?? '' }])}`
				);
			} else if (res.kind === 'count') bits.push(`${res.flat}×`);
			else if (res.kind === 'area') bits.push(`area ${res.flat} ft (${metres(res.flat)})`);
			else if (res.kind === 'hp_max' && res.flat) bits.push(`+${res.flat} HP max`);
			else if (res.kind === 'temp_hp' && res.flat) bits.push(`+${res.flat} temp HP`);
			else if (res.kind === 'duration') bits.push(res.isInfinite ? 'permanent' : `${res.flat} rds`);
		}
		return bits.join(' · ');
	};

	// casting a spell: damage/healing spells roll their dice; attack spells roll to hit. `opts.slot`
	// overrides the auto-lowest slot (the upcast picker, §6) — honoured or blocked, never downshifted.
	cast = (r: SpellRow, e: Event, opts?: { ritual?: boolean; slot?: number }) => {
		const play = this.character?.play;
		// A17: casting SPENDS a leveled spell slot and is BLOCKED when none remain — UNLESS it's a
		// RITUAL cast (rituals cost no slot; only ritual-tagged spells qualify — SRD). Cantrips + pure
		// pact casters spend nothing; the action-economy check below stays combat-only.
		const ritual =
			opts?.ritual === true && r.ritual && (this.sheet?.spellcasting.ritualCasting ?? false);
		const slot = this.reserveSpellSlot(r, ritual, opts?.slot);
		if (slot === 'blocked') return;
		// a spell costs its casting-time slot (action / bonus / reaction) when tracking combat
		if (!this.economy.trySpend(this.economy.ctSlot(r.castTimeIcon))) return;
		if (slot && play) play.spellSlotsSpent[slot] = (play.spellSlotsSpent[slot] ?? 0) + 1;
		// the slot LEVEL the spell is actually cast from drives upcast (§4). No leveled slot spent
		// (cantrip / ritual / free / pure-pact) → cast at the base level, delta 0 (N7).
		const slotLevel = slot != null ? Number(slot) : r.level;
		// a concentration spell becomes the active concentration (replacing any prior one, 5e rule);
		// the PRIOR concentration's cast-applied effect goes down with it
		if (r.concentration && this.character) {
			const prior = this.character.play.concentration;
			if (prior && prior !== r.ref) this.removeLinkedEffect(prior);
			this.character.play.concentration = r.ref;
		}
		this.applySpellEffect(r, slotLevel);
		this.rollSpellCast(r, e, ritual, slotLevel);
		this.remindCountScaling(r, slotLevel);
	};

	/** A cantrip that scales by COUNT (Eldritch Blast's beams) fires N separate rolls at higher levels.
	 *  The per-instance roller is deferred (D14), so casting rolls ONE instance and surfaces the count as
	 *  a reminder to roll the rest — never a silently-wrong single big die (item 9). Leveled count spells
	 *  surface their total through the slot-picker preview instead, so this is cantrip-only. */
	private remindCountScaling(r: SpellRow, slotLevel: number): void {
		if (r.level !== 0) return;
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res || res.kind !== 'count') continue;
			if (res.flat > 1)
				toast(`${r.name} — ${res.flat}×: make ${res.flat} separate rolls at this level`);
		}
	}

	// tap a spell's prep dot to prepare/unprepare it (always-prepared can't be unset)
	togglePrepared = (r: SpellRow) => {
		if (!this.character) return;
		// SMELL-4: match by the ref's parsed id segment, not a string suffix — self-evident and stable
		// if the `type:source:id` ref format ever changes. (`s.spell` is a full ref; `r.id` is the id.)
		const idOf = (ref: string) => ref.split(':').pop();
		const sp = this.character.build.spells.find((s) => idOf(s.spell) === r.id);
		// A18-tail: per-class cap gate via the ONE shared seam (identical in the spellbook, D13)
		const res = canTogglePreparedFor({
			spells: this.character.build.spells,
			sheet: this.sheet,
			entry: sp,
			spellRef: r.ref,
			isCantrip: r.levelTag === 'cantrip'
		});
		if (!res.ok) {
			if (res.message) toast(res.message);
			return;
		}
		if (sp) sp.prepared = !sp.prepared;
	};

	// attacks (equipped weapons + Unarmed Strike) — pure builder in helpers
	attacks = $derived.by<Attack[]>(() =>
		this.character && this.sheet && this.graph
			? computeAttacks(this.character, this.sheet, this.graph)
			: []
	);

	// standard actions (from d-charnik); roll ones reference live skills — pure builder in helpers
	actions = $derived.by<StandardAction[]>(() =>
		standardActions(this.sheet, this.character?.system ?? '5.5e')
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
	/** Set the exhaustion level, clamped to [0, max]. Play-state mutation (autosaves like HP). */
	setExhaustion = (level: number): void => {
		const p = this.character?.play;
		if (!p) return;
		p.exhaustion = Math.max(0, Math.min(this.exhaustionMax, Math.round(level)));
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
