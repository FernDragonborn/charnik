/*
 * Spell casting — slot reservation, upcast evaluation, the spell's own effect tokens, and the
 * prepared toggle. One of the subsystems the combat view-model delegates to
 * (docs/internals/ui.md ▸ Splitting a large view). The rolls a cast makes are `rolls`
 * (`spell-cast-rolls.ts`), which reads what a slot adds back through this class.
 *
 * It reads the host through a narrow interface rather than importing the view-model class, so
 * nothing here depends on the rest of the sheet and there is no import cycle.
 */
import { toast } from 'svelte-sonner';
import { t, translator, type Translate } from '$lib/i18n';
import { sayText } from '$lib/util/say';
import { tokensOf, type ContentGraph } from '$lib/content/loader';
import { NOTE_KEY } from '$lib/combat/roll';
import { upcastPreview } from './spell-roll-name';
import type { Character } from '$lib/character/schema';
import type { ResourceDef } from '$lib/effects/facts';
import {
	durationToRounds,
	enhancementTokens,
	casterForSpell,
	canTogglePreparedFor,
	type DamagePart,
	type SpellRow,
	type MenuKind,
	type Attack,
	UNARMED_STRIKE_ID,
} from '$lib/combat/helpers';
import type { TurnEconomy } from './turn-economy.svelte';
import { slotToSpend, castableSlotLevels, pactPool, PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { withCastSlot, withSpellcastingMod } from '$lib/effects/context';
import type { ExprContext } from '$lib/effects/expression-evaluator';
import { evalUpcast } from '$lib/effects/upcast';
import { SpellCastRolls, type CastRollsHost, type UpcastFlatKind } from './spell-cast-rolls';

/** The outcome of reserving a spell slot: the slot key to spend (`null` = nothing to spend), or
 *  blocked because none remain. Two SHAPES rather than a `'blocked'` string beside the key, so a
 *  caller cannot read the sentinel as a slot — see `reserveSpellSlot`. */
type SlotReservation = { key: string | null } | { blocked: true };

/** How a cast was asked for. `weapon` is the one a magic-weapon buff lands on: a weapon id, or
 *  `null` once it is settled that there is none to touch. Absent means not asked yet. */
type CastOptions = { ritual?: boolean; slot?: number; pool?: string; weapon?: string | null };

/** What casting needs from the sheet around it. A narrow structural interface rather than the VM
 *  class, so this module does not import the thing that imports it. */
export interface CastingHost extends CastRollsHost {
	character: Character | null;
	graph: ContentGraph | null;
	round: number;
	economy: TurnEconomy;
	/** The pool half of a cast (FEAT-FREE-CAST) — what it takes to pay with one, and nothing else. */
	resources: {
		resourceSpent(id: string): number;
		useResource(id: string, max: number): boolean;
	};
	cantConcentrate: boolean;
	/** The attacks the sheet shows — the weapons a magic-weapon buff can be laid on. */
	attacks: Attack[];
	overlay: { kind: MenuKind; top: number; left: number | null; right: number | null } | null;
	removeLinkedEffect(ref: string): void;
}

export class SpellCasting {
	/** The rolls a cast makes. Built in the constructor, where `host` is already assigned. */
	private rolls: SpellCastRolls;
	constructor(private host: CastingHost) {
		this.rolls = new SpellCastRolls(host, this);
	}

	/** Casting applies the spell's OWN effect tokens (EFX-2): they become a runtime effect on self,
	 *  expiring per the spell's duration text; linked via `source: r.ref` so dropping/replacing
	 *  concentration (or re-casting = refresh) removes/replaces it. No tokens → no-op. */
	private applySpellEffect(r: SpellRow, slotLevel: number, weapon: string | null) {
		const c = this.host.character;
		const spell = this.host.graph?.get(r.ref);
		const tokens = tokensOf(spell);
		// Model C (CONCENTRATION-PLAN): a CONCENTRATION spell ALWAYS gets a carrier effect — even
		// token-less — so its duration is TIMED (the carrier owns the clock; `play.concentration` is a
		// ref to it, and the carrier expiring ends concentration). Without the token-less case a control
		// spell (Hold Person, Web…) gets no carrier and its concentration hangs until a long rest. A
		// NON-concentration spell with no tokens has nothing to track → still a no-op.
		// B3 (item 3): an hp_max upcast scales the magnitude of the effect the spell grants — Aid's base
		// `flat_bonus:hp_max+5` gets an ADDITIONAL `flat_bonus:hp_max+delta` per slot above base. hp_max
		// is a fold target, so the two tokens sum cleanly (no string-surgery over the base token).
		const hpMaxDelta = this.upcastFlatDelta(r, slotLevel, 'hp_max');
		// Magic Weapon: an `enhancement` upcast is the whole bonus (+1/+2/+3 by slot), scoped to the ONE
		// weapon the player touched — `cast` settles which before anything is spent.
		const enhance = this.upcastFlatDelta(r, slotLevel, 'enhancement');
		if (enhance > 0 && weapon === null)
			toast(t('combat.notice.noWeaponToEnchant', { name: r.name }));
		const effects = [
			...tokens,
			...(hpMaxDelta > 0 ? [`flat_bonus:hp_max+${hpMaxDelta}`] : []),
			...(enhance > 0 && weapon !== null ? enhancementTokens(enhance, weapon) : []),
		];
		if (!c || (!effects.length && !r.concentration)) return;
		this.host.removeLinkedEffect(r.ref); // re-cast refreshes instead of stacking a duplicate
		const rounds = this.carrierRounds(r, spell, slotLevel);
		c.play.effects = [
			...c.play.effects,
			{
				iid: crypto.randomUUID(),
				label: r.name,
				source: r.ref,
				effects,
				positive: true,
				...(rounds ? { durationRounds: rounds, startedRound: this.host.round } : {}),
			},
		];
	}

	/** The carrier effect's duration in ROUNDS. A `duration` upcast (an ABSOLUTE total — Hunter's Mark
	 *  8 h → 24 h) wins over the spell's base duration text; `inf` (permanent) → null (no expiry). No
	 *  duration upcast → the base `durationToRounds`. Units are the rounds canon (CONCENTRATION-PLAN §8). */
	private carrierRounds(
		r: SpellRow,
		spell: ReturnType<ContentGraph['get']>,
		slotLevel: number,
	): number | null {
		const base = spell?.type === 'spell' ? durationToRounds(String(spell.data.duration)) : null;
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res || res.kind !== 'duration') continue;
			if (res.isInfinite) return null; // permanent → no timer
			if (res.flat > 0) return res.flat; // absolute total rounds (0 = below first tier → keep base)
		}
		return base;
	}

	/** Reserve a leveled spell slot for a non-ritual cast (A17): the slot key to spend, `null` for
	 *  nothing to spend (cantrip / non-caster / ritual), or blocked (+ a toast) when none remain.
	 *  Reserve-before-commit so a block returns BEFORE the action economy is touched.
	 *  A typed result rather than a `'blocked'` STRING sentinel: in `string | null | 'blocked'` the
	 *  literal is swallowed by `string`, so nothing stopped a caller from forgetting the check. */
	private reserveSpellSlot(r: SpellRow, ritual: boolean, chosenLevel?: number): SlotReservation {
		const play = this.host.character?.play;
		if (ritual || !play) return { key: null };
		const spend = slotToSpend(
			r.level,
			this.host.sheet?.spellcasting.pools ?? [],
			play.spellSlotsSpent,
			chosenLevel,
		);
		if (spend && 'block' in spend) {
			toast(spend.block);
			return { blocked: true };
		}
		return { key: spend && 'key' in spend ? spend.key : null };
	}

	/** The pool a `cast({ pool })` names, or undefined when this character has no such resource — a
	 *  stale picker choice must not cast for free. */
	private poolFor(id: string): ResourceDef | undefined {
		return (this.host.sheet?.resources ?? []).find((pool) => pool.id === id);
	}

	/** What pays for this cast, settled BEFORE anything is committed: the slot key to spend later, or
	 *  `null` for a cast that spends no slot (cantrip / non-caster / ritual / a pool). `undefined` means
	 *  it cannot be paid for and the cast must not happen — the action economy is not touched, nothing
	 *  is applied, and whichever half refused has already said so.
	 *
	 *  A POOL (FEAT-FREE-CAST, "cast it once without a slot") spends HERE rather than reserving: unlike
	 *  a slot there is no level to resolve afterwards, so the unit is gone or the cast never happened. */
	private payForCast(
		r: SpellRow,
		ritual: boolean,
		opts?: { slot?: number; pool?: string },
	): { slot: string | null } | undefined {
		if (opts?.pool) {
			const pool = this.poolFor(opts.pool);
			if (!pool) return undefined;
			return this.host.resources.useResource(pool.id, pool.max) ? { slot: null } : undefined;
		}
		const reserved = this.reserveSpellSlot(r, ritual, opts?.slot);
		return 'blocked' in reserved ? undefined : { slot: reserved.key };
	}

	/** The slot LEVEL a cast resolves at (drives upcast, §4): a pact slot forces the cast up to the
	 *  pool's slot level; a leveled slot ("1".."9") casts at that level; no slot spent (cantrip /
	 *  ritual / free / non-caster) → the spell's own base level, delta 0 (N7). */
	private castSlotLevel(slot: string | null, baseLevel: number): number {
		if (slot === PACT_SLOT_KEY)
			return pactPool(this.host.sheet?.spellcasting.pools ?? [])?.spellLevel ?? baseLevel;
		return slot != null ? Number(slot) : baseLevel;
	}

	/** The ephemeral cast ctx for evaluating a spell's `upcast` (§4/§5): the post-derive sheet ctx
	 *  wrapped with the cast-only `{slot, spell_level}` vars, AND `spellcasting_mod` re-pointed at the
	 *  class the spell is CAST AS (`casterForSpell`) rather than the primary caster — so a formula
	 *  reading `spellcasting_mod` (an upcast that scales with the caster's ability) picks up the right
	 *  class's mod on a multiclass sheet (item 5, SPEC4). Falls back to the sheet's primary
	 *  `spellcasting_mod` when no class claims the spell. */
	private castCtxFor(r: SpellRow, base: ExprContext, slotLevel: number): ExprContext {
		const withSlot = withCastSlot(base, slotLevel, r.level);
		const caster = casterForSpell(this.host.sheet, r.ref);
		if (!caster) return withSlot;
		return withSpellcastingMod(withSlot, this.host.sheet?.abilities[caster.ability]?.mod ?? 0);
	}

	/** Evaluate a spell's `upcast` cell against its cast ctx at `slotLevel` — the ONE place the ephemeral
	 *  ctx is built, so the damage / duration / hp_max / temp_hp consumers below all read the same
	 *  evaluation. Empty only when there's no `upcast` (castCtx is always present now — upcast is a spell
	 *  mechanic, NOT gated on the auto-calc toggle; N6). Pure read; each caller picks
	 *  the kinds it cares about. */
	private evalUpcastAt(r: SpellRow, slotLevel: number): ReturnType<typeof evalUpcast> {
		const base = this.host.sheet?.castCtx;
		if (!r.upcast || !base) return [];
		return evalUpcast(r.upcast, this.castCtxFor(r, base, slotLevel));
	}

	/** The summed FLAT upcast value for one magnitude kind at a cast slot: the extra hit-point-max /
	 *  temp-HP a spell grants per slot above its base (Aid, False Life — a `delta` kind), or the whole
	 *  `enhancement` bonus a magic-weapon buff confers at this slot (Magic Weapon +1/+2/+3 — an
	 *  `absolute` kind, so the formula already gives the full value). Broken tokens degrade (toast),
	 *  never a wrong number (H11). */
	upcastFlatDelta(r: SpellRow, slotLevel: number, kind: UpcastFlatKind): number {
		let acc = 0;
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res) {
				if (res.raw.startsWith(kind))
					toast(t('combat.notice.upcastUnknown'), { description: res.error });
				continue;
			}
			if (res.kind === kind) acc += res.flat;
		}
		return acc;
	}

	/** The damage/heal upcast deltas as typed parts for a cast from `slotLevel` (item 2): evaluate the
	 *  spell's `upcast` cell against the ephemeral cast ctx (post-derive snapshot + {slot, spell_level})
	 *  and keep each damage/heal delta with its own type (`damage:cold:…` → a cold-typed delta the roll
	 *  path routes to the cold part). Empty when there's no `upcast` or the slot equals the base level
	 *  (castCtx is always present — upcast isn't gated on auto-calc). count/area/duration are handled
	 *  elsewhere. A zero delta (base slot) is dropped so it adds no phantom part. A broken formula
	 *  degrades (toast + base only, H11), never silently-wrong dice. */
	upcastDamageParts(r: SpellRow, slotLevel: number): DamagePart[] {
		const out: DamagePart[] = [];
		for (const res of this.evalUpcastAt(r, slotLevel)) {
			if ('error' in res) {
				toast(t('combat.notice.upcastUnknown'), { description: res.error });
				continue;
			}
			if ((res.kind !== 'damage' && res.kind !== 'heal') || res.combine !== 'delta') continue;
			if (Object.keys(res.pool).length === 0 && res.flat === 0) continue; // base slot → no delta
			out.push({ pool: res.pool, mod: res.flat, type: res.type ?? '' });
		}
		return out;
	}

	/** Every slot level this spell can be cast from right now (the upcast picker's options; a UI can
	 *  offer these and pass the choice as `cast(r, e, { slot })`). Empty = no choice (cantrip / single
	 *  option / no open slot). */
	castableSlots = (r: SpellRow): number[] =>
		castableSlotLevels(
			r.level,
			this.host.sheet?.spellcasting.pools ?? [],
			this.host.character?.play.spellSlotsSpent ?? {},
		);

	/** The pools a cast can be paid from instead of a slot — every named resource this character still
	 *  has a use in. FEAT-FREE-CAST: the sentence is Magic Initiate's "cast it once without a slot",
	 *  and several magic items say the same, but nothing in the data LINKS a pool to a spell. The
	 *  player is who knows, so the picker OFFERS and the player names it — the tracker's standing rule
	 *  (`AGENTS.md` ▸ a play-tracker surfaces and suggests). Narrowing this to a declared pool is a
	 *  later filter on the same control, not a different one.
	 *  A cantrip costs nothing, so it is never asked. */
	castablePools = (r: SpellRow): ResourceDef[] =>
		r.level === 0
			? []
			: (this.host.sheet?.resources ?? []).filter(
					(pool) => this.host.resources.resourceSpent(pool.id) < pool.max,
				);

	/** Whether this cast has more than one way to be PAID FOR — what the picker affordance asks.
	 *  `castableSlots` is empty for a single option rather than holding it, so a pool beside that one
	 *  implied slot is already a choice; the menu spells the implied option out as its own row. */
	hasCastChoice = (r: SpellRow): boolean =>
		this.castableSlots(r).length > 1 || this.castablePools(r).length > 0;

	/** The cast waiting on the weapon-picker (drives the `enchantweapon` overlay menu). */
	enchanting = $state<{ r: SpellRow; opts: CastOptions } | null>(null);
	/** What a magic-weapon buff can be laid on: each weapon the character attacks with, once. Magic
	 *  weapons are not filtered out — the rule is the player's to apply, and the app cannot tell. */
	get enchantableWeapons(): Attack[] {
		const seen = new Set<string>();
		return this.host.attacks.filter((a) => {
			if (a.id === UNARMED_STRIKE_ID || seen.has(a.id)) return false;
			seen.add(a.id);
			return true;
		});
	}
	/** A magic-weapon buff lands on ONE weapon, so which one is settled BEFORE anything is spent: with
	 *  a single weapon there is nothing to ask, with several the picker opens and the cast waits
	 *  (`null`), with none the cast goes ahead and says so. Any other spell passes straight through. */
	private settleWeapon(r: SpellRow, e: Event, opts: CastOptions): { weapon: string | null } | null {
		if (opts.weapon !== undefined) return { weapon: opts.weapon };
		if (this.upcastFlatDelta(r, opts.slot ?? r.level, 'enhancement') <= 0) return { weapon: null };
		const weapons = this.enchantableWeapons;
		if (weapons.length > 1) {
			this.enchanting = { r, opts };
			this.host.openMenu('enchantweapon', e);
			return null;
		}
		return { weapon: weapons[0]?.id ?? null };
	}
	/** Finish the waiting cast on the picked weapon, then close the picker. */
	enchantWith = (weaponId: string, e: Event) => {
		const pending = this.enchanting;
		if (!pending) return;
		this.host.overlay = null;
		this.enchanting = null;
		this.cast(pending.r, e, { ...pending.opts, weapon: weaponId });
	};

	/** The spell whose upcast slot-picker is open (drives the `upcast` overlay menu — item 1). */
	upcastSpell = $state<SpellRow | null>(null);
	/** Open the slot-picker for a leveled spell (the ⇡ affordance), anchored under the click. */
	openUpcast = (r: SpellRow, e: Event) => {
		this.upcastSpell = r;
		this.host.openMenu('upcast', e);
	};
	/** Cast the picker's spell at the chosen slot, then close the picker. */
	castAtSlot = (slot: number, e: Event) => {
		const r = this.upcastSpell;
		if (!r) return;
		this.host.overlay = null;
		this.cast(r, e, { slot });
	};
	/** Cast the picker's spell paid for by a POOL rather than a slot, then close the picker. */
	castFromPool = (pool: string, e: Event) => {
		const r = this.upcastSpell;
		if (!r) return;
		this.host.overlay = null;
		this.cast(r, e, { pool });
	};
	/** What casting `r` from `slotLevel` yields beyond its base, as one line. Empty at the base slot
	 *  or a non-scaling spell. The wording is `upcastPreview`'s; this only decides WHAT to preview. */
	castPreview = (r: SpellRow, slotLevel: number): string =>
		upcastPreview(this.evalUpcastAt(r, slotLevel));

	/** The whole ladder — every castable slot that adds something, one line each — so a player reads
	 *  what upcasting buys BEFORE opening the picker. `translate` is the caller's own lookup, which is
	 *  also what makes the tooltip follow a locale switch. Empty when no slot adds anything. */
	upcastLadder = (r: SpellRow, translate: Translate): string =>
		this.castableSlots(r)
			.map((slot) => ({ slot, preview: this.castPreview(r, slot) }))
			.filter(({ preview }) => preview)
			.map(({ slot, preview }) => translate(NOTE_KEY.upcastPreview, { values: { slot, preview } }))
			.join('\n');

	// casting a spell: damage/healing spells roll their dice; attack spells roll to hit. `opts.slot`
	// overrides the auto-lowest slot (the upcast picker, §6) — honoured or blocked, never downshifted.
	cast = (r: SpellRow, e: Event, opts: CastOptions = {}) => {
		const settled = this.settleWeapon(r, e, opts);
		if (!settled) return;
		const play = this.host.character?.play;
		// A17: casting SPENDS a leveled spell slot and is BLOCKED when none remain — UNLESS it's a
		// RITUAL cast (rituals cost no slot; only ritual-tagged spells qualify — SRD). A cantrip spends
		// nothing and a pure warlock spends a pact slot; the action-economy check below stays combat-only.
		const ritual = opts.ritual === true && r.ritualCast;
		const paid = this.payForCast(r, ritual, opts);
		if (!paid) return;
		const slot = paid.slot;
		// a spell costs its casting-time slot (action / bonus / reaction) when tracking combat
		if (!this.host.economy.trySpend(this.host.economy.ctSlot(r.castTimeIcon))) return;
		if (slot && play) play.spellSlotsSpent[slot] = (play.spellSlotsSpent[slot] ?? 0) + 1;
		// the slot LEVEL the spell is actually cast from drives upcast (§4).
		const slotLevel = this.castSlotLevel(slot, r.level);
		// a concentration spell becomes the active concentration (replacing any prior one, 5e rule);
		// the PRIOR concentration's cast-applied effect goes down with it. EXCEPT while raging — RAW: a
		// Barbarian can't maintain Concentration while the Rage is active, so the spell casts but never
		// establishes concentration (surfaced, not silently swallowed).
		if (r.concentration && this.host.character && this.host.cantConcentrate) {
			toast(t('combat.notice.noConcentration', { name: r.name }), {
				description: t('combat.notice.noConcentrationBody'),
			});
		} else if (r.concentration && this.host.character) {
			const prior = this.host.character.play.concentration;
			if (prior && prior !== r.ref) this.host.removeLinkedEffect(prior);
			this.host.character.play.concentration = r.ref;
		}
		this.applySpellEffect(r, slotLevel, settled.weapon);
		this.rolls.rollSpellCast(r, e, ritual, slotLevel);
	};

	/** How many instances this cast fires — Eldritch Blast's beams at level 5. A `count` upcast result
	 *  IS a volley, which the roller rolls (`×N`, one action, N records). It used to be a toast asking
	 *  the player to roll the rest by hand, because the per-instance roller did not exist yet. */
	volleyOf(r: SpellRow, slotLevel: number): number {
		for (const res of this.evalUpcastAt(r, slotLevel))
			if (!('error' in res) && res.kind === 'count' && res.flat > 1) return res.flat;
		return 1;
	}

	// tap a spell's prep dot to prepare/unprepare it (always-prepared can't be unset)
	togglePrepared = (r: SpellRow) => {
		if (!this.host.character) return;
		// by the REF, which is what a spell IS (`type:source:id`): matching on the bare id made two
		// same-id spells from two packs one spell, and the first entry always won — so tapping the prep
		// dot on one flipped the other and read as a no-op
		const sp = this.host.character.build.spells.find((s) => s.spell === r.ref);
		// A18-tail: per-class cap gate via the ONE shared seam (identical in the spellbook, D13)
		const res = canTogglePreparedFor({
			spells: this.host.character.build.spells,
			sheet: this.host.sheet,
			entry: sp,
			spellRef: r.ref,
			// the LEVEL decides it, not the chip that displays it — the chip is a translated label now
			isCantrip: r.level === 0,
		});
		if (!res.ok) {
			if (res.message) toast(sayText(res.message, translator()));
			return;
		}
		if (sp) sp.prepared = !sp.prepared;
	};
}
