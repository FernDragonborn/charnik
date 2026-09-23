/*
 * The Features-panel subsystem of the Combat view-model: which of a character's features are shown,
 * which are lifted above the rest, and the presets that decide both in one press. Split out of
 * CombatVM the way the inventory and the panel layout are; CombatVM composes it as
 * `combat.featureView`, passing a getter for the reactive character and the gathered list.
 *
 * The rule the whole thing turns on: a preset WRITES the per-feature hidden list rather than
 * filtering past it. So there is ONE answer to "is this shown", a preset's effect reads back in the
 * same eyes a player toggles by hand, and undoing it is the same click either way — a filter that
 * kept its own parallel state would give a player two controls that disagree and no way to tell
 * which won.
 */
import { FEATURE_PRESET, type CharacterFeature, type FeaturePreset } from '$lib/character/features';
import type { Character } from '$lib/character/schema';

export class FeatureView {
	constructor(
		private getCharacter: () => Character | null,
		private getFeatures: () => CharacterFeature[],
	) {}

	private get ui(): Character['ui'] | undefined {
		return this.getCharacter()?.ui;
	}
	/* Both reads go through prototype GETTERS, not straight at the constructor parameters: a class
	   field initializer runs before the constructor assigns them, which TypeScript rightly refuses. */
	private get features(): CharacterFeature[] {
		return this.getFeatures();
	}

	/** Keyed by the ROW, so a feature a multiclass holds twice is one entry: a player hiding "Ability
	 *  Score Improvement" means all of them. */
	hidden = $derived(new Set<string>(this.ui?.featuresHidden ?? []));
	pinned = $derived(new Set<string>(this.ui?.featuresPinned ?? []));
	isHidden = (id: string): boolean => this.hidden.has(id);
	isPinned = (id: string): boolean => this.pinned.has(id);

	private setHidden = (ids: readonly string[]) => {
		const ui = this.ui;
		if (ui) ui.featuresHidden = [...ids];
	};

	toggleHidden = (id: string) => {
		const cur = this.ui?.featuresHidden ?? [];
		this.setHidden(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
	};
	togglePinned = (id: string) => {
		const ui = this.ui;
		if (!ui) return;
		const cur = ui.featuresPinned ?? [];
		ui.featuresPinned = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
	};

	/** The classes this character's features came from — what the menu offers to narrow to, and a
	 *  list rather than the build's own classes because a feature with no class is not narrowable. */
	classes = $derived([
		...new Set(this.features.map((f) => f.className).filter((n) => n !== undefined)),
	]);

	/**
	 * Apply one preset by writing the hidden list. `all` clears it; `newest` keeps only what the
	 * highest class level granted, so a player has room to learn what they just gained; `class`
	 * narrows the CLASS features to one class and leaves species, background and feats alone, because
	 * those are not a class's to filter.
	 *
	 * A PINNED feature survives every preset: pinning is the player saying "I always want this one",
	 * and a filter that overruled it would make two controls argue. The eye beside it still hides it
	 * by hand, so nothing becomes unreachable.
	 */
	applyPreset = (preset: FeaturePreset, className?: string) => {
		if (preset === FEATURE_PRESET.all) return this.setHidden([]);
		const features = this.features;
		const top = Math.max(...features.map((f) => f.at ?? 0), 0);
		const keeps = (f: CharacterFeature): boolean =>
			this.pinned.has(f.row.effectiveId) ||
			(preset === FEATURE_PRESET.newest
				? f.at === top
				: f.className === undefined || f.className === className);
		this.setHidden(features.filter((f) => !keeps(f)).map((f) => f.row.effectiveId));
	};

	/** What the panel renders: everything the player has not hidden. Pinning is a GROUPING and stays
	 *  the panel's own job — this says what exists, not where it sits. */
	visible = $derived(this.features.filter((f) => !this.hidden.has(f.row.effectiveId)));
}
