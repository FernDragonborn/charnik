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
import { tokensOf } from '$lib/content/loader';
import { rollPool, type DieMods } from '$lib/rules/dice';
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
	parseDamage,
	modTargetLabel,
	applyDefense,
	type Atk,
	type SpRow,
	type MenuKind,
	type StandardAction
} from '$lib/combat/helpers';
import { RollTray } from './roll.svelte';
import { PanelLayout } from './panel.svelte';
import { TurnEconomy } from './economy.svelte';
import { ResourceTracker } from './resources.svelte';
import { slotToSpend, canTogglePrepared, preparedLeveledCount } from '$lib/rules/spellcasting';

class CombatVM {
	/** Dice-roll subsystem (tray state + log + roll execution) — see roll.svelte.ts. */
	tray = new RollTray();
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
		return this.character && this.graph ? deriveSheet(this.character, this.graph) : null;
	});

	// play / UI state. The round counter is the PERSISTED one (play.round) — no separate VM copy to
	// drift; entering combat sets it to 1, Next turn advances it, and effect expiry reads it.
	get round(): number {
		return this.character?.play.round ?? 0;
	}
	pinned = $state<Record<string, boolean>>({ 'fire-bolt': true, shield: true });
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
	passiveSkills = $state<SkillId[]>(['perception', 'investigation', 'insight']);

	load = async () => {
		await loadContentStore(); // populate the shared graph; `this.graph` derives from it
		// the character opened from the Roster, else the persisted demo (same instance the Spellbook edits)
		this.character = await ensureActiveCharacter();
		// restore this character's saved panel layout (falls back to the default columns)
		this.layout.restore(this.character.ui.panelColumns);
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
	cmTarget = $state('ac');
	cmSign = $state<'+' | '-'>('+');
	cmAmount = $state(1);
	addCustomModifier = () => {
		const amount = Math.abs(Math.round(this.cmAmount)) || 1;
		const token = `flat_bonus:${this.cmTarget}${this.cmSign}${amount}`;
		const label =
			this.customEffectLabel.trim() || `${this.cmSign}${amount} ${modTargetLabel(this.cmTarget)}`;
		this.addEffect(label, [token], this.cmSign === '+');
		this.customEffectLabel = '';
		this.cmAmount = 1;
	};

	openDice = (e: Event) => {
		this.tray.reset();
		this.openMenu('dice', e);
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
		return this.character?.play.hp.max ?? this.sheet?.maxHp.value ?? 0;
	}
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
		let n = applyDefense(raw, this.damageType, defenses).final;
		const soaked = Math.min(p.hp.temp, n); // temp HP absorbs first (5e rule)
		p.hp.temp -= soaked;
		n -= soaked;
		p.hp.current = Math.max(0, p.hp.current - n);
	};
	heal = () => {
		const p = this.character?.play;
		if (!p) return;
		p.hp.current = Math.min(this.hpMax, p.hp.current + Math.max(0, Math.round(this.hpAmount)));
	};

	groupByLabel = $derived(
		{ level: 'By level', prepared: 'Prepared', school: 'By school' }[this.spellGroupBy]
	);
	cycleGroupBy = () =>
		(this.spellGroupBy =
			GROUP_MODES[(GROUP_MODES.indexOf(this.spellGroupBy) + 1) % GROUP_MODES.length] ?? 'level');

	className = $derived.by(() => {
		if (!this.character || !this.graph) return '';
		const c = this.character.build.classes[0];
		if (!c) return `Level ${this.sheet?.level ?? ''}`;
		const row = this.graph.get(c.class);
		return row ? `${row.data.name_en} ${c.level}` : `Level ${this.sheet?.level ?? ''}`;
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
		this.passiveSkills = this.passiveSkills.includes(k)
			? this.passiveSkills.filter((x) => x !== k)
			: [...this.passiveSkills, k];
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
	private effectsFor(key: string): RollEffects {
		const c = this.character;
		if (!c || !c.play.autoCalc || !this.sheet) return NO_ROLL_EFFECTS; // effects-auto off → plain rolls
		return rollEffectsFor(this.sheet.facts, key);
	}

	/** A forced outcome (paralyzed → auto-fail STR/DEX saves) for a roll key, or null. Gated on the
	 *  same effects-auto toggle as `effectsFor`, so turning auto off restores plain rolls. */
	private autoOutcomeFor(key: string): 'fail' | 'succeed' | null {
		const c = this.character;
		if (!c || !c.play.autoCalc || !this.sheet) return null;
		return autoOutcome(this.sheet.facts, key);
	}

	// open the roll builder prefilled + anchored, so the player can pick advantage then Roll
	openRoll = (
		label: string,
		diceObj: Record<number, number>,
		mod: number,
		e: Event,
		advantage = 0,
		mods: DieMods = {}
	) => {
		this.tray.prefill(label, diceObj, mod, advantage, mods);
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
		if (wantsTray(e)) this.openRoll(label, { 20: 1 }, mod, e, adv, fx ?? {});
		else this.tray.rollDiceNow(label, { 20: 1 }, mod, adv, fx?.bonusDice ?? [], fx ?? {});
	};

	/** Roll a death save (shown while at 0 HP): a d20 vs 10 — `save.death`-targeted effects (and
	 *  the `saves`/`d20_tests` groups: Bless, exhaustion) apply. Outcomes per RAW: nat 20 → back up
	 *  at 1 HP; nat 1 → two failures; 10+ → success; three successes → stable (counters reset). */
	deathSave = (e: Event) => {
		const c = this.character;
		if (!c) return;
		const fx = this.effectsFor('save.death');
		if (wantsTray(e)) {
			this.openRoll('Death save', { 20: 1 }, fx.flat, e, netAdvantage(fx), fx);
			return;
		}
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
	attackRoll = (at: Atk, e: Event) => {
		if (!this.economy.trySpend('action')) return;
		const { pool, mod } = parseDamage(at.dmg);
		const hasDice = Object.keys(pool).length > 0;
		const fx = this.effectsFor('attack');
		const dmgFx = this.effectsFor('damage');
		if (wantsTray(e)) {
			// tray on the TO-HIT (pick advantage), then Roll fires the damage as one combined entry
			this.openRoll(at.name, { 20: 1 }, at.toHit + fx.flat, e, netAdvantage(fx), fx);
			if (hasDice) this.tray.queueDamage(`${at.name} damage`, pool, mod + dmgFx.flat, dmgFx);
			return;
		}
		// instant: to-hit (with effect advantage/flat/dice) + damage → one 3-line entry
		const toHit = rollPool({ 20: 1 }, at.toHit + fx.flat, netAdvantage(fx), fx.bonusDice, fx);
		this.tray.pushRoll(
			at.name,
			toHit,
			hasDice ? rollPool(pool, mod + dmgFx.flat, 0, dmgFx.bonusDice, dmgFx) : undefined
		);
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
	private applySpellEffect(r: SpRow) {
		const c = this.character;
		const spell = this.graph?.get(r.ref);
		const tokens = tokensOf(spell);
		if (!c || !tokens.length) return;
		this.removeLinkedEffect(r.ref); // re-cast refreshes instead of stacking a duplicate
		const rounds = spell?.type === 'spell' ? durationToRounds(String(spell.data.duration)) : null;
		c.play.effects = [
			...c.play.effects,
			{
				iid: crypto.randomUUID(),
				label: r.name,
				source: r.ref,
				effects: tokens,
				positive: true,
				...(rounds ? { durationRounds: rounds, startedRound: this.round } : {})
			}
		];
	}

	// casting a spell: damage/healing spells roll their dice; attack spells roll to hit
	cast = (r: SpRow, e: Event, opts?: { ritual?: boolean }) => {
		const play = this.character?.play;
		// A17: casting SPENDS a leveled spell slot and is BLOCKED when none remain — UNLESS it's a
		// RITUAL cast (rituals cost no slot; only ritual-tagged spells qualify — SRD). A slot is a
		// resource like HP, so this holds in AND out of combat (independent of the action-economy
		// check below, which stays combat-only). Cantrips + pure pact casters spend nothing
		// (slotToSpend → null). Reserve first so a block returns BEFORE the action economy is touched;
		// commit only once both the slot and the action pass.
		const ritual =
			opts?.ritual === true && r.ritual && (this.sheet?.spellcasting.ritualCasting ?? false);
		let slotKey: string | undefined;
		if (!ritual && play) {
			const spend = slotToSpend(
				r.level,
				this.sheet?.spellcasting.pools ?? [],
				play.spellSlotsSpent
			);
			if (spend && 'block' in spend) {
				toast(spend.block);
				return;
			}
			if (spend && 'key' in spend) slotKey = spend.key;
		}
		// a spell costs its casting-time slot (action / bonus / reaction) when tracking combat
		if (!this.economy.trySpend(this.economy.ctSlot(r.ct))) return;
		if (slotKey && play) play.spellSlotsSpent[slotKey] = (play.spellSlotsSpent[slotKey] ?? 0) + 1;
		// a concentration spell becomes the active concentration (replacing any prior one, 5e rule);
		// the PRIOR concentration's cast-applied effect goes down with it
		if (r.conc && this.character) {
			const prior = this.character.play.concentration;
			if (prior && prior !== r.ref) this.removeLinkedEffect(prior);
			this.character.play.concentration = r.ref;
		}
		this.applySpellEffect(r);
		const alt = wantsTray(e);
		// a spell with dice rolls them: damage (Fire Bolt 1d10, Fireball 8d6) or, for auto
		// spells, healing (Healing Word 2d4 + spellcasting mod)
		const caster = this.sheet?.spellcasting.classes[0];
		const hasDmg = !!r.dmg && Object.keys(r.dmg).length > 0;
		if (r.res === 'hit' && caster) {
			// attack spell → roll the TO-HIT first (attack-keyed effects apply, same as weapons),
			// then its damage (if any, with damage-keyed effects). Previously a damage-dealing attack
			// spell (Fire Bolt) rolled only damage and skipped the to-hit entirely.
			const fx = this.effectsFor('attack');
			const dmgFx = this.effectsFor('damage');
			const toHit = caster.attack.value + fx.flat;
			if (alt) {
				// tray on the TO-HIT (the spell attack roll); Roll then fires the damage after
				this.openRoll(`${r.name} (spell attack)`, { 20: 1 }, toHit, e, netAdvantage(fx), fx);
				if (hasDmg)
					this.tray.queueDamage(`${r.name} damage`, { ...(r.dmg ?? {}) }, dmgFx.flat, dmgFx);
			} else {
				// instant: to-hit + damage → one combined 3-line entry
				this.tray.pushRoll(
					`${r.name} (spell attack)`,
					rollPool({ 20: 1 }, toHit, netAdvantage(fx), fx.bonusDice, fx),
					hasDmg ? rollPool(r.dmg ?? {}, dmgFx.flat, 0, dmgFx.bonusDice, dmgFx) : undefined
				);
			}
		} else if (hasDmg) {
			// save / auto spell: damage, or (auto) healing with the spellcasting mod
			const heal = r.res === 'auto';
			const label = `${r.name} ${heal ? 'healing' : 'damage'}`;
			const mod = heal && caster ? (this.sheet?.abilities[caster.ability]?.mod ?? 0) : 0;
			if (alt) this.openRoll(label, r.dmg ?? {}, mod, e);
			else this.tray.rollDiceNow(label, r.dmg ?? {}, mod);
		} else {
			// a cast with no roll (buff/utility): a bare log marker, not a rolled total
			const suffix = ritual ? ' (ritual)' : '';
			this.tray.logMarker(`Cast ${r.name}${suffix}`);
			toast(`Cast ${r.name}${suffix}`);
		}
	};

	// tap a spell's prep dot to prepare/unprepare it (always-prepared can't be unset)
	togglePrepared = (r: SpRow) => {
		if (!this.character) return;
		const sp = this.character.build.spells.find((s) => s.spell.endsWith(`:${r.id}`));
		const res = canTogglePrepared(sp, r.tm === 'cantrip', this.preparedCap, this.preparedCount);
		if (!res.ok) {
			if (res.message) toast(res.message);
			return;
		}
		if (sp) sp.prepared = !sp.prepared;
	};

	// attacks (equipped weapons + Unarmed Strike) — pure builder in helpers
	attacks = $derived.by<Atk[]>(() =>
		this.character && this.sheet && this.graph
			? computeAttacks(this.character, this.sheet, this.graph)
			: []
	);

	// standard actions (from d-charnik); roll ones reference live skills — pure builder in helpers
	actions = $derived.by<StandardAction[]>(() => standardActions(this.sheet));
	visibleActions = $derived(this.actions.filter((a) => !this.hiddenActions[a.id]));

	spellGroups = $derived.by(() =>
		this.character && this.graph
			? buildSpellGroups(
					this.character,
					this.sheet,
					this.graph,
					this.spellGroupBy,
					this.pinned,
					this.character.ui.spellsHidden
				)
			: []
	);
	preparedCount = $derived(preparedLeveledCount(this.character?.build.spells ?? []));
	// prepared cap from the primary caster's derived profile (class table / formula), not hardcoded
	preparedCap = $derived(this.sheet?.spellcasting.classes[0]?.preparedCap ?? 0);

	hpBar = $derived.by(() => {
		if (!this.character || !this.sheet) return { cur: 0, tmp: 0 };
		// `|| 1` guards a 0 max (unset HP) so the bar math can't divide → NaN/Infinity (D19)
		const max = (this.character.play.hp.max ?? this.sheet.maxHp.value) || 1;
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
		return this.graph
			.list('condition', { system })
			.map((r) => ({ id: r.id, label: String(r.data.name_en) }));
	});
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
			label: String(r.data.name_en),
			tokens: r.data.effects,
			negative: r.data.negative,
			durationRounds: r.data.duration_rounds ?? null
		}));
	});
	/** Duration (in rounds) applied to the NEXT effect added from the add-effect / custom menus.
	 *  0 = indefinite (lasts until the player removes it). Editable in the add-effect menu. */
	newEffectDuration = $state(10);
	addEffect = (
		label: string,
		tokens: string[],
		positive = true,
		durationRounds = this.newEffectDuration
	) => {
		if (!this.character) return;
		// 0 / negative → indefinite: omit the duration fields entirely (schema: absent = until removed)
		const duration =
			durationRounds > 0
				? { durationRounds: Math.round(durationRounds), startedRound: this.round }
				: {};
		this.character.play.effects = [
			...this.character.play.effects,
			{ iid: crypto.randomUUID(), label, effects: tokens, positive, ...duration }
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
