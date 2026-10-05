/*
 * The N2 action executor on the sheet: the names the panels call to use a feature's spend-option,
 * enter combat and end a turn. What each DOES is a pure action in `$lib/play/options` and
 * `$lib/play/events` (docs/internals/actions.md §2); what stays here is what an action can only ASK
 * for — the strikes an `attack:` verb makes, rolled through the sheet's own attack path, and the
 * question an `assume_form:` verb puts before anything is paid.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';
import { type Attack } from '$lib/combat/attacks';
import { attackRollName, numberedAttackRollName } from '$lib/combat/attack-names';
import { enterOrLeaveCombat, startNextTurn } from '$lib/play/events';
import { activateOption } from '$lib/play/options';
import { PLAY_REQUEST, type PlayContext, type PlayOutcome } from '$lib/play/outcome';
import type { SheetRolls } from './sheet-rolls.svelte';
import type { ResourceTracker } from './resource-tracker.svelte';
import type { EffectsEditor } from './effects-editor.svelte';
import type { FormShift } from './form-shift.svelte';
import type { InventoryTracker } from './inventory.svelte';

/** What the executor needs from the sheet around it. */
export interface ExecutorHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	resources: ResourceTracker;
	effects: Pick<EffectsEditor, 'newEffectDuration'>;
	forms: Pick<FormShift, 'ask' | 'nameOf'>;
	/** The character's attack rows, and the way to fire one — what `attack:` resolves against. */
	attacks: Attack[];
	rolls: SheetRolls;
	/** What a shot spends, when the table counts ammunition. */
	inventory: Pick<InventoryTracker, 'shoot'>;
	/** Carry out a play-state action on the open character, and hand back what came of it. */
	enact(action: (character: Character, ctx: PlayContext) => PlayOutcome): PlayOutcome | null;
}

export class ActionExecutor {
	constructor(private host: () => ExecutorHost) {}

	/** Rounds an effect an action adds lasts when nothing states a length: the add-effect menu's own
	 *  setting, so an action's effect and a hand-added one agree. */
	private get effectRounds(): number {
		return this.host().effects.newEffectDuration;
	}

	/** Carry out an action, then do what it asked of the host. */
	private run(
		action: (character: Character, ctx: PlayContext) => PlayOutcome,
		answer: (monster: string) => void = () => {},
	) {
		for (const ask of this.host().enact(action)?.asks ?? [])
			if (ask.kind === PLAY_REQUEST.attack) this.makeAttacks(ask.name, ask.weapon, ask.count);
			else if (ask.kind === PLAY_REQUEST.form) this.host().forms.ask(ask.form, answer);
	}

	/** Use a spend-option: resource cost and turn slot validated ALL-OR-NOTHING, both paid, its verbs
	 *  run. An option that assumes a form opens the picker first and is used again with the answer, so
	 *  backing out of the question costs nothing. */
	activateResourceOption = (option: ResourceOption, amount = 1) => {
		const effectRounds = this.effectRounds;
		this.run(
			(c, ctx) => activateOption(c, { option, amount, effectRounds }, ctx),
			(monster) => {
				const form = { monster, label: this.host().forms.nameOf(monster) };
				this.run((c, ctx) => activateOption(c, { option, amount, effectRounds, form }, ctx));
			},
		);
	};

	/** The resource CHIP's primary "use one" gesture. When the pool has exactly ONE action-option, using
	 *  the resource IS that action — so the chip runs it through the executor, identical to clicking the
	 *  row in Actions. A pool with SEVERAL options has no single action to infer, and a pool with none
	 *  has nothing to run: both stay a plain decrement, which is also the honest escape hatch for
	 *  spending a point on something the app doesn't model. Only the pool's OWN options are counted:
	 *  what another feature lets the pool pay for (Wild Companion out of Wild Shape) is a further use
	 *  of it, and does not stop the chip from being the thing the pool exists for. */
	useResourceOrEnter = (id: string, max: number) => {
		const options = (this.host().sheet?.resourceOptions ?? []).filter(
			(o) => o.resourceId === id && o.grantedBy === undefined,
		);
		const [only] = options;
		if (options.length === 1 && only) this.activateResourceOption(only);
		else this.host().resources.useResource(id, max);
	};

	/** Enter/leave combat — entering is rolling Initiative and the first turn's start. */
	toggleCombat = () =>
		this.run((c, ctx) => enterOrLeaveCombat(c, { effectRounds: this.effectRounds }, ctx));

	/** End the turn and start the next one. */
	nextTurn = () => this.run((c, ctx) => startNextTurn(c, { effectRounds: this.effectRounds }, ctx));

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
	private makeAttacks(name: string, id: string, count: number) {
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
		// identity of its own for an amendment to match on. Fired through the inventory like a tap on
		// the Attacks panel, so a weapon that fires ammunition spends one per strike.
		this.host().inventory.shoot(
			at.id,
			null,
			() => {
				this.host().rolls.rollAttacks(
					at,
					Array.from({ length: count }, (_, i) =>
						count > 1 ? numberedAttackRollName(at, t, i + 1, count) : attackRollName(at, t),
					),
				);
				return true;
			},
			count,
		);
	}
}
