/*
 * The resource/rest subsystem of the Combat view-model: spell-slot pips, named resource pips (rage,
 * ki, item N/day…) and short/long rests (which recharge them + restore HP). All use the one
 * click-to-set pip model (pipClick). Split out of CombatVM so the consumables concern is one cohesive
 * unit; CombatVM composes it as `combat.resources`, passing getters for the reactive character + sheet.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { saveCharacterGuarded } from '$lib/character/store.svelte';
import {
	endConcentrationCarriedBy,
	pipClick,
	remainingRounds,
	titleCase,
} from '$lib/combat/helpers';
import { effectiveHpMax, hitDiceRecoveredOnLongRest } from '$lib/rules/core';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { RECHARGE_ALL, restRecharge } from '$lib/rules/recharge';
import { rechargeCount } from '$lib/effects/recharge-amount';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';

export class ResourceTracker {
	constructor(
		private getCharacter: () => Character | null,
		private getSheet: () => CharacterSheet | null,
	) {}

	// tap a spell-slot pip: click a filled pip to spend down to it, a spent pip to restore up to it
	slotClick = (key: string, full: number, spent: number, i: number) => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.spellSlotsSpent[key] = pipClick(spent, i, full);
	};

	/** The pool's definition on the live sheet, or undefined when nothing grants it any more. */
	private defOf = (id: string) => this.getSheet()?.resources.find((r) => r.id === id);
	/** What a pool is CALLED — never its id, which is a key, not a word the player has ever read (UX-1).
	 *  Public because the action executor blocks a spend with the same sentence. The fallback matches
	 *  the engine's (`titleCase`), so a pool nothing grants any more — a removed feature, a disabled
	 *  source — reads like a pool rather than like a database key. */
	resourceName = (id: string): string => this.defOf(id)?.name ?? titleCase(id);

	/** Spent count for a resource, CLAMPED to what the current sheet actually grants. Persisted
	 *  `resourcesSpent` is keyed by id and outlives the effect that granted it — so after a feature/
	 *  plugin is removed or its max drops, the stored `spent` can exceed the live max (or reference a
	 *  gone resource). Clamp to `[0, currentMax]` (an absent resource → max 0) so the sheet can never
	 *  show a negative "left" or orphan pips. */
	resourceSpent = (id: string): number => {
		const stored = this.getCharacter()?.play.resourcesSpent[id] ?? 0;
		return Math.max(0, Math.min(stored, this.defOf(id)?.max ?? 0));
	};
	/** Use ONE unit of a resource — the spell-cast analogue for named pools (UBUG-8): spend the next
	 *  available unit, or BLOCK with a toast when exhausted (mirrors how a cast reserves + gates a spell
	 *  slot). Fine-grained restore / arbitrary set stays on the pips (`resourceClick`). */
	useResource = (id: string, max: number) => {
		const c = this.getCharacter();
		if (!c) return;
		const name = this.resourceName(id);
		const before = this.resourceSpent(id);
		if (before >= max) {
			toast(t('combat.notice.resourceNoneLeft', { name }), {
				description: t('combat.notice.rechargeOnRest'),
			});
			return;
		}
		const after = before + 1;
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [id]: after };
		// an unlimited pool (`inf` max) never runs out — count uses instead of a remaining total
		toast(t('combat.notice.resourceUsed', { name }), {
			description: Number.isFinite(max)
				? t('combat.notice.resourceLeftOf', { left: max - after, max })
				: t('combat.notice.resourceUsedUnlimited', { used: after }),
		});
	};
	resourceClick = (id: string, max: number, i: number) => {
		const c = this.getCharacter();
		if (!c) return;
		const before = this.resourceSpent(id);
		const after = pipClick(before, i, max);
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [id]: after };
		if (after === before) return;
		const name = this.resourceName(id);
		toast(
			t(after > before ? 'combat.notice.resourceUsed' : 'combat.notice.resourceRestoredName', {
				name,
			}),
			{ description: t('combat.notice.resourceLeftOf', { left: max - after, max }) },
		);
	};

	/** Spent count for a hit-die pool, CLAMPED to the live max (same stale-state guard as
	 *  `resourceSpent`: a shrunk/removed class can leave `hitDiceSpent` above the current max). */
	hitDiceSpent = (die: string): number => {
		const stored = this.getCharacter()?.play.hitDiceSpent[die] ?? 0;
		const max = this.getSheet()?.hitDice.find((h) => h.die === die)?.max ?? 0;
		return Math.max(0, Math.min(stored, max));
	};

	/** Units left in the pool backing an option (max − spent). `x`-cost options price at `amount`. */
	private remainingFor = (resourceId: string): number => {
		const max = this.defOf(resourceId)?.max ?? 0;
		return max - this.resourceSpent(resourceId);
	};
	/** Piece 3: can this option be paid for right now? (`x` = a player-picked `amount`, ≥1.) */
	canAffordOption = (opt: ResourceOption, amount = 1): boolean => {
		const cost = opt.cost === 'x' ? amount : opt.cost;
		return cost >= 1 && cost <= this.remainingFor(opt.resourceId);
	};
	/** Piece 3: spend on an option — afford-check, deduct the cost, surface the action. Returns whether
	 *  it went through (a blocked spend toasts + returns false). `roll:`/`heal:` actions wire to the
	 *  dice tray in a follow-up; v1 surfaces the `note:` text. */
	spendOption = (opt: ResourceOption, amount = 1): boolean => {
		const c = this.getCharacter();
		if (!c) return false;
		const cost = opt.cost === 'x' ? amount : opt.cost;
		if (!this.canAffordOption(opt, amount)) {
			toast(
				t('combat.notice.notEnoughResource', {
					resource: this.resourceName(opt.resourceId),
					name: opt.name,
				}),
				{
					description: t('combat.notice.notEnoughResourceBody', {
						left: this.remainingFor(opt.resourceId),
						cost,
					}),
				},
			);
			return false;
		}
		const before = this.resourceSpent(opt.resourceId);
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [opt.resourceId]: before + cost };
		const desc = opt.action.startsWith('note:')
			? opt.action.slice('note:'.length)
			: opt.description;
		toast(
			t('combat.notice.resourceSpent', {
				name: opt.name,
				cost,
				resource: this.resourceName(opt.resourceId),
			}),
			{ description: desc },
		);
		return true;
	};

	/** Regain ALL expended uses of a pool (spent → 0) — the `restore_resource:<id>` action verb.
	 *  RAW: Persistent Rage "regain all expended uses of Rage", Uncanny Metabolism "regain all expended
	 *  Focus Points". `id` is a flat resource id (not a content ref), like `grant_resource`'s. */
	restoreAll = (id: string) => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [id]: 0 };
		const name = this.resourceName(id);
		toast(t('combat.notice.resourceFullyRestored', { name }));
	};

	/** Regain expended uses until at least `upTo` are AVAILABLE — never reduces what's there ("regain
	 *  expended until you have N", Perfect Focus → Focus 4). Returns the resulting available count (for
	 *  the caller's notice); no toast here (the auto-initiative path notifies with the feature name).
	 *  No-op returning 0 when the pool is unknown. Silent unlike `restoreAll` — it's a system event. */
	restoreUpTo = (id: string, upTo: number): number => {
		const c = this.getCharacter();
		const def = this.defOf(id);
		if (!c || !def) return 0;
		const spent = c.play.resourcesSpent?.[id] ?? 0;
		const newSpent = Math.min(spent, Math.max(0, def.max - upTo)); // only restores (never raises spent)
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [id]: newSpent };
		return def.max - newSpent;
	};

	/** What each spend-option's `available` guard said last time we looked. Plain, not `$state`: it is
	 *  read and written by the same call, and a reactive field there is a loop. */
	private windowWas = new Map<string, boolean>();
	/**
	 * Say so when a conditional ability's window OPENS — Persistent Rage at combat start, Uncanny
	 * Metabolism on the first initiative. The panel greys a closed one, which is the "never hidden"
	 * half; nothing announced the moment it stopped being closed, which is the half a player needs to
	 * notice it at all (`docs/internals/characters.md` ▸ a tracker surfaces, it never decides).
	 *
	 * It notices, and stops there: no spend, no pre-selection. The first pass only records — otherwise
	 * opening the sheet would announce every ability the character has.
	 */
	noticeOpenedWindows = () => {
		const seeded = this.windowWas.size > 0;
		for (const o of this.getSheet()?.resourceOptions ?? []) {
			const was = this.windowWas.get(o.id);
			this.windowWas.set(o.id, o.available);
			if (seeded && was === false && o.available)
				toast(t('combat.notice.windowOpen', { name: o.name }));
		}
	};

	/**
	 * A boundary that is not a rest: dawn, or dusk. Everything whose recharge fires there comes back —
	 * a wand's "regains 1d6+1 charges daily at dawn" is rolled here, because that is when the table
	 * rolls it.
	 *
	 * A CONTROL the player presses, never a clock the app runs: nothing here knows the hour, and a
	 * long rest is eight hours from whenever it started, which is not dawn.
	 */
	passBoundary = (trigger: 'dawn' | 'dusk') => {
		const c = this.getCharacter();
		const sheet = this.getSheet();
		if (!c || !sheet) return;
		const spent = { ...c.play.resourcesSpent };
		const said: string[] = [];
		for (const r of sheet.resources) {
			if (r.recharge.trigger !== trigger) continue;
			const before = spent[r.id] ?? 0;
			if (before === 0) continue; // nothing spent to give back — say nothing about it
			if (r.recharge.amount === RECHARGE_ALL) {
				spent[r.id] = 0;
				said.push(t('combat.notice.rechargedAll', { name: r.name }));
			} else {
				const n = rechargeCount(r.recharge.amount, sheet.castCtx);
				if (n === null) continue;
				const left = Math.max(0, before - n);
				spent[r.id] = left;
				said.push(t('combat.notice.recharged', { name: r.name, count: before - left }));
			}
		}
		c.play.resourcesSpent = spent;
		void saveCharacterGuarded(c);
		toast(t(`combat.timeSkip.${trigger === 'dawn' ? 'newDay' : 'nightfall'}`), {
			description: said.length ? said.join(' · ') : t('combat.notice.nothingRecharged'),
		});
	};

	/** Does this character have anything that comes back at that boundary? The control for it is shown
	 *  only then — a button that can never do anything is a worse answer than no button. */
	hasBoundaryPool = (trigger: 'dawn' | 'dusk'): boolean =>
		(this.getSheet()?.resources ?? []).some((r) => r.recharge.trigger === trigger);

	/** The long-rest-only half of `rest`: slots, HP, concentration, Hit Dice and Exhaustion. Split out
	 *  because it's the only branch that touches five subsystems, and inlining it pushed `rest` past the
	 *  complexity budget. */
	private applyLongRest = (c: Character, sheet: CharacterSheet) => {
		c.play.spellSlotsSpent = {};
		// full HP is the EFFECTIVE max (A14): a manual max does not silence an `hp_max` effect, so a
		// long rest must fill to the same number heal and the bar clamp to
		c.play.hp = {
			...c.play.hp,
			current: effectiveHpMax(c.play.hp.max ?? null, sheet.maxHp),
			temp: 0,
		};
		c.play.concentration = null; // a long rest ALWAYS ends concentration, even with no linked
		// effect in play.effects (e.g. Hold Person on an enemy) — A13
		// Hit Dice regained — edition-divergent (2014 half total, min 1; 2024 all). Recover
		// largest-die-first (pools are sorted so) up to the recovered count; a deterministic v1 of
		// the "player picks which" RAW choice (upgrade to a picker later).
		const totalHd = sheet.hitDice.reduce((n, h) => n + h.max, 0);
		let recover = hitDiceRecoveredOnLongRest(c.system, totalHd);
		const hdSpent = { ...c.play.hitDiceSpent };
		for (const h of sheet.hitDice) {
			if (recover <= 0) break;
			const spent = Math.max(0, Math.min(hdSpent[h.die] ?? 0, h.max));
			const back = Math.min(spent, recover);
			if (back > 0) {
				hdSpent[h.die] = spent - back;
				recover -= back;
			}
		}
		c.play.hitDiceSpent = hdSpent;
		// RAW both editions: a Long Rest removes ONE Exhaustion level (2024 glossary "Removing
		// Exhaustion Levels"; 2014 "reduces a creature's exhaustion level by 1"). 2014 adds "provided
		// the creature has also ingested some food and drink" — a tracker doesn't model rations, so we
		// apply it unconditionally (RAI, the universal reading). Automatic in RAW → no player click.
		c.play.exhaustion = Math.max(0, c.play.exhaustion - 1);
	};

	/** Take a rest: recharge resources by type (short recharges short-rest pools; long recharges both),
	 *  reset spell slots (long = all, short = pact only), restore HP on a long rest, and expire
	 *  round-timed effects the rest outlives: a short rest is 1 h (600 rounds), a long rest outlives
	 *  every round-timed effect. Indefinite effects (no duration) persist — those are curses/manual
	 *  states the player removes explicitly. */
	rest = (kind: 'short' | 'long') => {
		const c = this.getCharacter();
		const sheet = this.getSheet();
		if (!c || !sheet) return;
		const exhaustionBefore = c.play.exhaustion;
		const spent = { ...c.play.resourcesSpent };
		for (const r of sheet.resources) {
			// what this rest gives the pool back is the recharge model's call, not this loop's:
			// `null` nothing, `'all'` the whole pool, otherwise an amount to roll or read
			const back = restRecharge(r.recharge, kind);
			if (back === null) continue;
			if (back === RECHARGE_ALL) spent[r.id] = 0;
			else {
				const n = rechargeCount(back, sheet.castCtx);
				if (n !== null) spent[r.id] = Math.max(0, (spent[r.id] ?? 0) - n);
			}
		}
		c.play.resourcesSpent = spent;
		if (kind === 'long') {
			this.applyLongRest(c, sheet);
		} else {
			const slots = { ...c.play.spellSlotsSpent };
			delete slots[PACT_SLOT_KEY]; // warlock pact slots return on a short rest
			c.play.spellSlotsSpent = slots;
		}
		// a rest expires an effect it OUTLASTS: compare rounds LEFT (not total duration) to the rest's
		// length — a short rest = 1 h (600 rounds), a long rest outlasts any timed effect (A12).
		const round = c.play.round;
		const outlived = (e: (typeof c.play.effects)[number]) => {
			const left = remainingRounds(e, round);
			return left != null && (kind === 'long' || left <= 600);
		};
		endConcentrationCarriedBy(c.play, c.play.effects.filter(outlived));
		c.play.effects = c.play.effects.filter((e) => !outlived(e));
		void saveCharacterGuarded(c);
		const lostExhaustion = exhaustionBefore > c.play.exhaustion;
		toast(t('combat.notice.restRestored', { kind: t(`combat.restKind.${kind}`) }), {
			...(lostExhaustion
				? {
						description: t('combat.notice.exhaustionChanged', {
							from: exhaustionBefore,
							to: c.play.exhaustion,
						}),
					}
				: {}),
		});
	};
}
