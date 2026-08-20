/*
 * Effects & conditions on the sheet: the quick-pick catalog, adding/removing a runtime effect,
 * its round timer, and the condition list (with exhaustion, which is a condition with a level).
 *
 * "Conditions are merged into the Effects panel" is a design decision, not a coincidence — a
 * condition IS an effect of kind `apply_condition`, so ONE list is the source of truth for what is
 * currently modifying the character (docs/PLAN.md, roadmap 9). That is why they are one module.
 */
import type { Character, DeathCause } from '$lib/character/schema';
import type { ContentGraph } from '$lib/content/loader';
import { remainingRounds, type MenuKind } from '$lib/combat/helpers';

/** What the effects editor needs from the sheet around it. */
export interface EffectsHost {
	character: Character | null;
	graph: ContentGraph | null;
	round: number;
	overlay: { kind: MenuKind; top: number; left: number | null; right: number | null } | null;
	die(cause: DeathCause): void;
}

export class EffectsEditor {
	/* Accessor, not an object: a $derived field initialiser runs before a constructor parameter
	   property is assigned (same shape as TurnEconomy / FeatSlots). */
	constructor(private host: () => EffectsHost) {}

	// read). An empty effects column still registers the id, so mechanics can be authored incrementally.
	conditionList = $derived.by<{ id: string; label: string }[]>(() => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return [];
		return (
			graph
				.list('condition', { system })
				// leveled conditions (exhaustion, max_level>1) are a stepper, not a binary toggle — they
				// don't belong in this multi-select (they'd double-count with gatherExhaustion). D19.
				.filter((r) => Number(r.data.max_level ?? 1) <= 1)
				.map((r) => ({ id: r.id, label: r.data.name_en }))
		);
	});
	/** The exhaustion ladder height for this character's system (0 = no exhaustion row loaded → the
	 *  stepper hides). Data-driven cap (the row's `max_level`); a taller homebrew ladder Just Works. */
	exhaustionMax = $derived.by<number>(() => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return 0;
		const row = graph.list('condition', { system }).find((r) => r.id === 'exhaustion');
		return row ? Number(row.data.max_level ?? 1) : 0;
	});
	/** Set the exhaustion level, clamped to [0, max]. Play-state mutation (autosaves like HP). The TOP
	 *  of the ladder is lethal — RAW "You die if your Exhaustion level is 6" (2024 glossary; 2014's
	 *  level-6 row is likewise "Death"). The threshold is the DATA cap (`max_level`), so a homebrew
	 *  ladder of a different height still kills at its own top. */
	setExhaustion = (level: number): void => {
		const p = this.host().character?.play;
		if (!p) return;
		const max = this.exhaustionMax;
		p.exhaustion = Math.max(0, Math.min(max, Math.round(level)));
		if (max > 0 && p.exhaustion >= max) this.host().die('exhaustion');
	};
	/** A condition's rules text (English, consistent with the panel's other content labels), looked up
	 *  by id — the G2 info channel: the "attacks against you have advantage", concealed, auto-crit
	 *  parts a single-character sheet can't fold onto any stat still reach the player as reference. */
	conditionText = (id: string): string | null => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return null;
		const row = graph.list('condition', { system }).find((r) => r.id === id);
		const text = row ? String(row.data.text_en ?? '') : '';
		return text || null;
	};

	/** A condition's own effect tokens (its `effects` column) — what the panel renders as tags for an
	 *  applied condition, since the effect INSTANCE only carries `apply_condition:<id>`. So a Poisoned
	 *  row shows its disadvantage tags + the display-only `note:` mechanics, not a bare "Poisoned". */
	conditionTokens = (id: string): string[] => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return [];
		const row = graph.list('condition', { system }).find((r) => r.id === id);
		return row?.data.effects ?? [];
	};

	/** The "+" picker catalog — the `effects.csv` CONTENT type scoped to the character's edition
	 *  (user-extendable like all content), not a hardcoded preset list. A row's `duration_rounds`
	 *  is its default duration; blank falls back to the menu's duration picker. */
	effectCatalog = $derived.by(() => {
		const graph = this.host().graph;
		const system = this.host().character?.system;
		if (!graph || !system) return [];
		return graph.list('effect', { system }).map((r) => ({
			// B17: carry the catalog ref so an added effect resolves LIVE at derive (fixes propagate),
			// with the baked label/tokens kept as the orphan fallback.
			ref: r.effectiveId,
			label: r.data.name_en,
			tokens: r.data.effects,
			negative: r.data.negative,
			durationRounds: r.data.duration_rounds ?? null,
		}));
	});
	/** Duration (in rounds) applied to the NEXT effect added from the add-effect / custom menus.
	 *  0 = indefinite (lasts until the player removes it). Editable in the add-effect menu. */
	newEffectDuration = $state(10);
	addEffect = (spec: {
		label: string;
		tokens: string[];
		/** Buff (true, default) vs debuff (false) — drives the Buffs/Debuffs split. */
		positive?: boolean;
		/** Rounds it lasts; 0/omitted → the add-effect menu's `newEffectDuration`. */
		durationRounds?: number;
		/** B17: the catalog ref (effectiveId) when added from the "+" catalog — stored so derive
		 *  resolves the effect LIVE (fixes propagate); omitted for custom/GM effects (baked only). */
		ref?: string;
	}) => {
		const character = this.host().character;
		if (!character) return;
		const durationRounds = spec.durationRounds ?? this.newEffectDuration;
		// 0 / negative → indefinite: omit the duration fields entirely (schema: absent = until removed)
		const duration =
			durationRounds > 0
				? { durationRounds: Math.round(durationRounds), startedRound: this.host().round }
				: {};
		character.play.effects = [
			...character.play.effects,
			{
				iid: crypto.randomUUID(),
				label: spec.label,
				effects: spec.tokens,
				positive: spec.positive ?? true,
				...(spec.ref !== undefined ? { source: spec.ref } : {}),
				...duration,
			},
		];
		this.host().overlay = null;
	};
	/** Remove an active effect from the panel (the ✕). */
	removeEffect = (iid: string) => {
		const c = this.host().character;
		if (c) c.play.effects = c.play.effects.filter((e) => e.iid !== iid);
	};
	/** Set an active effect's remaining duration to an exact round count (typed into the panel field).
	 *  The typed number means "rounds from NOW" — the start is re-anchored to the current round.
	 *  0 / blank → indefinite: the duration fields are removed ("until removed"). */
	setEffectDuration = (iid: string, rounds: number) => {
		const c = this.host().character;
		if (!c) return;
		const n = Math.max(0, Math.round(rounds || 0));
		c.play.effects = c.play.effects.map((e) => {
			if (e.iid !== iid) return e;
			if (n === 0) {
				const { durationRounds: _d, startedRound: _s, ...rest } = e;
				return rest;
			}
			return { ...e, durationRounds: n, startedRound: this.host().round };
		});
	};
	/** Nudge an active effect's REMAINING duration by ±1 round from the panel. Dropping to 0 makes it
	 *  indefinite again (the duration fields are removed), so − past 1 == "until removed". */
	bumpEffectDuration = (iid: string, delta: number) => {
		const e = this.host().character?.play.effects.find((x) => x.iid === iid);
		const cur = e ? (remainingRounds(e, this.host().round) ?? 0) : 0;
		this.setEffectDuration(iid, cur + delta);
	};
}
