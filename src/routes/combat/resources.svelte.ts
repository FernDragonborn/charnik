/*
 * The resource/rest subsystem of the Combat view-model: spell-slot pips, named resource pips (rage,
 * ki, item N/day…) and short/long rests (which recharge them + restore HP). All use the one
 * click-to-set pip model (pipClick). Split out of CombatVM so the consumables concern is one cohesive
 * unit; CombatVM composes it as `combat.resources`, passing getters for the reactive character + sheet.
 */
import { toast } from 'svelte-sonner';
import { saveCharacterToStore } from '$lib/character/store.svelte';
import { pipClick, remainingRounds } from '$lib/combat/helpers';
import { hitDiceRecoveredOnLongRest } from '$lib/rules/core';
import { PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';

export class ResourceTracker {
	constructor(
		private getCharacter: () => Character | null,
		private getSheet: () => CharacterSheet | null
	) {}

	// tap a spell-slot pip: click a filled pip to spend down to it, a spent pip to restore up to it
	slotClick = (key: string, full: number, spent: number, i: number) => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.spellSlotsSpent[key] = pipClick(spent, i, full);
	};

	/** Spent count for a resource, CLAMPED to what the current sheet actually grants. Persisted
	 *  `resourcesSpent` is keyed by id and outlives the effect that granted it — so after a feature/
	 *  plugin is removed or its max drops, the stored `spent` can exceed the live max (or reference a
	 *  gone resource). Clamp to `[0, currentMax]` (an absent resource → max 0) so the sheet can never
	 *  show a negative "left" or orphan pips. */
	resourceSpent = (id: string): number => {
		const stored = this.getCharacter()?.play.resourcesSpent[id] ?? 0;
		const max = this.getSheet()?.resources.find((r) => r.id === id)?.max ?? 0;
		return Math.max(0, Math.min(stored, max));
	};
	/** Use ONE unit of a resource — the spell-cast analogue for named pools (UBUG-8): spend the next
	 *  available unit, or BLOCK with a toast when exhausted (mirrors how a cast reserves + gates a spell
	 *  slot). Fine-grained restore / arbitrary set stays on the pips (`resourceClick`). */
	useResource = (id: string, max: number) => {
		const c = this.getCharacter();
		if (!c) return;
		const name = this.getSheet()?.resources.find((r) => r.id === id)?.name ?? id;
		const before = this.resourceSpent(id);
		if (before >= max) {
			toast(`${name} — none left`, { description: 'Recharge on a rest' });
			return;
		}
		const after = before + 1;
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [id]: after };
		// an unlimited pool (`inf` max) never runs out — count uses instead of a remaining total
		toast(`${name} used`, {
			description: Number.isFinite(max) ? `${max - after} of ${max} left` : `${after} used · ∞`
		});
	};
	resourceClick = (id: string, max: number, i: number) => {
		const c = this.getCharacter();
		if (!c) return;
		const before = this.resourceSpent(id);
		const after = pipClick(before, i, max);
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [id]: after };
		if (after === before) return;
		const name = this.getSheet()?.resources.find((r) => r.id === id)?.name ?? id;
		toast(`${name} ${after > before ? 'used' : 'restored'}`, {
			description: `${max - after} of ${max} left`
		});
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
		const max = this.getSheet()?.resources.find((r) => r.id === resourceId)?.max ?? 0;
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
			toast(`${opt.name} — not enough ${opt.resourceId}`, { description: 'Recharge on a rest' });
			return false;
		}
		const before = this.resourceSpent(opt.resourceId);
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [opt.resourceId]: before + cost };
		const desc = opt.action.startsWith('note:')
			? opt.action.slice('note:'.length)
			: opt.description;
		toast(`${opt.name} — spent ${cost} ${opt.resourceId}`, { description: desc });
		return true;
	};

	/** Regain ALL expended uses of a pool (spent → 0) — the `restore_resource:<id>` action verb.
	 *  RAW: Persistent Rage "regain all expended uses of Rage", Uncanny Metabolism "regain all expended
	 *  Focus Points". `id` is a flat resource id (not a content ref), like `grant_resource`'s. */
	restoreAll = (id: string) => {
		const c = this.getCharacter();
		if (!c) return;
		c.play.resourcesSpent = { ...c.play.resourcesSpent, [id]: 0 };
		const name = this.getSheet()?.resources.find((r) => r.id === id)?.name ?? id;
		toast(`${name} — fully restored`);
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
		const spent = { ...c.play.resourcesSpent };
		for (const r of sheet.resources) {
			// full recharge: a `short` pool refills on ANY rest; a long rest refills everything EXCEPT the
			// two never-auto policies — manual-only `other` and one-use `consumable` (a spent potion charge
			// stays spent). `short_one` only regains ONE use per short rest (2024 Second Wind).
			const neverAuto = r.recharge === 'other' || r.recharge === 'consumable';
			const full = r.recharge === 'short' || (kind === 'long' && !neverAuto);
			if (full) spent[r.id] = 0;
			else if (kind === 'short' && r.recharge === 'short_one')
				spent[r.id] = Math.max(0, (spent[r.id] ?? 0) - 1);
		}
		c.play.resourcesSpent = spent;
		if (kind === 'long') {
			c.play.spellSlotsSpent = {};
			c.play.hp = { ...c.play.hp, current: c.play.hp.max ?? sheet.maxHp.value, temp: 0 };
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
		for (const e of c.play.effects.filter(outlived))
			if (e.source && e.source === c.play.concentration) c.play.concentration = null;
		c.play.effects = c.play.effects.filter((e) => !outlived(e));
		void saveCharacterToStore(c);
		toast(`${kind === 'long' ? 'Long' : 'Short'} rest — resources restored`);
	};
}
