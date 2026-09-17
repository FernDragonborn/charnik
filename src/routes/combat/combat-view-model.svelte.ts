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
import { t, translator } from '$lib/i18n';
import { app } from '$lib/stores/app.svelte';
import { ensureActiveCharacter, saveCharacterGuarded } from '$lib/character/store.svelte';
import { content, loadContentStore } from '$lib/content/store.svelte';
import { deriveSheet, type CharacterSheet, type SkillId } from '$lib/character/derive';
import { localizedName } from '$lib/content/detail';
import { plugins } from '$lib/effects/plugin-store.svelte';
import { DEFAULT_SYSTEM } from '$lib/rules/pipeline';
import type { Character, ShortRestMode } from '$lib/character/schema';
import { characterFeatures } from '$lib/character/features';
import {
	GROUP_MODES,
	type GroupMode,
	computeAttacks,
	standardActions,
	buildSpellGroups,
	preparedTalliesByClass,
	modTargetLabel,
	skillRollTarget,
	type Attack,
	type StandardAction,
} from '$lib/combat/helpers';
import { RollJournal } from './roll-journal.svelte';
import {
	appendLog,
	reviseLog,
	readLog,
	logLineFor,
	snapshotCharacterOnLaunch,
} from '$lib/character/repository';
import { getUserStorage } from '$lib/storage/provider';
import { rehydrateLogEntry } from '$lib/combat/roll';
import type { RollLogEntry } from '$lib/combat/helpers';
import { openDiceTray } from '$lib/dice/tray.svelte';
import { isRowActive } from '$lib/content/sources.svelte';
import { EffectsEditor } from './effects-editor.svelte';
import { SheetRolls } from './sheet-rolls.svelte';
import { ActionExecutor } from './action-executor.svelte';
import { PanelLayout } from './panel-layout.svelte';
import { SpellCasting } from './spell-casting.svelte';
import { TurnEconomy } from './turn-economy.svelte';
import { ResourceTracker } from './resource-tracker.svelte';
import { MenuOverlay, type OpenOverlay } from './menu-overlay.svelte';
import { RestControls } from './rest-controls.svelte';
import { HitPoints } from './hit-points.svelte';
import { InventoryTracker } from './inventory.svelte';

/** The passive-senses row's default skills when the character hasn't customized it (ui.passiveSkills). */
const DEFAULT_PASSIVE_SKILLS: SkillId[] = ['perception', 'investigation', 'insight'];

/**
 * D1 — under the 400-line lint since the menus, the short rest and HP+death moved to subsystems
 * beside it. What is left is the character (load, sheet, level-up), the display derivations the
 * panels read, concentration's lifecycle, and one accessor per moved name.
 *
 * **The accessors are the point, not clutter.** `hpMax` and `die` are declared on two sibling
 * subsystems' host interfaces, five panels destructure `openMenu`, the markup two-way binds
 * `tempHpInput`, and the behavioural tests drive every one of them from `combat.*`. Moving an
 * implementation is no reason to move the name people call (§6.1) — so each carve leaves a
 * one-line forward here and nothing above this file has to know it happened.
 *
 * A subsystem reads back through a `() => this` host thunk. A `$derived` field CANNOT use it: field
 * initialisers run before the constructor assigns `host`, so anything reading the host is a getter.
 * That is why `hitDice`, `hpBar` and `damageTypeOptions` are getters and not `$derived` — they were
 * `$derived` here, where `this` was already whole.
 *
 * Every carve ends with `shot.mjs`: a bound scalar moves fine, but only if its binding is retargeted
 * with it (`bind:value={combat.effects.newEffectDuration}`), and unit tests do not cover that seam.
 */

class CombatVM {
	/** The roll RECORD: the log, its revisions, and the dice tray a roll is built in. Each completed
	 *  roll is also persisted to the active character's `log.jsonl` (B4). */
	journal = new RollJournal(
		(e) => this.persistRoll(e),
		(e) => this.persistRevision(e),
	);
	/** Panel-layout subsystem (columns, collapse, drag) — persists column order onto the character. */
	layout = new PanelLayout(
		(cols) => {
			if (this.character) this.character.ui.panelColumns = cols;
		},
		() => this.character?.ui.rowOrder,
	);
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
	/** HP, damage/healing and death — see hit-points.svelte.ts. */
	hp = new HitPoints(() => this);
	/** What is carried, and the play-time verbs on it (equip, attune, qty, use) — N1. */
	inventory = new InventoryTracker(
		() => this.character,
		() => this.graph,
		() => this.sheet,
	);
	/* The HP verbs stay ON the view-model: `hpMax` and `die` are declared on two sibling subsystems'
	   host interfaces, the panels bind `tempHpInput`/`hpAmount`, and the behavioural tests drive all
	   of them from here (§6.1). */
	get hpMax(): number {
		return this.hp.hpMax;
	}
	get hpBar() {
		return this.hp.hpBar;
	}
	get hpAmount(): number {
		return this.hp.hpAmount;
	}
	set hpAmount(v: number) {
		this.hp.hpAmount = v;
	}
	get tempHpInput(): number {
		return this.hp.tempHpInput;
	}
	set tempHpInput(v: number) {
		this.hp.tempHpInput = v;
	}
	get damageType(): string | null {
		return this.hp.damageType;
	}
	set damageType(v: string | null) {
		this.hp.damageType = v;
	}
	get damageTypeOptions(): string[] {
		return this.hp.damageTypeOptions;
	}
	get concentrationSaveMod(): number {
		return this.hp.concentrationSaveMod;
	}
	get pendingConcentrationSave() {
		return this.hp.pendingConcentrationSave;
	}
	set pendingConcentrationSave(v) {
		this.hp.pendingConcentrationSave = v;
	}
	damage = () => this.hp.damage();
	heal = () => this.hp.heal();
	setTempHp = () => this.hp.setTempHp();
	clampCurrentHp = () => this.hp.clampCurrentHp();
	syncDyingState = () => this.hp.syncDyingState();
	syncPendingConcentration = () => this.hp.syncPendingConcentration();
	rollConcentrationSave = () => this.hp.rollConcentrationSave();
	dropConcentrationFromSave = () => this.hp.dropConcentrationFromSave();
	dismissConcentrationSave = () => this.hp.dismissConcentrationSave();
	deathSave = () => this.hp.deathSave();
	toggleDeathSave = (...a: Parameters<HitPoints['toggleDeathSave']>) =>
		this.hp.toggleDeathSave(...a);
	die = (...a: Parameters<HitPoints['die']>) => this.hp.die(...a);
	revive = () => this.hp.revive();
	/** The short-rest popover + Hit-Dice spending — see rest-controls.svelte.ts. */
	rests = new RestControls(() => this);
	/* The rest verbs stay ON the view-model: the Controls bar, the popover markup and the
	   behavioural tests are all written against these names (§6.1). */
	get hitDice() {
		return this.rests.hitDice;
	}
	get hdPick(): Record<string, number> {
		return this.rests.hdPick;
	}
	set hdPick(v: Record<string, number>) {
		this.rests.hdPick = v;
	}
	get hdPickCount(): number {
		return this.rests.hdPickCount;
	}
	get shortRestMode(): ShortRestMode {
		return this.rests.shortRestMode;
	}
	hdPickInc = (...a: Parameters<RestControls['hdPickInc']>) => this.rests.hdPickInc(...a);
	spendHitDie = (...a: Parameters<RestControls['spendHitDie']>) => this.rests.spendHitDie(...a);
	startShortRest = (...a: Parameters<RestControls['startShortRest']>) =>
		this.rests.startShortRest(...a);
	commitShortRest = () => this.rests.commitShortRest();
	/** Menus + the dice-tray seam (where a dropdown opens) — see menu-overlay.svelte.ts. */
	menus = new MenuOverlay(() => this);
	/* The menu verbs stay ON the view-model: five panels destructure `openMenu` off it, and both
	   sibling subsystems declare it on their host interface (§6.1). */
	get overlay(): OpenOverlay | null {
		return this.menus.overlay;
	}
	set overlay(v: OpenOverlay | null) {
		this.menus.overlay = v;
	}
	openMenu = (...a: Parameters<MenuOverlay['openMenu']>) => this.menus.openMenu(...a);
	openMenuCentered = (...a: Parameters<MenuOverlay['openMenuCentered']>) =>
		this.menus.openMenuCentered(...a);
	openDice = (...a: Parameters<MenuOverlay['openDice']>) => this.menus.openDice(...a);
	registerTray = () => this.menus.registerTray();
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
	/** What the dice tray hands its completed rolls to — the log, plus the weapon-attack reroll offer. */
	recordTrayRolls = (...a: Parameters<SheetRolls['recordTrayRolls']>) =>
		this.rolls.recordTrayRolls(...a);
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
	/** Pools that come back at dawn / at dusk — each gates its own control in the time bar, so a
	 *  character with no such pool never sees a button that would do nothing. The STEPS are not gated
	 *  the same way: passing time always advances the round counter and always expires whatever is
	 *  ticking, so the control is never a no-op — and a bar that appeared and vanished as buffs came
	 *  and went was a control the player could not ask for when they wanted it. */
	hasDawnPool = $derived(this.resources.hasBoundaryPool('dawn'));
	hasDuskPool = $derived(this.resources.hasBoundaryPool('dusk'));
	// D3: pins persist per character in ui.spellsPinned, keyed by the spell's REF the way
	// `spellsHidden` is — a bare id pinned every same-id spell from every pack at once, and the eye one
	// row over disagreed about what a spell is. Exposed as a boolean map for the panel's lookup;
	// toggle via togglePin so the array stays the source.
	pinned = $derived<Record<string, boolean>>(
		Object.fromEntries((this.character?.ui.spellsPinned ?? []).map((ref) => [ref, true])),
	);
	togglePin = (ref: string) => {
		const ui = this.character?.ui;
		if (!ui) return;
		const cur = ui.spellsPinned ?? [];
		ui.spellsPinned = cur.includes(ref) ? cur.filter((x) => x !== ref) : [...cur, ref];
	};
	hiddenActions = $state<Record<string, boolean>>({});
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
		// a line written since the record was unified carries the WHOLE roll; an older one carries only
		// the flattened summary, which is all there ever was in it. Either way
		// it goes through `rehydrateRoll`, which fills the per-die record from the rendered `expr` when
		// the line predates it — the one place the legacy string is still read.
		this.journal.seed(
			hist.map((le) =>
				rehydrateLogEntry(
					le.roll ?? { label: le.label, expr: le.detail ?? '', total: le.result ?? NaN, at: le.t },
				),
			),
		);
	};

	/** Persist one completed roll to the active character's `log.jsonl` (B4). Fire-and-forget: a log
	 *  write must never block or fail a roll. */
	private persistRoll = (e: RollLogEntry): void => {
		const id = this.character?.id;
		if (!id) return;
		void appendLog(getUserStorage(), id, logLineFor(e));
	};

	/** An amendment rewrites the line its roll already wrote — same roll, decided differently. */
	private persistRevision = (e: RollLogEntry): void => {
		const id = this.character?.id;
		if (!id) return;
		void reviseLog(getUserStorage(), id, logLineFor(e));
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
			`${this.customModSign}${amount} ${modTargetLabel(this.customModTarget, translator())}`;
		this.effects.addEffect({ label, tokens: [token], positive: this.customModSign === '+' });
		this.customEffectLabel = '';
		this.customModAmount = 1;
	};

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

	/** The N2 action executor — spend-options, action verbs, and the two event boundaries. */
	executor = new ActionExecutor(() => this);
	/* These stay ON the view-model — SHEET verbs, not a subsystem's API; panels and tests call them. */
	activateResourceOption = (...args: Parameters<ActionExecutor['activateResourceOption']>) =>
		this.executor.activateResourceOption(...args);
	useResourceOrEnter = (...args: Parameters<ActionExecutor['useResourceOrEnter']>) =>
		this.executor.useResourceOrEnter(...args);
	toggleCombat = () => this.executor.toggleCombat();
	nextTurn = () => this.executor.nextTurn();
	/** The catalog KEY for how the spell list is grouped — the panel header words it. */
	groupByLabel = $derived(`combat.spells.groupBy.${this.spellGroupBy}`);
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
				return row ? `${localizedName(row, app.activeLocale)} ${c.level}` : `Level ${c.level}`;
			})
			.join(' / ');
	});
	speciesName = $derived.by(() => {
		const row = this.character?.build.species
			? this.graph?.get(this.character.build.species)
			: undefined;
		return row ? localizedName(row, app.activeLocale) : '';
	});
	/** The spell currently concentrated on (resolved to a display label), or null. Reads the schema's
	 *  `play.concentration` ref — set on cast, cleared by tapping the indicator. */
	conc = $derived.by<{ ref: string; label: string } | null>(() => {
		const ref = this.character?.play.concentration;
		if (!ref) return null;
		const row = this.graph?.get(ref);
		return { ref, label: row ? localizedName(row, app.activeLocale) : ref };
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

	/** What this character HAS, to read — the Features panel's whole model. Not derived from the
	 *  sheet's effect list: a feature made purely of prose carries no effect tokens and never reaches
	 *  it (`character/features.ts`). */
	features = $derived.by(() => {
		const c = this.character;
		return c && this.graph ? characterFeatures(c, this.graph) : [];
	});

	// configurable passive-sense skills (Pin skills)
	passives = $derived.by(() => {
		const sheet = this.sheet;
		if (!sheet) return [];
		// the KEY only — the word for a skill is `skillName.<id>`, and a view-model has no locale to
		// spend on it (docs/internals/ui.md ▸ Strings live in the catalogs)
		return this.passiveSkills.map((k) => ({
			key: k,
			comp: sheet.passives[k], // effect-adjusted (adv/dis ±5, passive.<skill>), not bare 10+mod
		}));
	});
	togglePassive = (k: SkillId) => {
		const c = this.character;
		if (!c) return;
		const cur = this.passiveSkills;
		c.ui.passiveSkills = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
		void saveCharacterGuarded(c);
	};

	// --- level-up: advance an existing character's class by one level ---------------------------
	/** Total character level across all classes. */
	totalLevel = $derived(this.character?.build.classes.reduce((n, c) => n + c.level, 0) ?? 0);
	/** Can still gain a level (hard cap 20 total). */
	canLevelUp = $derived(this.totalLevel < 20 && (this.character?.build.classes.length ?? 0) > 0);
	/** A ref's display name in the active locale, or `fallback` when the row is gone. The sheet reads a
	 *  content name the way every other surface does (F9) — printing `name_en` made the same dagger two
	 *  different words on one screen. */
	private nameOf(ref: string, fallback: string): string {
		const row = this.graph?.get(ref);
		return row ? localizedName(row, app.activeLocale) : fallback;
	}
	/** The character's classes with their live names, for the level-up menu. */
	levelUpClasses = $derived.by(() =>
		(this.character?.build.classes ?? []).map((c, i) => ({
			index: i,
			level: c.level,
			name: this.nameOf(c.class, 'Class'),
		})),
	);
	/** Click a standard action (Dash, Hide, …). Spends an action; roll-type ones open their roll,
	 *  no-roll ones just consume the slot. The "Attack" row is a pointer to the Attacks panel. */
	actionClick = (a: StandardAction, e: Event) => {
		if (a.id === 'attack') return; // routes to the Attacks panel; not itself an action spend
		if (!this.economy.trySpend('action')) return;
		// the roll's NAME is a key: a standard action is a closed rules vocabulary, so its check reads
		// in the language the log is READ in rather than the one it was made in. Its TARGET is the skill
		// it checks — Hide is a Stealth check, and it must roll the way the skills panel's Stealth row
		// does or the same check rolls two ways depending on which panel you tapped.
		if (a.roll)
			this.rolls.roll(
				{ text: t(a.roll[0]), key: a.roll[0] },
				a.roll[1],
				e,
				a.skill ? skillRollTarget(a.skill, this.sheet) : undefined,
			);
		else toast(t('combat.notice.actionUsed', { name: t(a.nameKey) }));
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
	upcastLadder = (...args: Parameters<SpellCasting['upcastLadder']>) =>
		this.casting.upcastLadder(...args);
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
			? computeAttacks(this.character, this.sheet, this.graph, app.activeLocale)
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
					locale: app.activeLocale,
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

	// conditions for THIS character's system (not a hardcoded edition). Carries the row `id` (not just
	// the label) so applying one emits `apply_condition:<id>` — the DAG then expands the condition
	// row's own `effects` tokens and registers the id in facts.conditions (what the economy + guards
	/** Effects & conditions (catalog, durations, exhaustion) — see effects.svelte.ts. */
	effects = new EffectsEditor(() => this);
}

/** The single shared Combat view-model instance. */
export const combat = new CombatVM();
