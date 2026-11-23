/*
 * The hit-point controls: the numbers and choices the player is entering, and the presses that turn
 * them into an action.
 *
 * The RULES are not here. Damage, healing, the death-save track and the lethal rules are pure
 * actions in `#lib/play/hit-points`; this builds each one's intent from the fields below and hands
 * it to the view-model to carry out. What stays is what only a screen has: the amount being typed,
 * the type picked for it, and the concentration saves hits have left owed.
 *
 * `hpMax` is the EFFECTIVE max, so it stays the answer to "how much HP" for everything above:
 * the view-model re-exposes it (A14 — a manual max still has `hp_max` effects folded onto it), and
 * the action executor and the short rest read it from there rather than recomputing.
 */
import type { SensitivityBucket } from '#lib/combat/helpers.ts';
import type { Character, DeathCause } from '#lib/character/schema.ts';
import type { CharacterSheet } from '#lib/character/derive.ts';
import { DAMAGE_TYPES } from '#lib/components/damage-glyphs.ts';
import {
	concentrationSaveDc,
	die,
	heal,
	hitPointMaximum,
	oneBlow,
	resolveDamagePart,
	revive,
	rollConcentrationSave,
	rollDeathSave,
	setDeathSavePip,
	setTempHp,
	takeBackLastSave,
	takeDamage,
	type DamagePart,
	type DeathSavePip,
} from '#lib/play/hit-points.ts';
import type { OwedConcentrationSave, PlayContext, PlayOutcome } from '#lib/play/outcome.ts';
import type { OpenOverlay } from './menu-overlay.svelte';

/** What a Damage press will take once the character's defence against the picked type applies. */
export interface DamagePreview {
	raw: number;
	final: number;
	bucket: Exclude<SensitivityBucket, null>;
}

/** What the hit-point controls need from the sheet around them. */
export interface HitPointsHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	overlay: OpenOverlay | null;
	/** Carry out a play-state action on the open character. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): void;
}

export class HitPoints {
	constructor(private host: () => HitPointsHost) {}

	/** The green popover's ONE number: what Heal restores and what Temp HP is set to. Healing does
	 *  not share the hit's amount — a field that means damage on one press and healing on the next is
	 *  how 12 damage gets healed back by a slip. */
	healAmount = $state(5);
	setTempHp = () => {
		this.host().act((c) => setTempHp(c, { amount: this.healAmount }));
		this.host().overlay = null;
	};

	hpAmount = $state(1);
	/**
	 * The CON saves the player owes after taking damage while concentrating, oldest first — a QUEUE,
	 * because each hit owes its own (RAW), and the concentration chip says and rolls the first. Each
	 * `dc` is suggested and editable. A hit adds one, a rolled or waved-off save takes the first, and
	 * the view-model drops the ones whose concentration ended or was replaced.
	 *
	 * `spell` is WHICH concentration a save is owed for: an owed save is a fact about one spell, and
	 * without the name it re-attaches itself to whatever is concentrated on next — asking for a spell
	 * that was never hit.
	 */
	owedConcentrationSaves = $state<OwedConcentrationSave[]>([]);
	owe = (save: OwedConcentrationSave) => {
		this.owedConcentrationSaves = [...this.owedConcentrationSaves, save];
	};
	/** Keep only the saves owed for `spell` — the concentration that is still held. */
	keepOwedFor = (spell: string | null) => {
		if (this.owedConcentrationSaves.some((save) => save.spell !== spell))
			this.owedConcentrationSaves = this.owedConcentrationSaves.filter(
				(save) => save.spell === spell,
			);
	};
	/**
	 * "That was one hit": every owed save becomes one, at the DC of the damage they sum to. The app
	 * cannot tell a flame tongue's two presses from two blows, and the rules differ — two blows owe
	 * two saves, one hit of two types owes one at the DC of its total — so the player says which.
	 */
	mergeOwedConcentrationSaves = () => {
		const [first] = this.owedConcentrationSaves;
		const system = this.host().character?.system;
		if (!first || !system) return;
		const damage = this.owedConcentrationSaves.reduce((sum, save) => sum + save.damage, 0);
		this.owedConcentrationSaves = [
			{ spell: first.spell, damage, dc: concentrationSaveDc(damage, system) },
		];
	};
	/** The CON saving-throw bonus a concentration save rolls (d20 + this). */
	get concentrationSaveMod(): number {
		return this.host().sheet?.abilities.con.save.value ?? 0;
	}
	/** Selected damage type for the next Damage press (B20). Null = untyped (no resist/vuln math). */
	damageType = $state<string | null>(null);
	get hpMax(): number {
		const { character, sheet } = this.host();
		if (!character || !sheet) return character?.play.hp.max ?? 0;
		return hitPointMaximum(character, sheet);
	}
	/** The damage types a hit can be said to be: the ones this character has a defense for first —
	 *  those change the number — then the rest of the game's types, which change only what the log
	 *  records the damage as. */
	get damageTypeOptions(): string[] {
		const defended = this.defendedTypes;
		return [...defended, ...DAMAGE_TYPES.filter((type) => !defended.includes(type))];
	}
	/** The damage types this sheet has a defense for, in a stable order. */
	get defendedTypes(): string[] {
		const d = this.host().sheet?.damageSensitivities;
		return d ? [...new Set([...d.resist, ...d.immune, ...d.vulnerable])].sort() : [];
	}
	/** The defense this sheet has against a type, or null — what the type's mark is drawn from. */
	defenceAgainst = (type: string | null): SensitivityBucket => {
		const sheet = this.host().sheet;
		return sheet ? resolveDamagePart({ amount: 1, type }, sheet.damageSensitivities).bucket : null;
	};
	/** The typed-in amount after the defence against the picked type, shown BEFORE the press so the
	 *  player sees "12 → 6" rather than finding out from the HP bar. Null when the defence changes
	 *  nothing — no type, no defence against it, or no amount yet. */
	get damagePreview(): DamagePreview | null {
		return this.previewOf({ amount: this.hpAmount, type: this.damageType });
	}
	/** The same answer for any hit — the type menu asks it of every type it lists. */
	previewOf = (hit: DamagePart): DamagePreview | null => {
		const sheet = this.host().sheet;
		if (!sheet) return null;
		const { raw, final, bucket } = resolveDamagePart(hit, sheet.damageSensitivities);
		return raw > 0 && bucket ? { raw, final, bucket } : null;
	};

	/** What the last press carried past 0 when it DROPPED the character there — kept for the press
	 *  after it, which may be the same blow's second damage type. */
	private dropPastZero: number | null = null;
	/** What "that was one blow" sums: offered while the press right after a drop recorded a
	 *  death-save failure, and gone with the next thing done to the track. */
	oneBlowPastZero = $state<number | null>(null);

	damage = () => {
		const hit = { amount: this.hpAmount, type: this.damageType };
		const play = this.host().character?.play;
		const before = play?.hp.current ?? 0;
		const failuresBefore = play?.deathSaves.failures ?? 0;
		let outcome: PlayOutcome | undefined;
		this.host().act((c, ctx) => (outcome = takeDamage(c, hit, ctx)));
		const pastZero = outcome && !outcome.refused ? outcome.pastZero : undefined;
		const failed =
			before === 0 && (outcome?.character.play.deathSaves.failures ?? 0) > failuresBefore;
		this.oneBlowPastZero =
			failed && this.dropPastZero !== null && pastZero !== undefined
				? this.dropPastZero + pastZero
				: null;
		this.dropPastZero = before > 0 && pastZero !== undefined ? pastZero : null;
	};
	/** "That was one blow" — see `oneBlow`. */
	oneBlow = () => {
		const pastZero = this.oneBlowPastZero;
		this.oneBlowPastZero = null;
		if (pastZero !== null) this.host().act((c, ctx) => oneBlow(c, { pastZero }, ctx));
	};
	heal = () => {
		this.host().act((c, ctx) => heal(c, { amount: this.healAmount }, ctx));
		this.host().overlay = null;
	};

	/**
	 * Roll a concentration save — the first one owed, or with nothing owed the one the table asks
	 * for and the app cannot see the trigger of. Rolled at once and applied, like a death save: the
	 * tray has no result callback.
	 */
	rollConcentrationSave = () => {
		const [owed, ...rest] = this.owedConcentrationSaves;
		// answered either way, and before the roll: a miss ends the spell and takes the rest with it
		this.owedConcentrationSaves = rest;
		this.host().act((c, ctx) => rollConcentrationSave(c, owed ? { dc: owed.dc } : {}, ctx));
	};
	/** Wave the first owed save off WITHOUT ending concentration: the player rolled it at the table,
	 *  a feature ignores it, or they do not care. Surface, never force — a reminder is dismissable. */
	dismissConcentrationSave = () => {
		this.owedConcentrationSaves = this.owedConcentrationSaves.slice(1);
	};

	/** Roll a death save (shown while at 0 HP). Always rolled at once and applied: unlike other rolls
	 *  it MUTATES play-state, the tray has no result callback, and a fixed d20-vs-10 has nothing to
	 *  customize. */
	deathSave = () => {
		this.oneBlowPastZero = null;
		this.host().act(rollDeathSave);
	};
	toggleDeathSave = (kind: DeathSavePip['kind'], index: number) => {
		this.oneBlowPastZero = null;
		this.host().act((c) => setDeathSavePip(c, { kind, index }));
	};
	/** Undo the press that ended the dying — the third success or the third failure. */
	takeBackLastSave = () => {
		this.oneBlowPastZero = null;
		this.host().act(takeBackLastSave);
	};
	die = (cause: DeathCause) => this.host().act((c) => die(c, cause));
	revive = () => this.host().act(revive);

	get hpBar(): { cur: number; tmp: number } {
		const c = this.host().character;
		if (!c || !this.host().sheet) return { cur: 0, tmp: 0 };
		// `|| 1` guards a 0 max (unset HP) so the bar math can't divide → NaN/Infinity (D19)
		const max = this.hpMax || 1;
		return {
			cur: Math.max(0, Math.min(100, (c.play.hp.current / max) * 100)),
			tmp: (c.play.hp.temp / max) * 100,
		};
	}
}
