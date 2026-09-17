/*
 * Spell casting — slot reservation, upcast evaluation, the spell's own effect tokens, the
 * attack/save/damage rolls a cast produces, and the prepared toggle. One of the subsystems the
 * combat view-model delegates to (§7.2).
 *
 * It reads the host through a narrow interface rather than importing the view-model class, so
 * nothing here depends on the rest of the sheet and there is no import cycle.
 */
import { toast } from 'svelte-sonner';
import { t, translator, type Translate } from '$lib/i18n';
import { sayText, type SaidText } from '$lib/util/say';
import { tokensOf, type ContentGraph } from '$lib/content/loader';
import { rollPool } from '$lib/rules/dice';
import { NOTE_KEY, nameFields, type RollName } from '$lib/combat/roll';
import {
	SPELL_OUTCOME,
	saidNote,
	spellRollName,
	upcastPreview,
	type SpellOutcomeKind,
} from './spell-roll-name';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import type { SpellcastingClass } from '$lib/character/spellcasting';
import {
	wantsTray,
	durationToRounds,
	netAdvantage,
	NO_ROLL_EFFECTS,
	type RollEffects,
	enhancementTokens,
	casterForSpell,
	canTogglePreparedFor,
	formatDamageParts,
	rollDamageParts,
	dealsDamage,
	dieModsOf,
	type DamagePart,
	type DamagePartSpec,
	type SpellRow,
	type MenuKind,
} from '$lib/combat/helpers';
import type { RollSpec, RollJournal } from './roll-journal.svelte';
import type { TurnEconomy } from './turn-economy.svelte';
import { slotToSpend, castableSlotLevels, pactPool, PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { withCastSlot, withSpellcastingMod } from '$lib/effects/context';
import type { ExprContext } from '$lib/effects/expression-evaluator';
import { evalUpcast, combinePools } from '$lib/effects/upcast';

/** The upcast contribution to ONE cast: the folded damage/heal deltas as typed parts (item 2 —
 *  `damage:cold:…` routes to the cold part), the slot it came out of, and the provenance the roll
 *  records about it (item 4). */
type UpcastCast = {
	deltas: DamagePart[];
	/** The slot it was cast from, when that is ABOVE the spell's own level. Absent at the base slot,
	 *  which is what decides whether the roll's name carries a "(slot N)" at all. */
	upcastSlot?: number;
	/** The roll's provenance as FACTS — said at the card, never written into `log.jsonl` as English
	 *  (`internals/roller.md` ▸ Conventions). */
	noteParts: SaidText[];
};

/** The outcome of reserving a spell slot: the slot key to spend (`null` = nothing to spend), or
 *  blocked because none remain. Two SHAPES rather than a `'blocked'` string beside the key, so a
 *  caller cannot read the sentinel as a slot — see `reserveSpellSlot`. */
type SlotReservation = { key: string | null } | { blocked: true };

/** What casting needs from the sheet around it. A narrow structural interface rather than the VM
 *  class, so this module does not import the thing that imports it. */
export interface CastingHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	graph: ContentGraph | null;
	round: number;
	journal: RollJournal;
	economy: TurnEconomy;
	cantConcentrate: boolean;
	overlay: { kind: MenuKind; top: number; left: number | null; right: number | null } | null;
	effectsFor(key: string, scopes?: Set<string>): RollEffects;
	removeLinkedEffect(ref: string): void;
	openRoll(spec: RollSpec, e: Event): void;
	openMenu(kind: MenuKind, e: Event): void;
}

/** What a cast is IN SCOPE of, so a bonus can name one spell (`flat_bonus:damage.eldritch_blast+3`,
 *  Agonizing Blast) instead of every roll the character makes. The spell's own id — the same
 *  vocabulary a weapon's id and its tags use, because a scope is a name, not an enum. */
const spellScopes = (r: SpellRow): Set<string> => new Set([r.id]);

export class SpellCasting {
	constructor(private host: CastingHost) {}

	/** Casting applies the spell's OWN effect tokens (EFX-2): they become a runtime effect on self,
	 *  expiring per the spell's duration text; linked via `source: r.ref` so dropping/replacing
	 *  concentration (or re-casting = refresh) removes/replaces it. No tokens → no-op. */
	private applySpellEffect(r: SpellRow, slotLevel: number) {
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
		// Item 7 (Magic Weapon): an `enhancement` upcast is the whole magic-weapon bonus (+1/+2/+3 by
		// slot). The engine has no per-instance weapon target, so the buff is spawned as WEAPON-SCOPED
		// flat_bonus:attack/damage (melee+ranged → every weapon, but NOT spell attacks); the scope also
		// routes the flat through computeAttacks' scoped-fold (rollEffectsFor skips weapon-scoped flats).
		// Limitation: it lands on ALL the caster's weapons, not just the one touched (per-instance targeting
		// is the deferred roller work) — surfaced as a labelled effect the player sees.
		const enhance = this.upcastFlatDelta(r, slotLevel, 'enhancement');
		const effects = [
			...tokens,
			...(hpMaxDelta > 0 ? [`flat_bonus:hp_max+${hpMaxDelta}`] : []),
			...(enhance > 0 ? enhancementTokens(enhance) : []),
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
	 *  nothing to spend (cantrip / pure-pact / ritual), or blocked (+ a toast) when none remain.
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

	/** The slot LEVEL a cast resolves at (drives upcast, §4): a pact slot forces the cast up to the
	 *  pool's slot level; a leveled slot ("1".."9") casts at that level; no slot spent (cantrip /
	 *  ritual / free / non-caster) → the spell's own base level, delta 0 (N7). */
	private castSlotLevel(slot: string | null, baseLevel: number): number {
		if (slot === PACT_SLOT_KEY)
			return pactPool(this.host.sheet?.spellcasting.pools ?? [])?.spellLevel ?? baseLevel;
		return slot != null ? Number(slot) : baseLevel;
	}

	/** The roll half of a cast: an attack spell rolls its TO-HIT (attack-keyed effects) then queued
	 *  damage; a damage/heal spell rolls its dice (auto = healing + spellcasting mod); a no-roll cast
	 *  logs a marker. Uses the class the spell is cast AS (A18), not classes[0]. */
	/** Attack spell (r.resolution === 'hit'): roll the TO-HIT (attack-keyed effects) then its damage — tray
	 *  chains them (to-hit now, damage queued), instant folds both into one 3-line entry. */
	/** A spell's typed damage parts for the roll path (item 2): base parts (`r.damageParts`) with the
	 *  upcast deltas folded in BY TYPE — an untyped delta (`damage:per_slot`) onto the primary part, a
	 *  typed one (`damage:cold:per_slot` — Ice Knife) onto the part sharing its type, or as its OWN new
	 *  part when the base can't supply that type (N4/N9: Web adds fire to a fire-less base). `primaryFx`
	 *  (damage effects, or the heal's spellcasting-mod flat) rides the PRIMARY part only — RAW adds a
	 *  damage bonus / the ability mod once, to the base, never to a second type's dice. */
	private spellDamageParts(
		r: SpellRow,
		primaryFx: RollEffects,
		deltas: DamagePart[],
	): DamagePartSpec[] {
		const parts: DamagePart[] = r.damageParts.map((p) => ({
			pool: { ...p.pool },
			mod: p.mod,
			type: p.type,
		}));
		for (const d of deltas) {
			const idx = d.type ? parts.findIndex((p) => p.type === d.type) : 0;
			const hit = idx >= 0 ? parts[idx] : undefined;
			if (hit) {
				const merged = combinePools(hit.pool, hit.mod, d.pool, d.mod);
				parts[idx] = { pool: merged.pool, mod: merged.flat, type: hit.type };
			} else parts.push({ pool: { ...d.pool }, mod: d.mod, type: d.type });
		}
		return parts.map((p, i) => ({
			dice: p.pool,
			mod: p.mod + (i === 0 ? primaryFx.flat : 0),
			type: p.type,
			...(i === 0 ? { bonusDice: primaryFx.bonusDice, mods: primaryFx } : {}),
		}));
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
	private upcastFlatDelta(
		r: SpellRow,
		slotLevel: number,
		kind: 'hp_max' | 'temp_hp' | 'enhancement',
	): number {
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
	private upcastDamageParts(r: SpellRow, slotLevel: number): DamagePart[] {
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

	private rollSpellAttack(
		r: SpellRow,
		e: Event,
		caster: SpellcastingClass,
		cast: { up: UpcastCast; times: number },
	): void {
		const { up, times } = cast;
		const scopes = spellScopes(r);
		const fx = this.host.effectsFor('attack', scopes);
		const dmgFx = this.host.effectsFor('damage', scopes);
		const toHit = caster.attack.value + fx.flat;
		const parts = this.spellDamageParts(r, dmgFx, up.deltas);
		const hasDmg = dealsDamage(parts);
		// The spell's own name and nothing appended: the card already says TO HIT above the number, so
		// "(spell attack)" restated in the label what the row's own captions say — and it said it twice
		// over on an action that throws more than once. A weapon attack has always logged just its name.
		const label = { text: r.name };
		if (wantsTray(e)) {
			this.host.openRoll(
				{
					// the NAME as fields, never a finished sentence: the tray carries the key and its values
					// into the recorded row, so a roll sent through the tray reads in the language the log is
					// READ in — the same record the instant path below writes
					...nameFields(label),
					test: {
						dice: { 20: 1 },
						mod: toHit,
						advantage: netAdvantage(fx),
						bonusDice: fx.bonusDice,
						mods: dieModsOf(fx),
					},
					...(hasDmg ? { damage: parts } : {}),
					// the tray's note is an editable PILL — the moment provenance lands there it is the
					// player's own text, so it is said once here rather than carried as facts
					...(saidNote(up.noteParts) ? { note: saidNote(up.noteParts) } : {}),
					...(times > 1 ? { times } : {}),
				},
				e,
			);
		} else {
			// N beams = N separate attacks, each with its own to-hit and its own damage — one action, so
			// one toast, N log lines. This used to roll ONE and ask the player to roll the rest by hand.
			this.host.journal.pushVolley(
				label,
				times,
				() => ({
					r: rollPool({ 20: 1 }, { ...fx, mod: toHit, advantage: netAdvantage(fx) }),
					...(hasDmg ? { damage: rollDamageParts(parts) } : {}),
				}),
				up.noteParts,
			);
		}
	}

	/** The typed roll parts + kind label for a non-attack cast: a `save` deals damage, `auto` heals,
	 *  `temp` grants temporary HP. A DICE heal (Cure Wounds "1d8 + mod") adds the spellcasting mod; a
	 *  FLAT heal (Heal's 70) and temp HP (False Life) do NOT — in SRD the ability mod rides dice-valued
	 *  HEALING only (item 6). Damage effects never ride a heal / temp-HP roll, so its "primary fx" is
	 *  just that mod (0 for temp) as a flat. temp HP scales via its OWN `temp_hp` upcast delta, damage /
	 *  heal via the typed damage/heal delta pool (item 3). */
	private spellOutcomeParts(
		r: SpellRow,
		caster: SpellcastingClass | undefined,
		up: UpcastCast,
		slotLevel: number,
	): { parts: DamagePartSpec[]; kind: SpellOutcomeKind } {
		const heal = r.resolution === 'auto';
		const temp = r.resolution === 'temp';
		const healDice = r.damageParts.some((p) => Object.keys(p.pool).length > 0);
		const healMod =
			heal && healDice && caster ? (this.host.sheet?.abilities[caster.ability]?.mod ?? 0) : 0;
		const primaryFx: RollEffects =
			heal || temp
				? { ...NO_ROLL_EFFECTS, flat: healMod }
				: this.host.effectsFor('damage', spellScopes(r));
		const tempDelta = temp ? this.upcastFlatDelta(r, slotLevel, 'temp_hp') : 0;
		const deltas = temp ? (tempDelta ? [{ pool: {}, mod: tempDelta, type: '' }] : []) : up.deltas;
		return {
			parts: this.spellDamageParts(r, primaryFx, deltas),
			kind: temp ? SPELL_OUTCOME.tempHp : heal ? SPELL_OUTCOME.healing : SPELL_OUTCOME.damage,
		};
	}

	private rollSpellCast(r: SpellRow, e: Event, ritual: boolean, slotLevel: number): void {
		const caster =
			casterForSpell(this.host.sheet, r.ref) ?? this.host.sheet?.spellcasting.classes[0];
		// the upcast contribution + its provenance tag (B8): when actually upcast, the suffix names the
		// slot AND what it added ("(slot 5 · +2d6)") — reusing castPreview — so the roll log / toast
		// explains the boosted total instead of a bare number.
		const preview = slotLevel > r.level ? this.castPreview(r, slotLevel) : '';
		const deltas = this.upcastDamageParts(r, slotLevel);
		// item 4: a fuller provenance line for the roll log — the boosted dice split into base + upcast,
		// so a bigger total is explained ("8d6 fire base + 2d6 fire @ slot 5"), not just tagged with the slot.
		// a damage string the parse could not fully read is a CONTENT defect, and it rides the same
		// provenance line rather than waiting to be noticed as a total that came out short
		const unread = r.damageParts.flatMap((p) => p.issues ?? []);
		const noteParts: SaidText[] = [
			...(deltas.length && r.damageParts.length
				? [
						{
							key: NOTE_KEY.upcast,
							values: {
								base: formatDamageParts(r.damageParts),
								added: formatDamageParts(deltas),
								slot: slotLevel,
							},
						},
					]
				: []),
			...(preview ? [{ key: NOTE_KEY.upcastPreview, values: { preview } }] : []),
			...(unread.length
				? [{ key: NOTE_KEY.damageUnread, values: { fragments: { list: unread } } }]
				: []),
		];
		const up: UpcastCast = {
			deltas,
			...(slotLevel > r.level ? { upcastSlot: slotLevel } : {}),
			noteParts,
		};
		if (r.resolution === 'hit' && caster) {
			this.rollSpellAttack(r, e, caster, { up, times: this.volleyOf(r, slotLevel) });
			return;
		}
		const { parts, kind } = this.spellOutcomeParts(r, caster, up, slotLevel);
		if (parts.some((p) => Object.keys(p.dice).length > 0 || p.mod !== 0)) {
			this.rollDamageEntry(spellRollName(r.name, kind, up.upcastSlot), parts, e, up.noteParts);
		} else {
			// a cast with no roll (buff/utility): a bare log marker, not a rolled total. The spell's own
			// name is DATA and rides as a value; whether it was a ritual picks the whole phrase, because
			// a parenthetical tacked onto a translated sentence is not one a translator can move.
			const suffix = ritual ? ' (ritual)' : '';
			this.host.journal.logMarker({
				text: `Cast ${r.name}${suffix}`,
				key: ritual ? 'combat.log.castRitual' : 'combat.log.cast',
				values: { name: r.name },
			});
			toast(t('combat.notice.castSpell', { name: r.name, suffix }));
		}
	}

	/** Roll a spell's damage/heal from its typed parts: the FIRST part is the primary (rolled + shown as
	 *  the entry); the rest are typed damage lines under it (Ice Knife's cold under its piercing). A tray
	 *  intent (`wantsTray(e)` — Shift-click) opens the prefilled tray instead of rolling instantly
	 *  (queuing the rest as its follow-up). */
	private rollDamageEntry(
		name: RollName,
		parts: DamagePartSpec[],
		e: Event,
		noteParts: SaidText[],
	): void {
		const [primary, ...rest] = parts;
		if (!primary) return;
		if (wantsTray(e)) {
			// EVERY part is damage — there is no d20 here. The tray used to put the primary part on the
			// pool it built the to-hit from, which under the roller's line model would give a Fireball an
			// advantage toggle and a to-hit total.
			const note = saidNote(noteParts);
			// a spell's NAME is data and the phrase around it is a key — both travel, on this path too
			this.host.journal.prefill({
				...nameFields(name),
				damage: parts,
				...(note ? { note } : {}),
			});
			this.host.openMenu('dice', e);
		} else {
			this.host.journal.pushRoll(
				// a spell's NAME is DATA — a content row's own word; the phrase around it is a key
				name,
				rollPool(primary.dice, {
					...(primary.mods ?? {}),
					mod: primary.mod,
					...(primary.bonusDice ? { bonusDice: primary.bonusDice } : {}),
				}),
				rest.length ? rollDamageParts(rest) : undefined,
				noteParts,
			);
		}
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
	cast = (r: SpellRow, e: Event, opts?: { ritual?: boolean; slot?: number }) => {
		const play = this.host.character?.play;
		// A17: casting SPENDS a leveled spell slot and is BLOCKED when none remain — UNLESS it's a
		// RITUAL cast (rituals cost no slot; only ritual-tagged spells qualify — SRD). Cantrips + pure
		// pact casters spend nothing; the action-economy check below stays combat-only.
		const ritual =
			opts?.ritual === true && r.ritual && (this.host.sheet?.spellcasting.ritualCasting ?? false);
		const reserved = this.reserveSpellSlot(r, ritual, opts?.slot);
		if ('blocked' in reserved) return;
		const slot = reserved.key;
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
		this.applySpellEffect(r, slotLevel);
		this.rollSpellCast(r, e, ritual, slotLevel);
	};

	/** How many instances this cast fires — Eldritch Blast's beams at level 5. A `count` upcast result
	 *  IS a volley, which the roller rolls (`×N`, one action, N records). It used to be a toast asking
	 *  the player to roll the rest by hand, because the per-instance roller did not exist yet. */
	private volleyOf(r: SpellRow, slotLevel: number): number {
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

	// attacks (equipped weapons + Unarmed Strike) — pure builder in helpers
}
