/*
 * Hit points and how a character dies, as actions: damage (defenses → temp HP → a form's own →
 * current), healing, temp HP, the concentration save a hit makes due, the death-save track, and the
 * three lethal rules.
 *
 * One unit because they are one rule chain — damage decides instant death, makes the concentration
 * check due and drops you to 0, and the death-save track is what 0 HP leads to.
 *
 * An action that moves hit points, or what their maximum depends on, ends in `settled` (`./settle`),
 * so the rules that FOLLOW such a change hold wherever it came from.
 */
import { naturalOf, rollPool, type Rolled } from '$lib/rules/dice';
import { effectiveHpMax } from '$lib/rules/core';
import {
	applyDamageSensitivity,
	netAdvantage,
	sheetRollEffects,
	DEATH_CAUSE_LABEL,
	type DamageSensitivities,
	type RollEffects,
	type RollName,
	type SensitivityBucket,
} from '$lib/combat/helpers';
import type { Character, CharacterPlay, DeathCause } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { endConcentration } from './concentration';
import { leaveForm } from './form';
import { settled } from './settle';
import {
	quietly,
	type PlayContext,
	type PlayLogLine,
	type PlayNotice,
	type PlayOutcome,
} from './outcome';

/** RAW's floor for a concentration save: DC 10, or half the damage taken if that is higher. It is
 *  also the whole DC when the app never saw the hit — a hazard, a shove, a GM call. */
const CONCENTRATION_DC_FLOOR = 10;
/** The 2024 rules cap that DC; the 2014 rules state none. */
const CONCENTRATION_DC_CAP_2024 = 30;

const DEATH_SAVE_DC = 10;
const DEATH_SAVE_TRACK = 3;

/** One typed part of a hit as it is dealt. */
export interface DamagePart {
	amount: number;
	type: string | null;
}

/** The same part against the character's defenses. */
export interface ResolvedDamagePart {
	raw: number;
	type: string | null;
	final: number;
	bucket: SensitivityBucket;
}

/** One part of a hit against a set of defenses: what was dealt, what it takes. */
export function resolveDamagePart(
	part: DamagePart,
	defenses: DamageSensitivities,
): ResolvedDamagePart {
	const raw = Math.max(0, Math.round(part.amount || 0));
	return { raw, type: part.type, ...applyDamageSensitivity(raw, part.type, defenses) };
}

/**
 * What a part of a hit is CALLED in the log: a catalog key and its values, never a sentence, so the
 * record reads in the language it is read in. The type stands after a separator as a label rather
 * than inside the phrase — a noun set into a frame is what breaks in an inflected language — and a
 * defense that changed the number has a sentence of its own.
 */
function damageTakenName({ raw, type, final, bucket }: ResolvedDamagePart): RollName {
	if (!type)
		return { text: `Damage taken: ${final}`, key: 'combat.log.damageTaken', values: { final } };
	const typeWord = { catalog: 'damageType', id: type };
	return bucket
		? {
				text: `Damage taken: ${final} of ${raw} · ${type} (${bucket})`,
				key: `combat.log.damageTakenDefended.${bucket}`,
				values: { final, raw, type: typeWord },
			}
		: {
				text: `Damage taken: ${final} · ${type}`,
				key: 'combat.log.damageTakenTyped',
				values: { final, type: typeWord },
			};
}

/** The EFFECTIVE hit-point maximum: a manual max still has `hp_max` effects folded onto it (A14). */
export const hitPointMaximum = (character: Character, sheet: CharacterSheet): number =>
	effectiveHpMax(character.play.hp.max ?? null, sheet.maxHp);

/** You are no longer dying: the death-save track resets. */
const notDying = (play: CharacterPlay): CharacterPlay => ({
	...play,
	deathSaves: { successes: 0, failures: 0 },
});

/** Record a death on the play-state. The first cause sticks: a character already dead is returned
 *  untouched and nothing is said twice. */
function dead(play: CharacterPlay, cause: DeathCause, notices: PlayNotice[]): CharacterPlay {
	if (play.death) return play;
	notices.push({
		text: { key: 'combat.notice.died' },
		description: { key: DEATH_CAUSE_LABEL[cause] },
	});
	return { ...play, death: { cause } };
}

/** A hit: its parts, and whether it was a critical — which only matters to a body already at 0. */
export interface DamageIntent {
	parts: readonly DamagePart[];
	crit: boolean;
}

/**
 * Take a hit. Each part meets its own defense BEFORE temp HP soaks anything (RAW ordering), and the
 * hit is their sum: temp HP, a form's own hit points, instant death and the concentration save are
 * asked of the total.
 */
export function takeDamage(
	character: Character,
	intent: DamageIntent,
	ctx: PlayContext,
): PlayOutcome {
	let sheet = ctx.derive(character);
	const parts = intent.parts.map((part) => resolveDamagePart(part, sheet.damageSensitivities));
	const taken = parts.reduce((sum, part) => sum + part.final, 0);
	// what the damage WAS is recorded, part by part: the hit points only say what was left
	const log: PlayLogLine[] = parts
		.filter((part) => part.raw > 0)
		.map((part) => ({ name: damageTakenName(part) }));
	const notices: PlayNotice[] = [];

	let play = character.play;
	const soaked = Math.min(play.hp.temp, taken); // temp HP absorbs first
	play = { ...play, hp: { ...play.hp, temp: play.hp.temp - soaked } };
	let left = taken - soaked;

	// A form with hit points of its own takes the hit first. RAW (SRD 5.1): "if you revert as a
	// result of dropping to 0 hit points, any excess damage carries over to your normal form" — and
	// the rest of the hit is then read against the character's own maximum, not the form's.
	const form = play.form;
	if (form?.hpBefore !== undefined && left >= play.hp.current) {
		const excess = left - play.hp.current;
		play = leaveForm(play);
		notices.push({
			text: { key: 'combat.notice.formBroken' },
			description: { key: 'combat.notice.formBrokenBody', values: { excess } },
			rows: { name: form.monster },
		});
		left = excess;
		sheet = ctx.derive({ ...character, play });
	}

	const before = play.hp.current;
	play = { ...play, hp: { ...play.hp, current: Math.max(0, before - left) } };
	// INSTANT DEATH (SRD 5.1 "Instant Death"): damage reduces you to 0 AND the damage REMAINING
	// equals or exceeds your hit-point MAXIMUM (the full max, not half) → you die outright, no death
	// saves. The same threshold covers "Damage at 0 Hit Points" (already at 0 → the leftover is the
	// whole hit). SRD 5.2.1 omits the chapter that carries this rule and only cross-references it, so
	// both editions run the 5.1 text. docs/internals/rules-core.md ▸ RAW, RAI, and saying which
	if (play.hp.current === 0 && left - before >= hitPointMaximum(character, sheet))
		play = dead(play, 'massive_damage', notices);
	// RAW, both editions: damage taken while ALREADY at 0 HP is a death-save failure — two if the hit
	// was a critical. Unconditional in the book, so it is applied rather than offered. `taken`, not
	// `left`: the text says "any damage", and temp HP soaking it does not un-hit a dying body.
	if (before === 0 && taken > 0 && !play.death) {
		const count = intent.crit ? 2 : 1;
		const failures = Math.min(DEATH_SAVE_TRACK, play.deathSaves.failures + count);
		play = { ...play, deathSaves: { ...play.deathSaves, failures } };
		notices.push({ text: { key: 'combat.notice.deathFailureFromDamage', values: { count } } });
		if (failures >= DEATH_SAVE_TRACK) play = dead(play, 'death_saves', notices);
	}
	// Damage while concentrating makes a CON save due — DC max(10, ⌊damage/2⌋), capped at 30 in 2024.
	// It is OWED, not rolled: the player presses it. At 0 HP concentration ends on its own.
	const owed =
		taken > 0 && play.concentration && play.hp.current > 0
			? {
					dc: Math.min(
						character.system === '5.5e' ? CONCENTRATION_DC_CAP_2024 : Number.POSITIVE_INFINITY,
						Math.max(CONCENTRATION_DC_FLOOR, Math.floor(taken / 2)),
					),
					spell: play.concentration,
				}
			: undefined;
	return settled(
		{
			character: { ...character, play },
			log,
			notices,
			...(owed ? { concentrationSave: owed } : {}),
		},
		ctx,
	);
}

/** Heal. The log records what came BACK rather than what was asked: healing past the maximum is
 *  lost, and the line says so by being smaller. */
export function heal(
	character: Character,
	intent: { amount: number },
	ctx: PlayContext,
): PlayOutcome {
	const hp = character.play.hp;
	const amount = Math.max(0, Math.round(intent.amount));
	const current = Math.min(hitPointMaximum(character, ctx.derive(character)), hp.current + amount);
	const restored = current - hp.current;
	return settled(
		{
			character: { ...character, play: { ...character.play, hp: { ...hp, current } } },
			log:
				restored > 0
					? [
							{
								name: {
									text: `Hit points restored: ${restored}`,
									key: 'combat.log.hitPointsRestored',
									values: { restored },
								},
							},
						]
					: [],
			notices: [],
		},
		ctx,
	);
}

/** Set Temporary Hit Points to an amount — set, never added: they do not stack. */
export function setTempHp(character: Character, intent: { amount: number }): PlayOutcome {
	const hp = { ...character.play.hp, temp: Math.max(0, intent.amount) };
	return quietly({ ...character, play: { ...character.play, hp } });
}

/** A d20 with what the sheet's effects say of this roll, and `mod` added. */
const rollD20 = (fx: RollEffects, mod: number, ctx: PlayContext): Rolled =>
	rollPool(
		{ 20: 1 },
		{ ...fx, mod, advantage: netAdvantage(fx), ...(ctx.rng ? { rng: ctx.rng } : {}) },
	);

/**
 * Roll a death save: a d20 against 10, with whatever `save.death` picks up (Bless, exhaustion).
 * RAW: a natural 20 puts you back up at 1 HP; a natural 1 is two failures; 10 or more is a success,
 * and three of them leave you stable with the track reset; the third failure kills.
 */
export function rollDeathSave(character: Character, ctx: PlayContext): PlayOutcome {
	const fx = sheetRollEffects(character, ctx.derive(character), 'save.death');
	const r = rollD20(fx, fx.flat, ctx);
	const notices: PlayNotice[] = [];
	let play = character.play;
	const { successes, failures } = play.deathSaves;
	const natural = naturalOf(r);
	if (natural === 20) {
		play = notDying({ ...play, hp: { ...play.hp, current: 1 } });
		notices.push({ text: { key: 'combat.notice.nat20Revive' } });
	} else if (natural === 1) {
		play = {
			...play,
			deathSaves: { successes, failures: Math.min(DEATH_SAVE_TRACK, failures + 2) },
		};
		notices.push({ text: { key: 'combat.notice.nat1Failures' } });
	} else if (r.total >= DEATH_SAVE_DC) {
		play = {
			...play,
			deathSaves: { successes: Math.min(DEATH_SAVE_TRACK, successes + 1), failures },
		};
		if (play.deathSaves.successes >= DEATH_SAVE_TRACK) {
			play = notDying(play);
			notices.push({ text: { key: 'combat.notice.stabilised' } });
		}
	} else {
		play = {
			...play,
			deathSaves: { successes, failures: Math.min(DEATH_SAVE_TRACK, failures + 1) },
		};
	}
	// "On your third failure, you die" — checked once, after every branch, so a natural 1's DOUBLE
	// failure is as lethal as a third single one.
	if (play.deathSaves.failures >= DEATH_SAVE_TRACK) play = dead(play, 'death_saves', notices);
	return settled(
		{
			character: { ...character, play },
			log: [{ name: { text: 'Death save', key: 'combat.roll.deathSave' }, rolled: r }],
			notices,
		},
		ctx,
	);
}

/** One pip of a death-save track, pressed by hand. */
export interface DeathSavePip {
	kind: 'successes' | 'failures';
	index: number;
}

/**
 * Set a death-save track by hand (players track at the table too): pressing a pip fills to it, or
 * clears it when it is already the last filled one. A track filled by hand means what the rolled
 * one means — the third failure kills, the third success leaves you stable with the track reset.
 */
export function setDeathSavePip(character: Character, { kind, index }: DeathSavePip): PlayOutcome {
	const notices: PlayNotice[] = [];
	const saves = character.play.deathSaves;
	const count = saves[kind] === index + 1 ? index : index + 1;
	let play: CharacterPlay = { ...character.play, deathSaves: { ...saves, [kind]: count } };
	if (kind === 'failures' && count >= DEATH_SAVE_TRACK) play = dead(play, 'death_saves', notices);
	if (kind === 'successes' && count >= DEATH_SAVE_TRACK) {
		play = notDying(play);
		notices.push({ text: { key: 'combat.notice.stabilised' } });
	}
	return { character: { ...character, play }, log: [], notices };
}

/**
 * Record a death. The three lethal rules (massive damage · three death-save failures · the top of
 * the exhaustion ladder) all land here, so "what happens when you die" is one place. Death is
 * AUTOMATIC in RAW (no "you can"), so it is applied and said; the player still owns the way back.
 */
export function die(character: Character, cause: DeathCause): PlayOutcome {
	const notices: PlayNotice[] = [];
	const play = dead(character.play, cause, notices);
	return {
		character: play === character.play ? character : { ...character, play },
		log: [],
		notices,
	};
}

/**
 * "I was revived" — the way back from death. RAW leaves the hit points to the revival effect, so
 * this applies the Revivify FLOOR (at least 1 HP, never taking hit points away — a character who
 * died of Exhaustion at full HP keeps them) and clears the death-save track. Exhaustion drops by
 * one, per the 2024 glossary ("If the creature died with any Exhaustion levels, it returns with 1
 * fewer level") — in BOTH editions, because reviving straight back onto a lethal exhaustion 6 would
 * kill you again on the spot; RAW is silent in 2014, so RAI wins (docs/internals/rules-core.md ▸
 * RAW, RAI, and saying which). Everything else (conditions, curses) survives death per RAW.
 */
export function revive(character: Character): PlayOutcome {
	const play = character.play;
	return {
		character: {
			...character,
			play: notDying({
				...play,
				death: null,
				exhaustion: Math.max(0, play.exhaustion - 1),
				hp: { ...play.hp, current: Math.max(1, play.hp.current) },
			}),
		},
		log: [],
		notices: [{ text: { key: 'combat.notice.revived' } }],
	};
}

/**
 * Roll a concentration save: CON save against `dc`, or against the RAW floor when the table asks for
 * one the app saw no hit for. The CON-save value already folds `save.con` flat effects, so the roll
 * does not add them again; advantage and bonus dice (War Caster, Bless) still ride.
 *
 * A MISS ENDS THE SPELL. RAW leaves nothing to decide — a failed save ends concentration — so what
 * the player was offered is the ROLL.
 */
export function rollConcentrationSave(
	character: Character,
	intent: { dc?: number },
	ctx: PlayContext,
): PlayOutcome {
	if (!character.play.concentration) return quietly(character);
	const sheet = ctx.derive(character);
	const dc = intent.dc ?? CONCENTRATION_DC_FLOOR;
	const fx = sheetRollEffects(character, sheet, 'save.con');
	const r = rollD20(fx, sheet.abilities.con.save.value, ctx);
	const held = r.total >= dc;
	const values = { total: r.total, dc };
	return settled(
		{
			character: held ? character : { ...character, play: endConcentration(character.play) },
			log: [{ name: { text: 'Concentration save', key: 'combat.roll.concentration' }, rolled: r }],
			notices: [
				held
					? { text: { key: 'combat.notice.concentrationHeld', values } }
					: {
							text: { key: 'combat.notice.concentrationFailed', values },
							description: { key: 'combat.notice.concentrationFailedBody' },
						},
			],
		},
		ctx,
	);
}
