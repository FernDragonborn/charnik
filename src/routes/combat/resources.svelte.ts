/*
 * The resource/rest subsystem of the Combat view-model: spell-slot pips, named resource pips (rage,
 * ki, item N/day…) and short/long rests (which recharge them + restore HP). All use the one
 * click-to-set pip model (pipClick). Split out of CombatVM so the consumables concern is one cohesive
 * unit; CombatVM composes it as `combat.resources`, passing getters for the reactive character + sheet.
 */
import { toast } from 'svelte-sonner';
import { saveCharacterToStore } from '$lib/character/store.svelte';
import { pipClick } from '$lib/combat/helpers';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';

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
		toast(`${name} used`, { description: `${max - after} of ${max} left` });
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
		for (const r of sheet.resources)
			if (r.recharge === 'short' || (kind === 'long' && r.recharge === 'long')) spent[r.id] = 0;
		c.play.resourcesSpent = spent;
		if (kind === 'long') {
			c.play.spellSlotsSpent = {};
			c.play.hp = { ...c.play.hp, current: c.play.hp.max ?? sheet.maxHp.value, temp: 0 };
		} else {
			const slots = { ...c.play.spellSlotsSpent };
			delete slots.pact; // warlock pact slots return on a short rest
			c.play.spellSlotsSpent = slots;
		}
		const outlived = (e: (typeof c.play.effects)[number]) =>
			e.durationRounds != null && (kind === 'long' || e.durationRounds <= 600);
		for (const e of c.play.effects.filter(outlived))
			if (e.source && e.source === c.play.concentration) c.play.concentration = null;
		c.play.effects = c.play.effects.filter((e) => !outlived(e));
		void saveCharacterToStore(c);
		toast(`${kind === 'long' ? 'Long' : 'Short'} rest — resources restored`);
	};
}
