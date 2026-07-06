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
import { characters, saveCharacterToStore } from '$lib/character/store.svelte';
import { getContentGraph } from '$lib/content/provider';
import { deriveSheet, type CharacterSheet, type SkillId } from '$lib/character/derive';
import { passiveScore } from '$lib/rules/core';
import { rollPool, type BonusDie } from '$lib/rules/dice';
import { parseEffect, EFFECT_KIND } from '$lib/effects/index';
import type { ContentGraph } from '$lib/content/loader';
import type { Character } from '$lib/character/schema';
import {
	titleCase,
	wantsTray,
	pipClick,
	GROUP_MODES,
	type GroupMode,
	rollEffectsFor,
	computeAttacks,
	standardActions,
	buildSpellGroups,
	parseDamage,
	modTargetLabel,
	type Atk,
	type SpRow,
	type ActionSlot,
	type MenuKind,
	type StandardAction
} from '$lib/combat/helpers';
import { RollTray } from './roll.svelte';
import { PanelLayout } from './panel.svelte';

class CombatVM {
	/** Dice-roll subsystem (tray state + log + roll execution) — see roll.svelte.ts. */
	tray = new RollTray();
	/** Panel-layout subsystem (columns, collapse, drag) — persists column order onto the character. */
	layout = new PanelLayout((cols) => {
		if (this.character) this.character.ui.panelColumns = cols;
	});
	graph = $state<ContentGraph | null>(null);
	character = $state<Character | null>(null);
	/** Fully reactive: recomputes whenever the character (HP, effects, shield, auto-calc…) or the
	 *  content graph changes — so every play-state edit reflects live in the derived stats. */
	sheet = $derived.by<CharacterSheet | null>(() =>
		this.character && this.graph ? deriveSheet(this.character, this.graph) : null
	);

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
		this.graph = await getContentGraph();
		// the character opened from the Roster, else the seeded demo
		this.character = characters.active ?? demoCharacter();
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
	// flat-bonus token the effects engine already applies (now live, via the reactive sheet).
	cmTarget = $state('ac');
	cmSign = $state<'+' | '-'>('+');
	cmAmount = $state(1);
	addCustomModifier = () => {
		const amount = Math.abs(Math.round(this.cmAmount)) || 1;
		const token = `flat-bonus:${this.cmTarget}${this.cmSign}${amount}`;
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
	private get hpMax(): number {
		return this.character?.play.hp.max ?? this.sheet?.maxHp.value ?? 0;
	}
	damage = () => {
		const p = this.character?.play;
		if (!p) return;
		let n = Math.max(0, Math.round(this.hpAmount));
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

	// --- Action economy: base 1 pip per slot + extras from effects; move tracks feet -------------
	// A feature/spell grants an extra action/bonus/reaction via a `flat-bonus:<slot>+N` token
	// (Action Surge → +1 action, Haste → +1 action), rendered as more pips — data-driven.
	slotMax = $derived.by<Record<ActionSlot, number>>(() => {
		const max = { action: 1, bonus: 1, reaction: 1 };
		if (this.character?.play.autoCalc)
			for (const eff of this.character.play.effects)
				for (const t of eff.effects) {
					const p = parseEffect(t);
					if (
						p.kind === EFFECT_KIND.flatBonus &&
						p.amount !== undefined &&
						p.target &&
						Object.hasOwn(max, p.target)
					)
						max[p.target as keyof typeof max] += p.amount;
				}
		return max;
	});
	get moveMax(): number {
		return this.sheet?.speed.value ?? 0;
	}
	moveLeft = $derived(Math.max(0, this.moveMax - (this.character?.play.turn.move ?? 0)));
	/** Click a pip in a slot. Same click-to-set model as spell slots: clicking a filled (available)
	 *  pip spends up to it; clicking a spent pip restores down to it. */
	usePip = (slot: ActionSlot, index: number) => {
		const t = this.character?.play.turn;
		if (!t) return;
		t[slot] = pipClick(t[slot], index, this.slotMax[slot]);
	};
	/** Spend a step of movement (default 5 ft), clamped to the remaining pool. */
	spendMove = (ft = 5) => {
		const t = this.character?.play.turn;
		if (!t) return;
		t.move = Math.min(this.moveMax, Math.max(0, t.move + ft));
	};
	resetMove = () => {
		if (this.character) this.character.play.turn.move = 0;
	};
	/** End the turn: refresh every action-economy slot and advance the round counter. */
	nextTurn = () => {
		const c = this.character;
		if (!c) return;
		c.play.turn = { action: 0, bonus: 0, reaction: 0, move: 0 };
		c.play.round += 1;
	};
	/** Enter/leave combat. Entering resets the turn + round so tracking starts clean; leaving hides
	 *  the turnbar and lifts action-economy enforcement. */
	toggleCombat = () => {
		const c = this.character;
		if (!c) return;
		c.play.inCombat = !c.play.inCombat;
		if (c.play.inCombat) {
			c.play.turn = { action: 0, bonus: 0, reaction: 0, move: 0 };
			c.play.round = 1;
		}
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
	/** Stop concentrating (tap the concentration indicator). */
	clearConcentration = () => {
		if (this.character) this.character.play.concentration = null;
	};

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

	/** Advantage + bonus/penalty dice a stat picks up from active effects (gated on effects-auto). */
	private effectsFor(key: string): { advantage: boolean; bonusDice: BonusDie[] } {
		const c = this.character;
		if (!c || !c.play.autoCalc) return { advantage: false, bonusDice: [] }; // effects-auto off → plain
		return rollEffectsFor(c.play.effects, key);
	}

	// open the roll builder prefilled + anchored, so the player can pick advantage then Roll
	openRoll = (
		label: string,
		diceObj: Record<number, number>,
		mod: number,
		e: Event,
		advantage = 0
	) => {
		this.tray.prefill(label, diceObj, mod, advantage);
		this.openMenu('dice', e);
	};
	// EVERY roll site: normal tap rolls instantly; Alt/Ctrl-click opens the prefilled tray. `key`
	// (e.g. "save.dex", "skill.stealth", "attack") lets the roll pick up matching effects.
	roll = (label: string, mod: number, e: Event, key?: string) => {
		const fx = key ? this.effectsFor(key) : null;
		if (wantsTray(e)) this.openRoll(label, { 20: 1 }, mod, e, fx?.advantage ? 1 : 0);
		else this.tray.rollDiceNow(label, { 20: 1 }, mod, fx?.advantage ? 1 : 0, fx?.bonusDice ?? []);
	};

	// --- action-economy enforcement -----------------------------------------------------------
	/** Which turn slot an activity consumes, from its casting time (default = the Action). */
	private ctSlot(ct: SpRow['ct']): ActionSlot {
		return ct === 'react' ? 'reaction' : ct === 'bonus' ? 'bonus' : 'action';
	}
	/** In combat, spend one pip of `slot`; block (return false) + warn when it's exhausted. Out of
	 *  combat there is no economy → always allowed. */
	private trySpend(slot: ActionSlot): boolean {
		const c = this.character;
		if (!c || !c.play.inCombat) return true;
		if (c.play.turn[slot] >= this.slotMax[slot]) {
			toast(`No ${slot} left this turn`, { description: 'Press “Next turn” to refresh.' });
			return false;
		}
		c.play.turn[slot] += 1;
		return true;
	}
	/** Roll a weapon/unarmed attack (the Attack action → spends an action in combat). A normal tap
	 *  rolls the to-hit (picks up advantage/effects) THEN the weapon damage; Alt/Ctrl-click opens the
	 *  roll tray on the weapon's DAMAGE dice (so you can tweak/crit), not a bare d20. */
	attackRoll = (at: Atk, e: Event) => {
		if (!this.trySpend('action')) return;
		const { pool, mod } = parseDamage(at.dmg);
		const hasDice = Object.keys(pool).length > 0;
		const fx = this.effectsFor('attack');
		if (wantsTray(e)) {
			// tray on the TO-HIT (pick advantage), then Roll fires the damage as one combined entry
			this.openRoll(at.name, { 20: 1 }, at.toHit, e, fx.advantage ? 1 : 0);
			if (hasDice) this.tray.queueDamage(`${at.name} damage`, pool, mod);
			return;
		}
		// instant: to-hit (with effect advantage/dice) + damage → one 3-line entry
		const toHit = rollPool({ 20: 1 }, at.toHit, fx.advantage ? 1 : 0, fx.bonusDice);
		this.tray.pushRoll(at.name, toHit, hasDice ? rollPool(pool, mod) : undefined);
	};
	/** Click a standard action (Dash, Hide, …). Spends an action; roll-type ones open their roll,
	 *  no-roll ones just consume the slot. The "Attack" row is a pointer to the Attacks panel. */
	actionClick = (a: StandardAction, e: Event) => {
		if (a.id === 'attack') return; // routes to the Attacks panel; not itself an action spend
		if (!this.trySpend('action')) return;
		if (a.roll) this.roll(a.roll[0], a.roll[1], e);
		else toast(`${a.name} — action used`);
	};

	// casting a spell: damage/healing spells roll their dice; attack spells roll to hit
	cast = (r: SpRow, e: Event) => {
		// a spell costs its casting-time slot (action / bonus / reaction) when tracking combat
		if (!this.trySpend(this.ctSlot(r.ct))) return;
		// a concentration spell becomes the active concentration (replacing any prior one, 5e rule)
		if (r.conc && this.character) this.character.play.concentration = r.ref;
		const alt = wantsTray(e);
		// a spell with dice rolls them: damage (Fire Bolt 1d10, Fireball 8d6) or, for auto
		// spells, healing (Healing Word 2d4 + spellcasting mod)
		const caster = this.sheet?.spellcasting.classes[0];
		const hasDmg = !!r.dmg && Object.keys(r.dmg).length > 0;
		if (r.res === 'hit' && caster) {
			// attack spell → roll the TO-HIT first, then its damage (if any). Previously a damage-
			// dealing attack spell (Fire Bolt) rolled only damage and skipped the to-hit entirely.
			const toHit = caster.attack.value;
			if (alt) {
				// tray on the TO-HIT (the spell attack roll); Roll then fires the damage after
				this.openRoll(`${r.name} (spell attack)`, { 20: 1 }, toHit, e);
				if (hasDmg) this.tray.queueDamage(`${r.name} damage`, { ...r.dmg! }, 0);
			} else {
				// instant: to-hit + damage → one combined 3-line entry
				this.tray.pushRoll(
					`${r.name} (spell attack)`,
					rollPool({ 20: 1 }, toHit),
					hasDmg ? rollPool(r.dmg!, 0) : undefined
				);
			}
		} else if (hasDmg) {
			// save / auto spell: damage, or (auto) healing with the spellcasting mod
			const heal = r.res === 'auto';
			const label = `${r.name} ${heal ? 'healing' : 'damage'}`;
			const mod = heal && caster ? this.sheet!.abilities[caster.ability].mod : 0;
			if (alt) this.openRoll(label, r.dmg!, mod, e);
			else this.tray.rollDiceNow(label, r.dmg!, mod);
		} else {
			// a cast with no roll (buff/utility): a bare log marker, not a rolled total
			this.tray.logMarker(`Cast ${r.name}`);
			toast(`Cast ${r.name}`);
		}
	};

	// tap a slot pip: click a filled pip to spend down to it, a spent pip to restore up to it
	slotClick = (key: string, full: number, spent: number, i: number) => {
		if (!this.character) return;
		this.character.play.spellSlotsSpent[key] = pipClick(spent, i, full);
	};

	// --- resource tracker (rage, ki, item N/day…) — same click-to-set pip model as slots --------
	resourceSpent = (id: string): number => this.character?.play.resourcesSpent[id] ?? 0;
	resourceClick = (id: string, max: number, i: number) => {
		if (!this.character) return;
		const before = this.resourceSpent(id);
		const after = pipClick(before, i, max);
		this.character.play.resourcesSpent = { ...this.character.play.resourcesSpent, [id]: after };
		if (after === before) return;
		const name = this.sheet?.resources.find((r) => r.id === id)?.name ?? id;
		toast(`${name} ${after > before ? 'used' : 'restored'}`, {
			description: `${max - after} of ${max} left`
		});
	};
	/** Take a rest: recharge resources by type (short recharges short-rest pools; long recharges
	 *  both), reset spell slots (long = all, short = pact only), and restore HP on a long rest. */
	rest = (kind: 'short' | 'long') => {
		const c = this.character;
		if (!c || !this.sheet) return;
		const spent = { ...c.play.resourcesSpent };
		for (const r of this.sheet.resources)
			if (r.recharge === 'short' || (kind === 'long' && r.recharge === 'long')) spent[r.id] = 0;
		c.play.resourcesSpent = spent;
		if (kind === 'long') {
			c.play.spellSlotsSpent = {};
			c.play.hp = { ...c.play.hp, current: c.play.hp.max ?? this.sheet.maxHp.value, temp: 0 };
		} else {
			const slots = { ...c.play.spellSlotsSpent };
			delete slots.pact; // warlock pact slots return on a short rest
			c.play.spellSlotsSpent = slots;
		}
		void saveCharacterToStore(c);
		toast(`${kind === 'long' ? 'Long' : 'Short'} rest — resources restored`);
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
		if (!sp) return;
		if (!sp.prepared && this.preparedCount >= this.preparedCap) {
			toast(`Prepared spells full (${this.preparedCap}) — unprepare one first.`);
			return;
		}
		sp.prepared = !sp.prepared;
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
			? buildSpellGroups(this.character, this.sheet, this.graph, this.spellGroupBy, this.pinned)
			: []
	);
	preparedCount = $derived(this.character?.build.spells.filter((s) => s.prepared).length ?? 0);
	// prepared cap from the primary caster's derived profile (class table / formula), not hardcoded
	preparedCap = $derived(this.sheet?.spellcasting.classes[0]?.preparedCap ?? 0);

	hpBar = $derived.by(() => {
		if (!this.character || !this.sheet) return { cur: 0, tmp: 0 };
		const max = this.character.play.hp.max ?? this.sheet.maxHp.value;
		return {
			cur: Math.max(0, Math.min(100, (this.character.play.hp.current / max) * 100)),
			tmp: (this.character.play.hp.temp / max) * 100
		};
	});

	// conditions for THIS character's system (not a hardcoded edition)
	conditionList = $derived.by<string[]>(() => {
		const system = this.character?.system;
		if (!this.graph || !system) return [];
		return this.graph.list('condition', { system }).map((r) => String(r.data.name_en));
	});
	addEffect = (label: string, tokens: string[], positive = true) => {
		if (!this.character) return;
		this.character.play.effects = [
			...this.character.play.effects,
			{
				iid: crypto.randomUUID(),
				label,
				effects: tokens,
				positive,
				durationRounds: 10,
				startedRound: this.round
			}
		];
		this.overlay = null;
	};
}

/** The single shared Combat view-model instance. */
export const combat = new CombatVM();
