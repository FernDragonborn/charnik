/*
 * The N2 action EXECUTOR: what actually happens when a class feature's spend-option is used —
 * validate the resource cost and the turn slot all-or-nothing, deduct both, then run the action's
 * verbs. The verb set and the all-or-nothing rule are specified in docs/ACTIONS.md §2; the rule that
 * matters most is that every verb lands on an EXISTING system rather than opening a new mutation
 * path into play-state.
 *
 * Entering combat lives here too, because "roll Initiative" is the event that fires
 * `regain_on_initiative` features — the tracker's one auto-mutation, and it belongs beside the
 * other things that spend and restore.
 */
import { toast } from 'svelte-sonner';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';
import { rollFormula } from '$lib/rules/dice';
import { titleCase, type ActionSlot } from '$lib/combat/helpers';
import type { RollTray } from './roll-tray.svelte';
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
	tray: RollTray;
	economy: TurnEconomy;
	resources: ResourceTracker;
	effects: EffectsEditor;
}

export class ActionExecutor {
	/* Accessor, not an object — a $derived field initialiser runs before a constructor parameter
	   property is assigned (same shape as TurnEconomy / FeatSlots / EffectsEditor). */
	constructor(private host: () => ExecutorHost) {}

	/** N2 executor (first slice): activate a resource spend-option. Validate the resource cost AND the
	 *  turn slot ALL-OR-NOTHING (ACTIONS.md), then deduct both and run the action token. The turn cost
	 *  was the piece-3 gap — spending an option (Flurry, Second Wind…) now actually consumes its
	 *  action/bonus/reaction, not just the resource. */
	activateResourceOption = (opt: ResourceOption, amount = 1) => {
		if (!this.host().character) return;
		const slot = ACTION_TYPE_SLOT[opt.actionType]; // null for a free action
		// the `available` L2 guard is a RULE, not a UI state: ActionsPanel greys the row, but the
		// resource chip reaches the same option, so the check belongs here where every caller passes
		// (else a chip could fire Persistent Rage outside its combat-start window).
		if (!opt.available) {
			toast(`${opt.name} — not available right now`);
			return;
		}
		if (!this.host().resources.canAffordOption(opt, amount)) {
			toast(`${opt.name} — not enough ${opt.resourceId}`, { description: 'Recharge on a rest' });
			return;
		}
		if (slot && !this.host().economy.canSpend(slot)) {
			toast(`No ${slot} left this turn`, { description: 'Press “Next turn” to refresh.' });
			return;
		}
		if (slot) this.host().economy.trySpend(slot); // both spends succeed — validated above
		this.host().resources.spendOption(opt, amount); // deduct the resource (+ its own toast)
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
		const options = (this.host().sheet?.resourceOptions ?? []).filter((o) => o.resourceId === id);
		const [only] = options;
		if (options.length === 1 && only) this.activateResourceOption(only);
		else this.host().resources.useResource(id, max);
	};

	/** Enter/leave combat. Wraps `economy.toggleCombat` (which flips `inCombat` + resets the round) so
	 *  that ENTERING combat = "rolling Initiative" also fires the auto event features. */
	toggleCombat = () => {
		this.host().economy.toggleCombat();
		if (this.host().character?.play.inCombat) this.fireInitiativeRegen();
	};

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
		const p = this.host().character?.play;
		if (!p) return;
		const sep = action.indexOf(':');
		const verb = sep === -1 ? action : action.slice(0, sep);
		const arg = sep === -1 ? '' : action.slice(sep + 1);
		if (verb === 'heal' && arg) {
			const r = rollFormula(arg);
			p.hp.current = Math.min(this.host().hpMax, p.hp.current + Math.max(0, r.total));
			this.host().tray.pushRoll(`${opt.name} — heal`, r);
		} else if (verb === 'roll' && arg) {
			this.host().tray.pushRoll(opt.name, rollFormula(arg));
		} else if (verb === 'apply_condition' && arg) {
			this.host().effects.addEffect({ label: opt.name, tokens: [action], positive: false });
		} else if (verb === 'apply_effect' && arg) {
			this.applyCatalogEffect(opt, arg);
		} else if (verb === 'gain_action') {
			p.turn.action = Math.max(0, p.turn.action - 1); // one additional action this turn
		} else if (verb === 'restore_resource' && arg) {
			this.host().resources.restoreAll(arg); // regain all uses of the pool (Persistent Rage / Uncanny Metabolism)
		} else if (verb === 'rest' && (arg === 'short' || arg === 'long')) {
			// grant a rest: lands on the SAME rest system the rest buttons use (recharge pools by type,
			// reset slots, restore HP + hit dice on a long rest, expire outlasted timed effects). A
			// consumable that grants a rest MUST have recharge `other` so the rest it triggers doesn't
			// refund its own charge (see ACTIONS.md §2).
			this.host().resources.rest(arg);
			toast(`${opt.name} — ${arg} rest taken`);
		}
	}

	/** `apply_effect:<id>` — apply a NAMED catalog buff/debuff (Rage, Bless-as-action…) via the SAME add
	 *  path the "+" picker uses: its `ref` re-resolves the tokens LIVE at derive, `negative` sets
	 *  buff/debuff, `duration_rounds` gives the timer (round-counter auto-expires it). Missing id →
	 *  surface, not a silent no-op. Split out of `runOneAction` to keep its verb-dispatch under budget. */
	private applyCatalogEffect(opt: ResourceOption, arg: string) {
		const p = this.host().character?.play;
		if (!p) return;
		const cat = this.host().effects.effectCatalog.find((eff) => eff.ref.split(':').pop() === arg);
		if (!cat) {
			toast(`${opt.name} — effect “${arg}” not found`, { description: 'Check effects.csv' });
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
