/*
 * Casting a spell, as an action: what pays for it (a slot, a pool, or nothing), the turn slot its
 * casting time costs, the concentration it takes, and the effect the spell's own tokens leave on the
 * character. All of it or none of it.
 *
 * The cast's ROLLS — a spell attack, its damage, a heal — are asked of the host: they are the
 * player's to build, and nothing they come to lands in play-state.
 */
import { tokensOf, type LoadedRowOf } from '$lib/content/loader';
import { localizedName } from '$lib/content/detail';
import { pactPool, slotToSpend, PACT_SLOT_KEY } from '$lib/rules/spellcasting';
import { withCastSlot, withSpellcastingMod } from '$lib/effects/context';
import { evalUpcast } from '$lib/effects/upcast';
import { canCastAsRitual, spellEntries } from '$lib/character/spellcasting';
import type { Character, CharacterPlay } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { UNARMED_STRIKE_ID, type ActionSlot, type Attack } from '$lib/combat/helpers';
import { durationToRounds } from '$lib/combat/effects-view';
import { sheetAttacks } from '$lib/combat/form-attacks';
import { casterForSpell, castingIcon, enhancementTokens } from '$lib/combat/spells';
import { endConcentration } from './concentration';
import { effectInstanceOf } from './effects';
import {
	PLAY_REQUEST,
	chain,
	quietly,
	type PlayContext,
	type PlayNotice,
	type PlayOutcome,
} from './outcome';
import { resourceSpent, useResource } from './resources';
import { settled } from './settle';
import { spendTurnSlot } from './turn';

/** What a spell's `upcast` cell is read against: the row's ref, its own level and the cell. */
export interface UpcastSubject {
	ref: string;
	level: number;
	upcast: string;
}

/**
 * A spell's `upcast` cell evaluated at a slot level — the ONE place the cast's context is built, so
 * the damage, duration, hit-point and count readers all see the same evaluation. The sheet's
 * post-derive context is wrapped with the cast-only `{slot, spell_level}`, and `spellcasting_mod` is
 * re-pointed at the class the spell is cast AS, so a multiclass sheet scales by the right ability.
 * Empty when the spell states no upcast. It is a spell's own mechanic, not an effect layer, so it is
 * not gated on effects-auto.
 */
export function upcastAt(
	sheet: CharacterSheet,
	spell: UpcastSubject,
	slotLevel: number,
): ReturnType<typeof evalUpcast> {
	const base = sheet.castCtx;
	if (!spell.upcast || !base) return [];
	const withSlot = withCastSlot(base, slotLevel, spell.level);
	const caster = casterForSpell(sheet, spell.ref);
	return evalUpcast(
		spell.upcast,
		caster ? withSpellcastingMod(withSlot, sheet.abilities[caster.ability]?.mod ?? 0) : withSlot,
	);
}

/** The summed flat value of one upcast kind at a slot (`hp_max`, `temp_hp`, `enhancement`). */
const upcastFlat = (results: ReturnType<typeof evalUpcast>, kind: string): number =>
	results.reduce((sum, res) => sum + ('error' in res || res.kind !== kind ? 0 : res.flat), 0);

/** What a magic-weapon buff can be laid on: each weapon the character attacks with, once. Magic
 *  weapons are not filtered out — the rule is the player's to apply, and the app cannot tell. */
export function enchantableWeapons(attacks: readonly Attack[]): Attack[] {
	const seen = new Set<string>();
	return attacks.filter((attack) => {
		if (attack.id === UNARMED_STRIKE_ID || seen.has(attack.id)) return false;
		seen.add(attack.id);
		return true;
	});
}

/** How a cast is asked for. */
export interface CastIntent {
	spell: string;
	/** Cast as a ritual — honoured only where the class it is cast as may. */
	ritual?: boolean;
	/** The slot level chosen. Honoured or refused, never shifted down. */
	slot?: number;
	/** A pool that pays instead of a slot ("cast it once without a slot"). */
	pool?: string;
	/** The weapon a magic-weapon buff lands on: its id, or `null` once it is settled there is none.
	 *  Absent means not asked yet. */
	weapon?: string | null;
}

const TURN_SLOT_OF: Record<string, ActionSlot> = { react: 'reaction', bonus: 'bonus' };

/** The slot LEVEL a cast resolves at: a pact slot casts at the pool's level, a leveled slot at its
 *  own, and a cast that spends none (cantrip, ritual, a pool) at the spell's base level. */
function castSlotLevel(sheet: CharacterSheet, slot: string | null, baseLevel: number): number {
	if (slot === PACT_SLOT_KEY) return pactPool(sheet.spellcasting.pools)?.spellLevel ?? baseLevel;
	return slot != null ? Number(slot) : baseLevel;
}

const refusal = (character: Character, ...notices: PlayNotice[]): PlayOutcome => ({
	...quietly(character),
	refused: true,
	notices,
});

/** A spell as a cast reads it: its row, what its upcast is read against, and its name. */
interface CastSpell {
	subject: UpcastSubject;
	data: LoadedRowOf<'spell'>['data'];
	tokens: string[];
	name: string;
}

/**
 * The weapon a magic-weapon buff lands on, settled BEFORE anything is spent: with one weapon there
 * is nothing to ask, with several the answer is `undefined` — ask — and with none it is `null`, and
 * the cast goes ahead and says so. Any other spell lands on none.
 */
function weaponFor(
	character: Character,
	spell: CastSpell,
	intent: CastIntent,
	ctx: PlayContext,
): string | null | undefined {
	if (intent.weapon !== undefined) return intent.weapon;
	const sheet = ctx.derive(character);
	const at = intent.slot ?? spell.subject.level;
	if (upcastFlat(upcastAt(sheet, spell.subject, at), 'enhancement') <= 0) return null;
	const weapons = enchantableWeapons(sheetAttacks(character, sheet, ctx.graph, ctx.locale));
	return weapons.length > 1 ? undefined : (weapons[0]?.id ?? null);
}

/** May this cast be a ritual? Only where it was asked for and the class it is cast as allows. */
function isRitual(character: Character, sheet: CharacterSheet, spell: CastSpell, asked: boolean) {
	const entry = spellEntries(character, sheet).find((known) => known.spell === spell.subject.ref);
	return (
		asked &&
		canCastAsRitual(casterForSpell(sheet, spell.subject.ref), {
			ritual: spell.data.ritual ?? false,
			isPrepared: !!entry && (entry.prepared || entry.alwaysPrepared),
		})
	);
}

/**
 * Pay for a cast, all of it or none: the pool or the slot, and the turn slot the casting time
 * costs. `slot` is the slot key that was spent — `null` for a cast that spends none (a cantrip, a
 * ritual, a pool).
 */
function payForCast(
	character: Character,
	spell: CastSpell,
	{ pool: poolId, slot: chosen, ritual }: { pool?: string; slot?: number; ritual: boolean },
	ctx: PlayContext,
): { paid: PlayOutcome; slot: string | null } {
	const sheet = ctx.derive(character);
	const none = (paid: PlayOutcome) => ({ paid, slot: null });
	const pool = poolId ? sheet.resources.find((r) => r.id === poolId) : undefined;
	// a pool this character does not have must not cast for free
	if (poolId && !pool) return none(refusal(character));
	if (pool && resourceSpent(character, sheet, pool.id) >= pool.max)
		return none(useResource(character, pool, ctx));
	const { pools } = sheet.spellcasting;
	const reserved =
		pool || ritual
			? null
			: slotToSpend(spell.subject.level, pools, character.play.spellSlotsSpent, chosen);
	if (reserved && 'block' in reserved) return none(refusal(character, { text: reserved.block }));
	const slot = reserved?.key ?? null;
	const turnSlot = TURN_SLOT_OF[castingIcon(spell.data.casting_time ?? '')] ?? 'action';
	const paid = chain(spendTurnSlot(character, { slot: turnSlot }, ctx), (charged) => {
		if (pool) return useResource(charged, pool, ctx);
		if (!slot) return quietly(charged);
		const spent = charged.play.spellSlotsSpent;
		const spellSlotsSpent = { ...spent, [slot]: (spent[slot] ?? 0) + 1 };
		return quietly({ ...charged, play: { ...charged.play, spellSlotsSpent } });
	});
	return { paid, slot };
}

/**
 * A concentration spell becomes the concentration, and the prior spell's effect goes down with it
 * (5e: one at a time) — unless a state forbids concentration (RAW: a Barbarian cannot maintain it
 * while raging), in which case the spell is cast and SAYS it holds none.
 */
function takeConcentration(
	play: CharacterPlay,
	sheet: CharacterSheet,
	spell: CastSpell,
	notices: PlayNotice[],
): CharacterPlay {
	if (!spell.data.concentration) return play;
	if (sheet.facts.breaksConcentration) {
		notices.push({
			text: { key: 'combat.notice.noConcentration', values: { name: spell.name } },
			description: { key: 'combat.notice.noConcentrationBody' },
		});
		return play;
	}
	const { ref } = spell.subject;
	const free = play.concentration && play.concentration !== ref ? endConcentration(play) : play;
	return { ...free, concentration: ref };
}

/** The carrier effect's length in rounds; 0 is no clock at all. A `duration` upcast is an ABSOLUTE
 *  total (Hunter's Mark 8 h → 24 h) and wins over the spell's own duration. */
function carrierRounds(spell: CastSpell, upcast: ReturnType<typeof evalUpcast>): number {
	for (const res of upcast) {
		if ('error' in res || res.kind !== 'duration') continue;
		if (res.isInfinite) return 0;
		if (res.flat > 0) return res.flat;
	}
	return durationToRounds(String(spell.data.duration)) ?? 0;
}

/**
 * The effect a cast leaves on the caster: the spell's own tokens, on the clock the spell states.
 * An `hp_max` upcast is ADDED to what the spell grants (Aid's +5 per slot above base); an
 * `enhancement` upcast is the whole bonus, scoped to the one weapon touched (Magic Weapon).
 *
 * A concentration spell gets the effect even with no tokens, because the effect IS its clock —
 * without it Hold Person would hang until a long rest. A re-cast refreshes rather than stacks.
 */
function leaveSpellEffect(
	play: CharacterPlay,
	spell: CastSpell,
	cast: { upcast: ReturnType<typeof evalUpcast>; weapon: string | null },
	notices: PlayNotice[],
): CharacterPlay {
	for (const res of cast.upcast)
		if ('error' in res && /^(hp_max|enhancement)/.test(res.raw))
			notices.push({ text: { key: 'combat.notice.upcastUnknown' }, description: res.error });
	const hpMax = upcastFlat(cast.upcast, 'hp_max');
	const enhance = upcastFlat(cast.upcast, 'enhancement');
	if (enhance > 0 && cast.weapon === null)
		notices.push({
			text: { key: 'combat.notice.noWeaponToEnchant', values: { name: spell.name } },
		});
	const tokens = [
		...spell.tokens,
		...(hpMax > 0 ? [`flat_bonus:hp_max+${hpMax}`] : []),
		...(enhance > 0 && cast.weapon !== null ? enhancementTokens(enhance, cast.weapon) : []),
	];
	if (!tokens.length && !spell.data.concentration) return play;
	const { ref } = spell.subject;
	const durationRounds = carrierRounds(spell, cast.upcast);
	const carrier = effectInstanceOf(
		{ label: spell.name, tokens, positive: true, ref, durationRounds },
		play.round,
	);
	return {
		...play,
		effects: [...play.effects.filter((effect) => effect.source !== ref), carrier],
	};
}

/**
 * Cast a spell. Which weapon a buff lands on is asked first, and nothing is paid until it is
 * answered; then the cast is paid for whole or refused whole; then it takes concentration and leaves
 * its effect; and its rolls are asked of the host.
 */
export function castSpell(character: Character, intent: CastIntent, ctx: PlayContext): PlayOutcome {
	const row = ctx.graph.get(intent.spell);
	if (row?.type !== 'spell') return refusal(character);
	const spell: CastSpell = {
		subject: { ref: intent.spell, level: row.data.level, upcast: row.data.upcast ?? '' },
		data: row.data,
		tokens: tokensOf(row),
		name: localizedName(row, ctx.locale),
	};
	const weapon = weaponFor(character, spell, intent, ctx);
	if (weapon === undefined)
		return { ...quietly(character), asks: [{ kind: PLAY_REQUEST.weapon, spell: intent.spell }] };
	const ritual = isRitual(character, ctx.derive(character), spell, intent.ritual === true);
	const { paid, slot } = payForCast(
		character,
		spell,
		{
			ritual,
			...(intent.pool ? { pool: intent.pool } : {}),
			...(intent.slot === undefined ? {} : { slot: intent.slot }),
		},
		ctx,
	);
	if (paid.refused) return paid;

	const caster = paid.character;
	const casting = ctx.derive(caster);
	const slotLevel = castSlotLevel(casting, slot, spell.subject.level);
	const notices: PlayNotice[] = [];
	const concentrating = takeConcentration(caster.play, casting, spell, notices);
	const upcast = upcastAt(casting, spell.subject, slotLevel);
	const play = leaveSpellEffect(concentrating, spell, { upcast, weapon }, notices);
	return settled(
		{
			...paid,
			character: { ...caster, play },
			notices: [...paid.notices, ...notices],
			asks: [{ kind: PLAY_REQUEST.cast, spell: intent.spell, ritual, slotLevel }],
		},
		ctx,
	);
}
