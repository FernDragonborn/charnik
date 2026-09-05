/*
 * What a cast's roll is CALLED, how its provenance reads as one line, and what an upcast PREVIEWS.
 *
 * A spell's own word is DATA — a content row wrote it and no catalog knows it — while the phrase
 * around it is the app's. So the name is a key plus that word as a value, and the slot picks the
 * key rather than being appended to the sentence it produced: "(slot 5)" glued onto a translated
 * phrase is not a part a translator can move.
 */
import { t, translator } from '$lib/i18n';
import { sayText, type SaidText } from '$lib/util/say';
import { formatDamageParts, metres } from '$lib/combat/helpers';
import type { evalUpcast } from '$lib/effects/upcast';
import type { RollName } from '$lib/combat/roll';

/** What a non-attack cast produces. A named member because it selects the roll's NAME, and a bare
 *  string would let a typo pick a key that does not exist. */
export const SPELL_OUTCOME = { damage: 'damage', healing: 'healing', tempHp: 'tempHp' } as const;
export type SpellOutcomeKind = (typeof SPELL_OUTCOME)[keyof typeof SPELL_OUTCOME];

/** The roll's name. `slot` is present only when the cast was UPCAST, which is what makes it six keys
 *  rather than three: the slot has to sit inside the phrase, and the name is the half that survives
 *  the Playbar's strip layout, where the note under the card is hidden. */
export const spellRollName = (
	name: string,
	kind: SpellOutcomeKind,
	slot: number | undefined,
): RollName => {
	const key = `combat.log.spell.${kind}${slot === undefined ? '' : 'Slot'}`;
	const values = slot === undefined ? { name } : { name, slot };
	return { text: t(key, values), key, values };
};

/** The provenance as one line, for the tray's editable note pill — the moment it lands there it is
 *  the player's own text, so it is said once rather than carried as facts. Empty when there is none. */
export const saidNote = (parts: SaidText[]): string =>
	parts.map((part) => sayText(part, translator())).join(' · ');

/**
 * A short summary of what a slot yields BEYOND a spell's base — the extra damage/heal dice, the
 * scaled count / area / duration / HP-max (items 1 + 8). Empty for a non-scaling spell.
 *
 * Dice are NOTATION and pass through: "+2d6" is the same in every language. Everything else is a
 * word, so it reads from the catalog; area shows metric next to imperial (H10).
 */
export const upcastPreview = (results: ReturnType<typeof evalUpcast>): string => {
	const bits: string[] = [];
	for (const res of results) {
		if ('error' in res) continue;
		if (res.kind === 'damage' || res.kind === 'heal') {
			if (Object.keys(res.pool).length === 0 && res.flat === 0) continue;
			bits.push(`+${formatDamageParts([{ pool: res.pool, mod: res.flat, type: res.type ?? '' }])}`);
		} else if (res.kind === 'count') bits.push(t('combat.upcast.count', { n: res.flat }));
		else if (res.kind === 'area')
			bits.push(t('combat.upcast.area', { feet: res.flat, metres: metres(res.flat) }));
		else if (res.kind === 'hp_max' && res.flat)
			bits.push(t('combat.upcast.hpMax', { n: res.flat }));
		else if (res.kind === 'temp_hp' && res.flat)
			bits.push(t('combat.upcast.tempHp', { n: res.flat }));
		else if (res.kind === 'enhancement' && res.flat)
			bits.push(t('combat.upcast.enhancement', { n: res.flat }));
		else if (res.kind === 'duration')
			bits.push(
				res.isInfinite ? t('combat.upcast.permanent') : t('combat.upcast.rounds', { n: res.flat }),
			);
	}
	return bits.join(' · ');
};
