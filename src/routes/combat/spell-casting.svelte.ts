/*
 * Spell casting on the sheet — what a slot adds as the panels and the roller read it, the pickers a
 * cast can open (which slot, which pool, which weapon), and the prepared toggle. What a cast DOES to
 * the character is a pure action in `$lib/play/cast`; the rolls it asks for are `rolls`
 * (`spell-cast-rolls.ts`), which reads what a slot adds back through this class.
 *
 * It reads the host through a narrow interface rather than importing the view-model class, so
 * nothing here depends on the rest of the sheet and there is no import cycle.
 */
import { toast } from '$lib/toast/toast';
import { t, translator, type Translate } from '$lib/i18n';
import { sayText } from '$lib/util/say';
import { NOTE_KEY } from '$lib/combat/roll';
import { upcastPreview } from './spell-roll-name';
import type { Character } from '$lib/character/schema';
import type { ResourceDef } from '$lib/effects/facts';
import { castSpell, enchantableWeapons, upcastAt } from '$lib/play/cast';
import { PLAY_REQUEST, type PlayContext, type PlayOutcome } from '$lib/play/outcome';
import {
	effectsCaption,
	canTogglePreparedFor,
	type DamagePart,
	type SpellRow,
	type MenuKind,
	type Attack,
} from '$lib/combat/helpers';
import { castableSlotLevels } from '$lib/rules/spellcasting';
import { NO_VARS, withWalkingSpeed } from '$lib/effects/context';
import { SpellCastRolls, type CastRollsHost, type UpcastFlatKind } from './spell-cast-rolls';

/** How a cast was asked for. `weapon` is the one a magic-weapon buff lands on: a weapon id, or
 *  `null` once it is settled that there is none to touch. Absent means not asked yet. */
type CastOptions = { ritual?: boolean; slot?: number; pool?: string; weapon?: string | null };

/** What casting needs from the sheet around it. A narrow structural interface rather than the VM
 *  class, so this module does not import the thing that imports it. */
export interface CastingHost extends CastRollsHost {
	character: Character | null;
	/** What a pool has spent — which of them can still pay for a cast. */
	resources: { resourceSpent(id: string): number };
	/** The attacks the sheet shows — the weapons a magic-weapon buff can be laid on. */
	attacks: Attack[];
	overlay: { kind: MenuKind; top: number; left: number | null; right: number | null } | null;
	/** Carry out a play-state action on the open character, and hand back what came of it. */
	enact(action: (character: Character, ctx: PlayContext) => PlayOutcome): PlayOutcome | null;
}

export class SpellCasting {
	/** The rolls a cast makes. Built in the constructor, where `host` is already assigned. */
	private rolls: SpellCastRolls;
	constructor(private host: CastingHost) {
		this.rolls = new SpellCastRolls(host, this);
	}

	/** A spell's `upcast` cell at a slot level (`$lib/play/cast` ▸ `upcastAt`). Each caller picks the
	 *  kinds it cares about. */
	private evalUpcastAt(r: SpellRow, slotLevel: number): ReturnType<typeof upcastAt> {
		const sheet = this.host.sheet;
		return sheet ? upcastAt(sheet, r, slotLevel) : [];
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
	/** What a magic-weapon buff can be laid on. */
	get enchantableWeapons(): Attack[] {
		return enchantableWeapons(this.host.attacks);
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

	/** What a spell that rolls nothing DOES, from its own effect tokens and resolved against this
	 *  sheet — Mage Armor reads as the character's number, Spider Climb as their speed. Empty for a
	 *  row that carries no tokens, which the panel words as plain utility. */
	caption = (r: SpellRow, translate?: Translate): string =>
		effectsCaption(
			r.effectTokens,
			withWalkingSpeed(this.host.sheet?.castCtx ?? NO_VARS, this.host.sheet?.speed.value ?? 0),
			translate,
		);

	/**
	 * Cast a spell (`$lib/play/cast`), then do what the cast asks of the sheet: open the weapon picker
	 * when a magic-weapon buff has several weapons to land on — nothing is paid until it is answered —
	 * or make the cast's rolls. `opts.slot` overrides the auto-lowest slot (the upcast picker) and is
	 * honoured or blocked, never downshifted.
	 */
	cast = (r: SpellRow, e: Event, opts: CastOptions = {}) => {
		const outcome = this.host.enact((c, ctx) => castSpell(c, { spell: r.ref, ...opts }, ctx));
		for (const ask of outcome?.asks ?? [])
			if (ask.kind === PLAY_REQUEST.weapon) {
				this.enchanting = { r, opts };
				this.host.openMenu('enchantweapon', e);
			} else if (ask.kind === PLAY_REQUEST.cast)
				this.rolls.rollSpellCast(r, e, ask.ritual, ask.slotLevel);
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
