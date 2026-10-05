/*
 * The hit-point controls: the numbers and choices the player is entering, and the presses that turn
 * them into an action.
 *
 * The RULES are not here. Damage, healing, the death-save track and the lethal rules are pure
 * actions in `$lib/play/hit-points`; this builds each one's intent from the fields below and hands
 * it to the view-model to carry out. What stays is what only a screen has: the amount being typed,
 * the type picked for it, the parts of a hit still being put together, and the save a hit left owed.
 *
 * `hpMax` is the EFFECTIVE max, so it stays the answer to "how much HP" for everything above:
 * the view-model re-exposes it (A14 — a manual max still has `hp_max` effects folded onto it), and
 * the action executor and the short rest read it from there rather than recomputing.
 */
import type { SensitivityBucket } from '$lib/combat/helpers';
import type { Character, DeathCause } from '$lib/character/schema';
import type { CharacterSheet } from '$lib/character/derive';
import { DAMAGE_TYPES } from '$lib/components/damage-glyphs';
import {
	die,
	heal,
	hitPointMaximum,
	resolveDamagePart,
	revive,
	rollConcentrationSave,
	rollDeathSave,
	setDeathSavePip,
	setTempHp,
	takeDamage,
	type DamagePart,
	type DeathSavePip,
} from '$lib/play/hit-points';
import type { OwedConcentrationSave, PlayContext, PlayOutcome } from '$lib/play/outcome';
import type { OpenOverlay } from './menu-overlay.svelte';

/** What a Damage press will take once the character's defence against the picked type applies. */
export interface DamagePreview {
	raw: number;
	final: number;
	bucket: Exclude<SensitivityBucket, null>;
}

/** One typed part of a hit as the player enters it. */
export type DamagePartInput = DamagePart;

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

	/** The temp-HP popover's amount (two-way bound in the markup through the view-model). */
	tempHpInput = $state(5);
	setTempHp = () => {
		this.host().act((c) => setTempHp(c, { amount: this.tempHpInput }));
		this.host().overlay = null;
	};

	hpAmount = $state(1);
	/** B4 concentration-save banner: a CON save the player owes after taking damage while
	 *  concentrating. `dc` is the suggested-but-editable DC. Null = no check due. A hit leaves it,
	 *  any rolled save answers it, and the view-model drops it when the concentration it names ends
	 *  or is replaced.
	 *
	 *  `spell` is WHICH concentration it is owed for: an owed save is a fact about one spell, and
	 *  without the name the banner re-attached itself to whatever was concentrated on next — asking
	 *  for a spell that had never been hit. */
	pendingConcentrationSave = $state<OwedConcentrationSave | null>(null);
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
		const d = this.host().sheet?.damageSensitivities;
		const defended = d ? [...new Set([...d.resist, ...d.immune, ...d.vulnerable])].sort() : [];
		return [...defended, ...DAMAGE_TYPES.filter((type) => !defended.includes(type))];
	}
	/** The typed-in amount after the defence against the picked type, shown BEFORE the press so the
	 *  player sees "12 → 6" rather than finding out from the HP bar. Null when the defence changes
	 *  nothing — no type, no defence against it, or no amount yet. */
	get damagePreview(): DamagePreview | null {
		return this.previewOf({ amount: this.hpAmount, type: this.damageType });
	}
	/** The same answer for any one part of the hit. */
	previewOf = (part: DamagePartInput): DamagePreview | null => {
		const sheet = this.host().sheet;
		if (!sheet) return null;
		const { raw, final, bucket } = resolveDamagePart(part, sheet.damageSensitivities);
		return raw > 0 && bucket ? { raw, final, bucket } : null;
	};

	/**
	 * The FURTHER parts of the hit being entered, when it deals more than one type — a flame tongue's
	 * slashing and its fire. The number field and the type picker above are the first part; each of
	 * these is another amount with its own type, and its own defense. One press takes them all as ONE
	 * hit. Cleared by the press, like the crit answer.
	 */
	moreParts = $state<DamagePartInput[]>([]);
	addPart = () => {
		this.moreParts = [...this.moreParts, { amount: 1, type: null }];
	};
	removePart = (index: number) => {
		this.moreParts = this.moreParts.filter((_, i) => i !== index);
	};

	/** Was the hit that is being entered a CRITICAL? Only asked at 0 HP, where it is the difference
	 *  between one death-save failure and two — the Damage button has no attack behind it to read
	 *  crit-ness from, and one checkbox beats inferring it wrong. Default off, off again after each
	 *  hit, and off as soon as dying stops (`dyingStopped`) — its control only renders at 0 HP, so a
	 *  flag that outlived that is a flag nobody can see or unset. */
	damageWasCrit = $state(false);

	/** The character left 0 HP or became stable, so the crit answer has nothing left to be about.
	 *  Ticked and then healed instead of hit, it would sit invisible and cost two failures on some
	 *  later ordinary hit. */
	dyingStopped = () => {
		this.damageWasCrit = false;
	};

	damage = () => {
		const parts = [{ amount: this.hpAmount, type: this.damageType }, ...this.moreParts];
		const crit = this.damageWasCrit;
		this.moreParts = [];
		// crit-ness belongs to ONE hit, never to the next one
		this.damageWasCrit = false;
		this.host().act((c, ctx) => takeDamage(c, { parts, crit }, ctx));
	};
	heal = () => this.host().act((c, ctx) => heal(c, { amount: this.hpAmount }, ctx));

	/**
	 * Roll a concentration save — from the owed check (B4 banner) or from the concentration chip with
	 * nothing owed, which is the table asking for one the app cannot see the trigger for. Rolled at
	 * once and applied, like a death save: the tray has no result callback.
	 */
	rollConcentrationSave = () => {
		const owed = this.pendingConcentrationSave;
		this.host().act((c, ctx) => rollConcentrationSave(c, owed ? { dc: owed.dc } : {}, ctx));
		// the check is answered either way
		this.pendingConcentrationSave = null;
	};
	/** The B4 banner's ✕ — dismiss the reminder WITHOUT ending concentration. The spell keeps going:
	 *  the player is waving off the check (rolling it physically, a feature that ignores it, or not
	 *  caring). Surface, never force — a reminder must be dismissable. */
	dismissConcentrationSave = () => {
		this.pendingConcentrationSave = null;
	};

	/** Roll a death save (shown while at 0 HP). Always rolled at once and applied: unlike other rolls
	 *  it MUTATES play-state, the tray has no result callback, and a fixed d20-vs-10 has nothing to
	 *  customize. */
	deathSave = () => this.host().act(rollDeathSave);
	toggleDeathSave = (kind: DeathSavePip['kind'], index: number) =>
		this.host().act((c) => setDeathSavePip(c, { kind, index }));
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
