/*
 * A weapon's mastery property as ONE attack row carries it: its name, the row that says what it does,
 * and the numbers its tokens state about that attack (`grant_value`) — Graze's damage on a miss, the
 * DC of the save Topple forces. One unit because all three are read off the same content row and
 * none of them changes the attack: a mastery is said, never folded.
 *
 * Evaluated per attack, with `attack_mod` answered, which is the one thing the sheet-wide derive
 * cannot know. A token of any other kind has no meaning on a single attack and is handed back for
 * the row to show, rather than dropped.
 */
import type { Translate } from '$lib/i18n';
import { abilityShortLabel, titleCase } from '$lib/util/format';
import { localizedName } from '$lib/content/detail';
import type { WeaponPropertyRow } from '$lib/content/weapon-properties';
import { EFFECT_KIND, parseToken, resolveEffectValue, splitGuard } from '$lib/effects/token-parser';
import { withAttackMod, type ExprContext } from '$lib/effects/context';
import { evalExpression } from '$lib/effects/expression-evaluator';

/** A mastery property as a row prints it. */
export interface WeaponMastery {
	/** The word the weapon's tag carries (`vex`). */
	id: string;
	/** Its name in the reader's language — the id itself where no pack describes the property. */
	name: string;
	/** The row that says what it does, when a pack has one: the surface reads its prose. */
	row?: WeaponPropertyRow;
	/** The numbers the property states about THIS attack (`grant_value`): Graze's damage on a miss,
	 *  the DC of the save Topple forces. Stated on the row, never folded into anything. */
	values: StatedValue[];
}

/** One number a weapon property states about an attack, under the id its token gave it. */
export interface StatedValue {
	id: string;
	amount: number;
}

/** A stated value as the row prints it: `statedValue.<id>` words the families the SRD has
 *  (`3` for a miss's damage, `CON DC 14` for a forced save), and an id no catalog knows reads as
 *  its own name beside the number. A dotted qualifier is the ability where it names one. */
function statedValueText({ id, amount }: StatedValue, translate?: Translate): string {
	const [family = id, qualifier = ''] = id.split('.');
	const fallback = `${titleCase(id.replaceAll('.', ' '))} ${amount}`;
	return translate
		? translate(`statedValue.${family}`, {
				values: { value: amount, qualifier: abilityShortLabel(qualifier, translate) },
				default: fallback,
			})
		: fallback;
}

/** What a mastery property's own tokens say about one attack. `grant_value` is the kind read here;
 *  `note:` is prose the row already shows as its text; anything else has no meaning on a single
 *  attack and is handed back as a visible note rather than dropped. */
function masteryStatements(
	row: WeaponPropertyRow | undefined,
	ctx: ExprContext,
): { values: StatedValue[]; unread: string[] } {
	const values: StatedValue[] = [];
	const unread: string[] = [];
	for (const raw of row?.data.effects ?? []) {
		const { guard, token } = splitGuard(raw);
		const parsed = parseToken(token);
		if (parsed.kind === EFFECT_KIND.note) continue;
		if (parsed.kind !== EFFECT_KIND.grantValue || !parsed.target) {
			unread.push(raw);
			continue;
		}
		if (guard !== undefined) {
			const met = evalExpression(guard, ctx);
			if (!met.ok || met.value.type !== 'number' || met.value.value === 0) continue;
		}
		const { amount } = resolveEffectValue(parsed, ctx);
		if (amount === undefined) unread.push(raw);
		else values.push({ id: parsed.target, amount });
	}
	return { values, unread };
}

/** One weapon's mastery for an attack made with the ability modifier `mod`, plus the tokens on its
 *  row that say nothing about an attack. Nothing at all when the weapon names no property. */
export function masteryFor(
	rows: ReadonlyMap<string, WeaponPropertyRow>,
	id: string,
	{ mod, ctx, locale }: { mod: number; ctx: ExprContext; locale: string },
): { mastery?: WeaponMastery; unread: string[] } {
	if (!id) return { unread: [] };
	const row = rows.get(id);
	const { values, unread } = masteryStatements(row, withAttackMod(ctx, mod));
	const name = row ? localizedName(row, locale) : id;
	return { mastery: { id, name, ...(row ? { row } : {}), values }, unread };
}

/** The mastery's own words on the row: its name, then each number it states. */
export const masteryText = (mastery: WeaponMastery, translate?: Translate): string =>
	[mastery.name, ...mastery.values.map((v) => statedValueText(v, translate))].join(' ');
