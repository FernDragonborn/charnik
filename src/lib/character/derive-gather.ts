/*
 * Effect GATHERING — the first phase of deriveSheet, split out of derive.ts.
 *
 * Walks the character's build (species / sub-option / background / classes + their level-gated
 * features / feats / equipped+attuned items), its runtime play-state effects, and the exhaustion
 * level, collecting every active effect as {source, layer, tokens}. Guard evaluation and
 * `apply_condition` expansion happen LATER, in the ONE resolve stage (effects/resolver.ts) — in
 * dependency order — so this phase is a pure collect, no interpretation.
 */
import { ISSUE_KEY, isWeaponOwnBonus, splitGuard } from '$lib/effects/token-parser';
import { withItemChoice, withOptionChoice } from '$lib/effects/token-answers';
import { FORM_SHEDS, FORM_WORD } from '$lib/effects/token-words';
import { WEAPON_LIKE_ITEM_CATEGORIES } from '../content/schemas';
import { conditionRows } from '../content/states';
import { rowName, tokensOf, type ContentGraph, type LoadedRow } from '../content/loader';
import { resolveItem } from '../content/resolved-item';
import { instanceName } from '../content/item-instance';
import { optionNamed, readPick } from '../content/options';
import { needsAttunement } from './inventory';
import { formStatTokens } from './forms';
import { heldOptions } from './features';
import { FORM_SPECIES, type Character } from './schema';
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
/** What the row an effect came from still has to say about it after its tokens are read: which class
 *  carries it (so `spellcasting_mod` reads THAT class's mod, SPEC4), and the two answers a carried
 *  item's row asked its owner for. Absent fields mean "this row asked nothing". */
/** Where a row's effect came from. `name` is what the trace calls it when that is not the row's own
 *  name — a carried +N item is "Shield +2", never the book's "Shield, +1, +2, or +3" — and `origin`
 *  is the inventory row it is carried on. */
type RowOrigin = {
	classId?: string;
	itemBonus?: number;
	itemChoice?: string;
	/** The answer one pick of an option was given — the cantrip an Agonizing Blast names. */
	optionAnswer?: string;
	name?: string;
	origin?: string;
};

/**
 * Collects every active effect (species / class features / feats / items / runtime / exhaustion) as
 * {source, layer, tokens}. State (the accumulator + the shared missing/issues) lives in fields so
 * each source is a small method — was one 80-line closure-heavy function.
 * NOTE: guard evaluation + `apply_condition` expansion happen LATER, in the ONE resolve stage
 * (`resolveActiveEffects`) — in DEPENDENCY order, so guards gate a token BEFORE its condition expands.
 */
class EffectGatherer {
	private readonly active: ActiveEffect[] = [];
	/** What came from the species, and what came from a carried item with the row it is on — the
	 *  two things a form's rules may set aside, which turn on a token's SOURCE and not its target. */
	private readonly fromSpecies = new Set<ActiveEffect>();
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
		// species sub-option (subrace / lineage) — its ASI + traits cascade like the species' own
		for (const ref of [b.species, b.speciesOption]) {
			const pushed = this.pushRow(this.resolve(ref), 'feature');
			if (pushed) this.fromSpecies.add(pushed);
		}
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
			if (attunementNeeded && !inv.attuned) continue;
			this.pushRow(row, 'item', {
				// spread, not assign: an unanswered question is an ABSENT field, and the two answers
				// are independent — a +2 armour may still be waiting to be told its damage type
				...(inv.bonus !== undefined ? { itemBonus: inv.bonus } : {}),
				...(inv.choice !== undefined ? { itemChoice: inv.choice } : {}),
				...this.instanceNameOf(row, inv),
				origin: inv.iid,
			});
			// the variety this instance is, where the row's answers are rows: its tokens fold beside the
			// item's own, under the variety's name, and an unanswered row grants none of them
			const variety = optionNamed(this.graph, row, inv.choice);
			if (variety && this.isActive(variety)) this.pushRow(variety, 'item', { origin: inv.iid });
		}
		this.gatherRuntimeEffects();
		this.gatherExhaustion();
		return this.inForm();
	}

	/**
	 * What a form the character is in sets aside. Its rules are the granting feature's own `form`
	 * sentences, read here off the tokens already gathered, because the facts they become are built
	 * from this very list — a guard on one of these two sentences is not weighed.
	 *
	 * `sheds:species` leaves the species' traits behind (SRD 5.2.1 lists what is retained, and a
	 * species trait is not on the list) unless the table keeps them (`ui.formSpecies`).
	 * `worn_only` leaves a carried item working only where the form wears it (`play.form.worn`):
	 * both editions' "equipment that merges with the form has no effect".
	 */
	private inForm(): ActiveEffect[] {
		const form = this.character.play.form;
		if (!form) return this.active;
		const says = (sentence: string): boolean =>
			this.active.some((effect) =>
				effect.tokens.some(
					(token) => splitGuard(token).token.trim() === `form:${form.id}:${sentence}`,
				),
			);
		const sheds =
			says(`${FORM_WORD.sheds}:${FORM_SHEDS.species}`) &&
			this.character.ui.formSpecies !== FORM_SPECIES.kept;
		const wornOnly = says(FORM_WORD.wornOnly);
		return this.active.filter((effect) => {
			if (sheds && this.fromSpecies.has(effect)) return false;
			return !(wornOnly && effect.origin !== undefined && !form.worn.includes(effect.origin));
		});
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

	/** The trace's name for a carried +N instance, as an origin field — empty for any other row. */
	private instanceNameOf(
		row: LoadedRow,
		inv: Character['build']['inventory'][number],
	): { name?: string } {
		if (row.type !== 'item') return {};
		// the core's sources are English row names, so the instance is named in English too
		const naming = { graph: this.graph, locale: 'en' };
		const name = instanceName(naming, row, inv);
		return name === undefined ? {} : { name };
	}

	/** Push a row's tokens as one active effect (skipping token-less rows), and hand it back. */
	private pushRow(
		row: LoadedRow | undefined,
		layer: Layer,
		from: RowOrigin = {},
	): ActiveEffect | undefined {
		if (!row) return undefined;
		// the answer is substituted BEFORE the token is parsed, so the parse cache never holds a
		// template and every consumer downstream reads a finished token (`token-answers.ts`)
		const tokens = withOptionChoice(
			withItemChoice(EffectGatherer.globalTokens(row), from.itemChoice),
			from.optionAnswer,
		);
		if (!tokens.length) return undefined;
		const effect: ActiveEffect = {
			source: from.name ?? rowName(row),
			layer,
			...(from.classId !== undefined ? { classId: from.classId } : {}),
			...(from.itemBonus !== undefined ? { itemBonus: from.itemBonus } : {}),
			...(from.origin !== undefined ? { origin: from.origin } : {}),
			tokens,
		};
		this.active.push(effect);
		return effect;
	}

	// class + subclass: the class row's own tokens, its base features up to the class level, the chosen
	// subclass row, and that subclass's features. Features come from the ONE query owner
	// (graph.featuresForClass — D18) matching on class_id + edition, NOT source, so a user's PHB/homebrew
	// feature for an SRD class attaches (B26); the per-character gates are layered in `considerFeature`.
	private gatherClass(entry: Character['build']['classes'][number]): void {
		const classRow = this.resolve(entry.class);
		// one origin for both rows: a subclass's tokens read the CLASS's casting mod, and a class row
		// that did not resolve leaves the field absent rather than present-and-undefined
		const from: RowOrigin = classRow ? { classId: classRow.id } : {};
		this.pushRow(classRow, 'feature', from);
		const subclassRow = this.resolve(entry.subclass);
		this.pushRow(subclassRow, 'feature', from);
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
		this.pushRow(f, 'feature', { classId: ctx.classId });
		this.gatherHeldOptions(f, ctx);
	}

	/** What the character chose of a feature that asks: each option's own tokens, at the feature's
	 *  layer and under its class. A pick that names no row is reported like any missing ref. */
	private gatherHeldOptions(f: ClassFeatureRow, ctx: ClassCtx): void {
		const picks = this.character.build.options;
		const held = heldOptions(this.graph, f, picks);
		for (const pick of picks[f.id] ?? []) {
			const { id } = readPick(pick);
			if (!held.some((option) => option.row.id === id)) this.missing.push(`option:${id}`);
		}
		for (const { row, answer } of held)
			if (this.isActive(row))
				this.pushRow(row, 'feature', {
					classId: ctx.classId,
					...(answer ? { optionAnswer: answer } : {}),
				});
	}

	private gatherRuntimeEffects(): void {
		for (const eff of this.character.play.effects) {
			// B17: prefer the LIVE catalog row when the instance carries a ref (`source`) — so a fix to the
			// catalog row PROPAGATES and the name re-localizes. Fall back to the baked `effects`/`label` for
			// a catalog-less custom effect OR an orphaned ref (deleted/disabled); an orphan is flagged like
			// any missing ref (still applied from the bake, never silently dropped).
			// Only a CATALOG entry's tokens are read live. A cast's carrier names its SPELL as the source,
			// and what the cast baked — an upcast's extra `hp_max`, the weapon a Magic Weapon touched — is
			// not in the spell row at all, so reading the row would drop exactly what the slot bought.
			// A FORM's carrier names its stat block, and that row IS the whole of what the form does, so
			// it is read live like a catalog entry: a corrected stat block reaches a druid already shaped.
			const live = eff.source ? this.graph.get(eff.source) : undefined;
			const liveActive = live !== undefined && this.isActive(live);
			if (eff.source && !liveActive) this.missing.push(eff.source);
			const tokens = !liveActive
				? eff.effects
				: live.type === 'effect'
					? tokensOf(live)
					: live.type === 'monster'
						? formStatTokens(live)
						: eff.effects;
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
		const row = conditionRows(this.graph, this.character.system).find(
			(r) => r.id === 'exhaustion' && this.isActive(r),
		);
		const tokens = tokensOf(row);
		if (row && tokens.length)
			this.active.push({ source: rowName(row), layer: 'condition', tokens });
	}
}

/** Gather every active effect (species/items/runtime) as {source, layer, tokens}. */
export function gatherEffects(input: GatherInput): ActiveEffect[] {
	return new EffectGatherer(input).run();
}
