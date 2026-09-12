/*
 * The N2 action EXECUTOR: what actually happens when a class feature's spend-option is used —
 * validate the resource cost and the turn slot all-or-nothing, deduct both, then run the action's
 * verbs. The verb set and the all-or-nothing rule are specified in docs/internals/actions.md §2; the rule that
 * matters most is that every verb lands on an EXISTING system rather than opening a new mutation
 * path into play-state.
 *
 * Entering combat and advancing a turn live here too, because both are EVENTS that fire features —
 * `regain_on_initiative` at initiative, `on_event` hooks at a turn start — and the tracker's
 * automatic mutations belong beside the other things that spend and restore.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';
import { rollFormula } from '$lib/rules/dice';
import { PLAY_EVENT, type PlayEvent } from '$lib/effects/token-parser';
import { ACTION_SLOT_LABEL, type ActionSlot } from '$lib/combat/helpers';
import { attackRollName, numberedAttackRollName, type Attack } from '$lib/combat/attacks';
import type { RollJournal } from './roll-journal.svelte';
import type { SheetRolls } from './sheet-rolls.svelte';
import type { TurnEconomy } from './turn-economy.svelte';
import type { ResourceTracker } from './resource-tracker.svelte';
import type { EffectsEditor } from './effects-editor.svelte';

/** A resource-option's `action_type` → the turn-economy slot it consumes (`free` = none). */
const ACTION_TYPE_SLOT: Record<ResourceOption['actionType'], ActionSlot | null> = {
	action: 'action',
	bonus_action: 'bonus',
	reaction: 'reaction',
	free: null,
};

/** What the executor needs from the sheet around it. */
export interface ExecutorHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	hpMax: number;
	journal: RollJournal;
	economy: TurnEconomy;
	resources: ResourceTracker;
	effects: EffectsEditor;
	/** The character's attack rows, and the way to fire one — what `attack:` resolves against. */
	attacks: Attack[];
	rolls: SheetRolls;
}

/** How many strikes one action may fire. RAW's largest is a handful; the cap is against a content
 *  typo (`attack:dagger:200`) turning one click into two hundred log lines. */
const MAX_ATTACKS_PER_ACTION = 12;

export class ActionExecutor {
	/* Accessor, not an object — a $derived field initialiser runs before a constructor parameter
	   property is assigned (same shape as TurnEconomy / FeatSlots / EffectsEditor). */
	constructor(private host: () => ExecutorHost) {}

	/** N2 executor (first slice): activate a resource spend-option. Validate the resource cost AND the
	 *  turn slot ALL-OR-NOTHING (actions.md), then deduct both and run the action token. The turn cost
	 *  was the piece-3 gap — spending an option (Flurry, Second Wind…) now actually consumes its
	 *  action/bonus/reaction, not just the resource. */
	activateResourceOption = (opt: ResourceOption, amount = 1) => {
		if (!this.host().character) return;
		const slot = ACTION_TYPE_SLOT[opt.actionType]; // null for a free action
		// the `available` L2 guard is a RULE, not a UI state: ActionsPanel greys the row, but the
		// resource chip reaches the same option, so the check belongs here where every caller passes
		// (else a chip could fire Persistent Rage outside its combat-start window).
		if (!opt.available) {
			toast(t('combat.notice.notAvailable', { name: opt.name }));
			return;
		}
		if (!this.host().resources.canAffordOption(opt, amount)) {
			toast(
				t('combat.notice.notEnoughResource', {
					resource: this.host().resources.resourceName(opt.resourceId),
					name: opt.name,
				}),
				{ description: t('combat.notice.restToRecharge') },
			);
			return;
		}
		if (slot && !this.host().economy.canSpend(slot)) {
			toast(t('combat.notice.noSlotLeft', { slot: t(ACTION_SLOT_LABEL[slot]) }), {
				description: t('combat.notice.nextTurnToRefresh'),
			});
			return;
		}
		if (slot) this.host().economy.trySpend(slot); // both spends succeed — validated above
		this.host().resources.spendOption(opt, amount); // deduct the resource (+ its own toast)
		this.runAction(opt.name, opt.action);
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
		const options = (this.host().sheet?.resourceOptions ?? []).filter((o) => o.resourceId === id);
		const [only] = options;
		if (options.length === 1 && only) this.activateResourceOption(only);
		else this.host().resources.useResource(id, max);
	};

	/** Enter/leave combat. Wraps `economy.toggleCombat` (which flips `inCombat` + resets the round) so
	 *  that ENTERING combat = "rolling Initiative" also fires the auto event features. Round 1 IS the
	 *  character's first turn, so `turn_start` fires here too — otherwise a turn-start feature would
	 *  silently skip the first turn of every fight. */
	toggleCombat = () => {
		this.host().economy.toggleCombat();
		if (this.host().character?.play.inCombat) {
			this.fireInitiativeRegen();
			this.fireEventHooks(PLAY_EVENT.turnStart);
		}
	};

	/** Advance to your next turn. Wraps `economy.nextTurn` (which resets the pips, advances the round
	 *  and expires timed effects) so the turn boundary is ONE call: whoever ends a turn also starts the
	 *  next one, and a `turn_start` feature cannot be missed by a caller that forgot to fire it. */
	nextTurn = () => {
		this.host().economy.nextTurn();
		this.fireEventHooks(PLAY_EVENT.turnStart);
	};

	/**
	 * Run every `on_event` hook listening for `event` (2024 Champion's Heroic Rally at a turn start).
	 * Both halves were settled at derive: the action's L2 formula is already resolved, and the hook's
	 * L2 guard decided whether it is in this list at all — which is how "if you are Bloodied" is said
	 * (`is_bloodied ? on_event:turn_start:heal:5+con_mod`), with no condition language of its own here.
	 *
	 * Auto-apply, the same call `regain_on_initiative` made: RAW these happen TO you, and a prompt at
	 * every turn start would be worse than the tracker doing it. Gated on auto-calc like every other
	 * automatic mutation. The verbs that change something visible announce it themselves (a `heal:`
	 * toasts its roll), so there is no second notice layered on top; a hook whose verb is silent needs
	 * that VERB to say something, which is a fix in one place rather than in every caller.
	 */
	private fireEventHooks(event: PlayEvent) {
		if (!this.host().character?.play.autoCalc) return;
		for (const hook of this.host().sheet?.facts.onEvent ?? [])
			if (hook.event === event) this.runAction(hook.source, hook.action);
	}

	/** AUTO event on combat start ("when you roll Initiative"): every `regain_on_initiative` feature
	 *  restores its pool up to N and NOTIFIES what happened — auto-apply + toast, the maintainer's call
	 *  for these NO-CHOICE features (Perfect Focus → Focus 4, etc.), the tracker's first event-driven
	 *  auto-mutation. Data-driven (any feature carrying the token fires; notice labelled from its name).
	 *  Gated on auto-calc: with it OFF the player manages pools by hand, so the app doesn't touch them. */
	private fireInitiativeRegen() {
		const c = this.host().character;
		if (!c?.play.autoCalc) return;
		for (const r of this.host().sheet?.facts.initiativeRegain ?? []) {
			const def = this.host().sheet?.resources.find((x) => x.id === r.id);
			if (!def) continue;
			const before = def.max - (c.play.resourcesSpent?.[r.id] ?? 0);
			const after = this.host().resources.restoreUpTo(r.id, r.upTo);
			if (after > before)
				toast(r.source, {
					description: t('combat.notice.resourceRestoredTo', {
						resource: this.host().resources.resourceName(r.id),
						count: after,
					}),
				});
		}
	}

	/** Run a resource-option's RESOLVED action token (a `heal:`/`roll:` formula is already L2-resolved
	 *  at derive). Each verb lands on an EXISTING system (actions.md §2 — no new mutation paths):
	 *  `heal:` → HP path (clamped), `roll:` → tray + log, `apply_condition:` → the effect add path,
	 *  `apply_effect:<id>` → apply a NAMED effects.csv buff/debuff (Rage) via the "+"-catalog add path
	 *  (ref/negative/duration all read from the row), `gain_action` → one ADDITIONAL action this turn
	 *  (Action Surge — a granted pip, never a refund), `rest:short|long` → take that rest
	 *  (recharge pools / reset slots / restore HP — a Potion of Angelic Slumber, 2024 short-rest
	 *  spells), `restore_resource:<id>` → regain ALL uses of a pool (Persistent Rage, Uncanny
	 *  Metabolism), `note:` → the spendOption toast. */
	private runAction(name: string, action: string) {
		// a `;`-separated action is a MULTI-action (Uncanny Metabolism = restore focus AND heal): run each
		// sub-token in order on the ONE activation (cost + turn slot were validated once, up front).
		for (const token of action.split(';')) {
			const t = token.trim();
			if (t) this.runOneAction(name, t);
		}
	}

	/**
	 * The verb table — one entry per bounded token in actions.md §2, each landing on an EXISTING
	 * system (no new mutation paths). A table rather than an if-ladder because the ladder is what
	 * grows: every verb added one more branch to one function, and the eleventh tipped it past what
	 * anybody reads in one go. An entry that needs an argument checks for it; a verb whose argument
	 * is missing does nothing, which is the same silence the ladder gave.
	 */
	private readonly VERBS: Record<string, (name: string, arg: string) => void> = {
		heal: (name, arg) => {
			const p = this.host().character?.play;
			if (!p || !arg) return;
			const r = rollFormula(arg);
			p.hp.current = Math.min(this.host().hpMax, p.hp.current + Math.max(0, r.total));
			this.host().journal.pushRoll(
				{ text: `${name} — heal`, key: 'combat.log.heal', values: { name } },
				r,
			);
		},
		roll: (name, arg) => {
			if (arg) this.host().journal.pushRoll({ text: name }, rollFormula(arg));
		},
		apply_condition: (name, arg) => {
			if (arg)
				this.host().effects.addEffect({
					label: name,
					tokens: [`apply_condition:${arg}`],
					positive: false,
				});
		},
		apply_effect: (name, arg) => {
			if (arg) this.applyCatalogEffect(name, arg);
		},
		gain_action: () => {
			// RAW: an ADDITIONAL action, i.e. one more pip this turn — not a refund of a spent one. It
			// used to decrement `turn.action`, so surging BEFORE acting burnt a use for nothing.
			const p = this.host().character?.play;
			if (p) p.turn.grantedActions += 1;
		},
		attack: (name, arg) => {
			if (arg) this.makeAttacks(name, arg);
		},
		restore_resource: (_name, arg) => {
			// regain all uses of the pool (Persistent Rage / Uncanny Metabolism)
			if (arg) this.host().resources.restoreAll(arg);
		},
		rest: (name, arg) => {
			// grant a rest: lands on the SAME rest system the rest buttons use (recharge pools by type,
			// reset slots, restore HP + hit dice on a long rest, expire outlasted timed effects). A
			// consumable that grants a rest MUST have recharge `other` so the rest it triggers doesn't
			// refund its own charge (see actions.md §2).
			if (arg !== 'short' && arg !== 'long') return;
			this.host().resources.rest(arg);
			toast(t('combat.notice.restTakenFor', { name, kind: t(`combat.restKind.${arg}`) }));
		},
	};

	/** Run ONE resolved action verb (an action may hold several, `;`-joined — see `runAction`). */
	private runOneAction(name: string, action: string) {
		if (!this.host().character) return;
		const sep = action.indexOf(':');
		const verb = sep === -1 ? action : action.slice(0, sep);
		const arg = sep === -1 ? '' : action.slice(sep + 1);
		this.VERBS[verb]?.(name, arg);
	}

	/**
	 * `attack:<weapon id>[:<count>]` — UBUG-11. A class feature that says "make two Unarmed Strikes"
	 * MAKES them: each strike goes through the ordinary attack path, so it picks up the same
	 * proficiency, magic bonus, Rage damage and scoped effects a tap on the Attacks panel would. It
	 * charges no turn slot of its own — the option's `action_type` already paid for the whole thing.
	 *
	 * The weapon is named by its BARE content id, never its display name, so the token survives a
	 * translated sheet. An id the character isn't carrying is SURFACED: an action that silently rolls
	 * nothing is the bug this verb exists to fix, so it must not become a quieter version of itself.
	 */
	private makeAttacks(name: string, arg: string) {
		const sep = arg.lastIndexOf(':');
		const hasCount = sep > 0 && /^\d+$/.test(arg.slice(sep + 1));
		const id = (hasCount ? arg.slice(0, sep) : arg).trim().toLowerCase();
		const asked = hasCount ? Number(arg.slice(sep + 1)) : 1;
		const count = Math.min(Math.max(1, asked), MAX_ATTACKS_PER_ACTION);
		const at = this.host().attacks.find((a) => a.id.toLowerCase() === id);
		if (!at) {
			toast(t('combat.notice.nothingToAttack', { name }), {
				description: t('combat.notice.nothingToAttackBody', { id }),
			});
			return;
		}
		// numbered, because two identical entries in the log are indistinguishable otherwise — and
		// which of the two Flurry strikes hit is exactly what the player is reading the log for.
		// Handed over as ONE action: the strikes then share a group and a toast, and each keeps an
		// identity of its own for an amendment to match on.
		this.host().rolls.rollAttacks(
			at,
			Array.from({ length: count }, (_, i) =>
				count > 1 ? numberedAttackRollName(at, t, i + 1, count) : attackRollName(at, t),
			),
		);
	}

	/** `apply_effect:<id>` — apply a NAMED catalog buff/debuff (Rage, Bless-as-action…) via the SAME add
	 *  path the "+" picker uses: its `ref` re-resolves the tokens LIVE at derive, `negative` sets
	 *  buff/debuff, `duration_rounds` gives the timer (round-counter auto-expires it). Missing id →
	 *  surface, not a silent no-op. Split out of `runOneAction` to keep its verb-dispatch under budget. */
	private applyCatalogEffect(name: string, arg: string) {
		const p = this.host().character?.play;
		if (!p) return;
		const cat = this.host().effects.effectCatalog.find((eff) => eff.ref.split(':').pop() === arg);
		if (!cat) {
			toast(t('combat.notice.effectMissing', { name }), {
				description: t('combat.notice.effectMissingBody', { id: arg }),
			});
			return;
		}
		// a named STATE doesn't stack — you're raging or you're not (RAW/RAI). Re-entering refreshes
		// (drop any live instance of the same catalog ref first), never adds a second Rage.
		p.effects = p.effects.filter((e) => e.source !== cat.ref);
		this.host().effects.addEffect({
			label: cat.label,
			tokens: cat.tokens,
			positive: !cat.negative,
			ref: cat.ref,
			...(cat.durationRounds != null ? { durationRounds: cat.durationRounds } : {}),
		});
	}
}
