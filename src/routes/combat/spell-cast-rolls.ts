/*
 * The rolls a cast makes — a spell attack's to-hit and its damage, a save spell's damage, a heal,
 * temporary hit points, and the bare log marker of a cast that rolls nothing. One unit because every
 * one of them is the same assembly: the spell's typed parts, the upcast folded in by type, the
 * character's roll effects on the primary part, then the tray or the log.
 *
 * What a slot ADDS is not decided here. `SpellCasting` owns the upcast evaluation, because the
 * carrier effect and the weapon picker read it too, and hands it in as `UpcastReads`.
 */
import { LOG_KIND } from '$lib/character/log-kind';
import { toast } from '$lib/toast/toast';
import { t } from '$lib/i18n';
import type { SaidText } from '$lib/util/say';
import { rollPool } from '$lib/rules/dice';
import { NOTE_KEY, nameFields, type RollName } from '$lib/combat/roll';
import { SPELL_OUTCOME, saidNote, spellRollName, type SpellOutcomeKind } from './spell-roll-name';
import type { CharacterSheet } from '$lib/character/derive';
import type { SpellcastingClass } from '$lib/character/spellcasting';
import {
	wantsTray,
	netAdvantage,
	NO_ROLL_EFFECTS,
	type RollEffects,
	casterForSpell,
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
import { combinePools } from '$lib/effects/upcast';

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

/** What a cast's rolls need from the sheet around them. */
export interface CastRollsHost {
	sheet: CharacterSheet | null;
	journal: RollJournal;
	effectsFor(key: string, scopes?: Set<string>): RollEffects;
	openRoll(spec: RollSpec, e: Event): void;
	openMenu(kind: MenuKind, e: Event): void;
}

/** A magnitude an upcast scales as one flat number, by the slot it is cast from. */
export type UpcastFlatKind = 'hp_max' | 'temp_hp' | 'enhancement';

/** What casting from a given slot adds, as the rolls read it. */
export interface UpcastReads {
	upcastDamageParts(r: SpellRow, slotLevel: number): DamagePart[];
	upcastFlatDelta(r: SpellRow, slotLevel: number, kind: UpcastFlatKind): number;
	castPreview(r: SpellRow, slotLevel: number): string;
	volleyOf(r: SpellRow, slotLevel: number): number;
}

/** What a cast is IN SCOPE of, so a bonus can name one spell (`flat_bonus:damage.eldritch_blast+3`,
 *  Agonizing Blast) instead of every roll the character makes. The spell's own id — the same
 *  vocabulary a weapon's id and its tags use, because a scope is a name, not an enum. */
const spellScopes = (r: SpellRow): Set<string> => new Set([r.id]);

export class SpellCastRolls {
	constructor(
		private host: CastRollsHost,
		private upcast: UpcastReads,
	) {}

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
		const tempDelta = temp ? this.upcast.upcastFlatDelta(r, slotLevel, 'temp_hp') : 0;
		const deltas = temp ? (tempDelta ? [{ pool: {}, mod: tempDelta, type: '' }] : []) : up.deltas;
		return {
			parts: this.spellDamageParts(r, primaryFx, deltas),
			kind: temp ? SPELL_OUTCOME.tempHp : heal ? SPELL_OUTCOME.healing : SPELL_OUTCOME.damage,
		};
	}

	/** The roll half of a cast: an attack spell rolls its TO-HIT (attack-keyed effects) then queued
	 *  damage; a damage/heal spell rolls its dice (auto = healing + spellcasting mod); a no-roll cast
	 *  logs a marker. Uses the class the spell is cast AS (A18), not classes[0]. */
	rollSpellCast(r: SpellRow, e: Event, ritual: boolean, slotLevel: number): void {
		const caster =
			casterForSpell(this.host.sheet, r.ref) ?? this.host.sheet?.spellcasting.classes[0];
		// the upcast contribution + its provenance tag (B8): when actually upcast, the suffix names the
		// slot AND what it added ("(slot 5 · +2d6)") — reusing castPreview — so the roll log / toast
		// explains the boosted total instead of a bare number.
		const preview = slotLevel > r.level ? this.upcast.castPreview(r, slotLevel) : '';
		const deltas = this.upcast.upcastDamageParts(r, slotLevel);
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
			this.rollSpellAttack(r, e, caster, { up, times: this.upcast.volleyOf(r, slotLevel) });
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
			this.host.journal.logMarker(
				{
					text: `Cast ${r.name}${suffix}`,
					key: ritual ? 'combat.log.castRitual' : 'combat.log.cast',
					values: { name: r.name },
				},
				undefined,
				LOG_KIND.cast,
			);
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
}
