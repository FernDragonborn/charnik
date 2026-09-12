/*
 * Effect GATHERING — the first phase of deriveSheet, split out of derive.ts.
 *
 * Walks the character's build (species / sub-option / background / classes + their level-gated
 * features / feats / equipped+attuned items), its runtime play-state effects, and the exhaustion
 * level, collecting every active effect as {source, layer, tokens}. Guard evaluation and
 * `apply_condition` expansion happen LATER, in the ONE resolve stage (effects/resolver.ts) — in
 * dependency order — so this phase is a pure collect, no interpretation.
 */
import { ISSUE_KEY, isWeaponOwnBonus } from '$lib/effects/token-parser';
import { WEAPON_LIKE_ITEM_CATEGORIES } from '../content/schemas';
import { rowName, tokensOf, type ContentGraph, type LoadedRow } from '../content/loader';
import { resolveItem } from '../content/resolved-item';
import { needsAttunement } from './inventory';
import type { Character } from './schema';
import type { ActiveEffect, EffectIssue } from '../effects/token-parser';
import type { Layer } from '../rules/pipeline';

export interface GatherInput {
	character: Character;
	graph: ContentGraph;
	isActive: (row: LoadedRow) => boolean;
	/** Accumulators shared with deriveSheet (mutated in place): unresolved refs + content-health. */
	missing: string[];
	issues: EffectIssue[];
}
type ClassFeatureRow = ReturnType<ContentGraph['featuresForClass']>[number];
/** Per-class context a feature's gates read (bundled so `considerFeature` stays small). */
type ClassCtx = { level: number; classId: string; subclassId: string };

/**
 * Collects every active effect (species / class features / feats / items / runtime / exhaustion) as
 * {source, layer, tokens}. State (the accumulator + the shared missing/issues) lives in fields so
 * each source is a small method — was one 80-line closure-heavy function.
 * NOTE: guard evaluation + `apply_condition` expansion happen LATER, in the ONE resolve stage
 * (`resolveActiveEffects`) — in DEPENDENCY order, so guards gate a token BEFORE its condition expands.
 */
class EffectGatherer {
	private readonly active: ActiveEffect[] = [];
	private readonly character: Character;
	private readonly graph: ContentGraph;
	private readonly isActive: (row: LoadedRow) => boolean;
	private readonly missing: string[];
	private readonly issues: EffectIssue[];

	constructor(o: GatherInput) {
		this.character = o.character;
		this.graph = o.graph;
		this.isActive = o.isActive;
		this.missing = o.missing;
		this.issues = o.issues;
	}

	run(): ActiveEffect[] {
		const b = this.character.build;
		this.pushRow(this.resolve(b.species), 'feature');
		// species sub-option (subrace / lineage) — its ASI + traits cascade like the species' own
		this.pushRow(this.resolve(b.speciesOption), 'feature');
		this.pushRow(this.resolve(b.background), 'feature');
		for (const entry of b.classes) this.gatherClass(entry);
		// feats (incl. repeatable ones taken more than once → their effect applies each time)
		for (const featRef of b.feats) this.pushRow(this.resolve(featRef), 'feature');
		// RAW, both editions: an item that REQUIRES attunement confers nothing until it is attuned —
		// equipping it is not enough, and the `attunement` tag was read only to draw the button
		for (const inv of b.inventory) {
			const row = this.resolve(inv.item);
			if (!row) continue;
			const carried = inv.equipped || inv.attuned;
			if (!carried) continue;
			// resolved against its base (or the player's chosen one), so the tag read here is the MERGED
			// one — the same answer the inventory panel gets
			const attunementNeeded =
				row.type === 'item' && needsAttunement(resolveItem(this.graph, row, inv.base));
			if (!attunementNeeded || inv.attuned) this.pushRow(row, 'item');
		}
		this.gatherRuntimeEffects();
		this.gatherExhaustion();
		return this.active;
	}

	/** B15: a row whose file/source is disabled, or which lost a collision, is treated exactly like a
	 *  missing ref — flagged as unresolved, never silently applied and never a crash. */
	private resolve(ref: string | undefined): LoadedRow | undefined {
		if (!ref) return undefined;
		const row = this.graph.get(ref);
		if (!row || !this.isActive(row)) {
			if (ref) this.missing.push(ref);
			return undefined;
		}
		return row;
	}

	/**
	 * A row's tokens as the GLOBAL facts should see them.
	 *
	 * Everything a row carries is global except one case: a weapon-like item's own attack/damage
	 * bonus (D9). Letting a `+1` sword's `flat_bonus:attack+1` ride here put its bonus on every
	 * attack its owner made — fists included, and on the sword itself twice, since the roll adds this
	 * fold on top of a row `computeAttacks` had already folded it into — and it did so while the
	 * weapon was merely attuned in the pack. The rest of what a weapon grants while carried stays.
	 */
	private static globalTokens(row: LoadedRow): string[] {
		const tokens = tokensOf(row);
		if (row.type !== 'item' || !WEAPON_LIKE_ITEM_CATEGORIES.includes(row.data.category))
			return tokens;
		return tokens.filter((token) => !isWeaponOwnBonus(token));
	}

	/** Push a row's tokens as one active effect (skipping token-less rows). `classId` marks
	 *  class-borne effects so their `spellcasting_mod` reads THAT class's mod (SPEC4). */
	private pushRow(row: LoadedRow | undefined, layer: Layer, classId?: string): void {
		if (!row) return;
		const tokens = EffectGatherer.globalTokens(row);
		if (!tokens.length) return;
		this.active.push({
			source: rowName(row),
			layer,
			tokens,
			...(classId !== undefined ? { classId } : {}),
		});
	}

	// class + subclass: the class row's own tokens, its base features up to the class level, the chosen
	// subclass row, and that subclass's features. Features come from the ONE query owner
	// (graph.featuresForClass — D18) matching on class_id + edition, NOT source, so a user's PHB/homebrew
	// feature for an SRD class attaches (B26); the per-character gates are layered in `considerFeature`.
	private gatherClass(entry: Character['build']['classes'][number]): void {
		const classRow = this.resolve(entry.class);
		this.pushRow(classRow, 'feature', classRow?.id);
		const subclassRow = this.resolve(entry.subclass);
		this.pushRow(subclassRow, 'feature', classRow?.id);
		if (!classRow) return;
		const seen = new Set<string>(); // RV2: fold each (level, id, subclass) feature ONCE
		const ctx: ClassCtx = {
			level: entry.level,
			classId: classRow.id,
			subclassId: subclassRow?.type === 'subclass' ? subclassRow.id : '',
		};
		for (const f of this.graph.featuresForClass(classRow)) this.considerFeature(f, ctx, seen);
	}

	/** Apply one class feature if it passes the per-character gates (level ≤, exact system, active,
	 *  chosen subclass) and isn't a cross-source (level,id,subclass) duplicate (RV2 — first wins, rest
	 *  flagged; the collision is separately resolvable in Settings). */
	private considerFeature(f: ClassFeatureRow, ctx: ClassCtx, seen: Set<string>): void {
		if (Number(f.data.level) > ctx.level) return;
		if (!f.systems.includes(this.character.system)) return;
		if (!this.isActive(f)) return; // B15: a disabled/collision-lost feature row doesn't apply
		// base feature (no subclass_id) always applies; a subclass feature only for the chosen one
		const forSubclass = f.data.subclass_id;
		if (forSubclass && forSubclass !== ctx.subclassId) return;
		const key = `${f.data.id}:${f.data.level}:${forSubclass ?? ''}`;
		if (seen.has(key)) {
			this.issues.push({
				source: rowName(f),
				token: `class_feature:${f.data.id}`,
				key: ISSUE_KEY.duplicateClassFeature,
				detail: 'duplicate class feature across sources',
			});
			return;
		}
		seen.add(key);
		this.pushRow(f, 'feature', ctx.classId);
	}

	private gatherRuntimeEffects(): void {
		for (const eff of this.character.play.effects) {
			// B17: prefer the LIVE catalog row when the instance carries a ref (`source`) — so a fix to the
			// catalog row PROPAGATES and the name re-localizes. Fall back to the baked `effects`/`label` for
			// a catalog-less custom effect OR an orphaned ref (deleted/disabled); an orphan is flagged like
			// any missing ref (still applied from the bake, never silently dropped).
			const live = eff.source ? this.graph.get(eff.source) : undefined;
			const liveActive = live !== undefined && this.isActive(live);
			if (eff.source && !liveActive) this.missing.push(eff.source);
			const tokens = liveActive ? tokensOf(live) : eff.effects;
			const label = liveActive ? rowName(live) : eff.label;
			if (tokens.length) this.active.push({ source: label, layer: 'condition', tokens });
		}
	}

	/** EFX-EXH: exhaustion is a LEVEL (play.exhaustion 0-6), not a manually-applied condition — fold
	 *  the exhaustion condition's tokens ONCE when the level is >0. They scale via the `exhaustion` ctx
	 *  var (2024: -2×level on d20 tests, -5×level on speed). A token-less row (an unauthored edition,
	 *  e.g. 2014's ladder pending) is a no-op. */
	private gatherExhaustion(): void {
		if (this.character.play.exhaustion <= 0) return;
		// indexed lookup (byType via list) instead of a full graph.rows scan — derive re-runs on every
		// reactive play-state change, so scan only condition rows, edition-filtered.
		const row = this.graph
			.list('condition', { system: this.character.system })
			.find((r) => r.id === 'exhaustion' && this.isActive(r));
		const tokens = tokensOf(row);
		if (row && tokens.length)
			this.active.push({ source: rowName(row), layer: 'condition', tokens });
	}
}

/** Gather every active effect (species/items/runtime) as {source, layer, tokens}. */
export function gatherEffects(input: GatherInput): ActiveEffect[] {
	return new EffectGatherer(input).run();
}
