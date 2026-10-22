/*
 * What a weapon's PROPERTIES say about one attack made with it — its mastery (when the character has
 * drilled that kind of weapon) and the plain properties it carries, like Light.
 *
 * A property is a `weapon_property` content row keyed by the word the weapon's tag carries, and its
 * tokens are read HERE, per attack, never gathered onto the whole character: `grant_value` states a
 * number about the attack (Graze's damage on a miss, the DC Topple forces), `extra_attack` says
 * the weapon lets you make one more, and `advantage` / `disadvantage` on `attack` is how attacks
 * with this weapon roll (Heavy, for a wielder its rule names). All are evaluated with `attack_mod`
 * answered, which is the one thing the sheet-wide derive cannot know.
 *
 * One unit because every answer here comes off the same rows and none of it changes the attack
 * itself: a property is said, or offered, never folded. A token of any other kind means nothing on
 * a single attack and is handed back for the row to show, rather than dropped.
 */
import type { Translate } from '$lib/i18n';
import { abilityShortLabel, titleCase } from '$lib/util/format';
import { localizedName } from '$lib/content/detail';
import { ITEM_TAG, type ItemTags } from '$lib/content/item-tags';
import type { WeaponPropertyRow } from '$lib/content/weapon-properties';
import {
	EFFECT_KIND,
	EXTRA_ATTACK_WORD,
	grantsExtraAttack,
	parseToken,
	resolveEffectValue,
	scopeMatches,
	splitGuard,
} from '$lib/effects/token-parser';
import type { ExtraAttackRule } from '$lib/effects/facts';
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
interface StatedValue {
	id: string;
	amount: number;
}

/** What an extra attack costs the turn: a Bonus Action, or nothing — it rides the Attack action. */
type ExtraAttackCost = typeof EXTRA_ATTACK_WORD.bonus | typeof EXTRA_ATTACK_WORD.free;

/** One more attack a weapon's property lets the character make this turn. */
export interface ExtraAttack {
	/** The property that GRANTS it (`light`, `cleave`) — the id every statement about it names. */
	property: string;
	/** What the control is called: the row that shaped it last, so a drilled Nick names the attack
	 *  the Light property grants. */
	name: string;
	cost: ExtraAttackCost;
	/** The rows whose text explains it, the granting one first. */
	rows: WeaponPropertyRow[];
	/** Does the ability modifier ride on its damage? RAW leaves a positive one off ("you don't add
	 *  your ability modifier to the extra attack's damage unless that modifier is negative"); a
	 *  feature that says `modifier` puts it back. */
	addsModifier: boolean;
}

/** The d20 Test target a property's roll mode is read on: attacks made with its weapon. */
const ATTACK_TARGET = 'attack';

/** How a property makes attacks with its weapon roll, and which property says so. */
export interface AttackRollMode {
	mode: typeof EFFECT_KIND.advantage | typeof EFFECT_KIND.disadvantage;
	source: string;
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

/** The mastery's own words on the row: its name, then each number it states. */
export const masteryText = (mastery: WeaponMastery, translate?: Translate): string =>
	[mastery.name, ...mastery.values.map((v) => statedValueText(v, translate))].join(' ');

/** What one property row's tokens say, split by kind. */
interface RowStatements {
	values: StatedValue[];
	rules: ExtraAttackRule[];
	/** Roll modes, each with the tags its weapon must carry (`attack.melee`). */
	modes: (AttackRollMode & { scope?: string })[];
	unread: string[];
}

/** Read one property row for an attack. `note:` is prose the row already shows as its text. */
function statementsOf(row: WeaponPropertyRow, name: string, ctx: ExprContext): RowStatements {
	const out: RowStatements = { values: [], rules: [], modes: [], unread: [] };
	for (const raw of row.data.effects) {
		const { guard, token } = splitGuard(raw);
		const parsed = parseToken(token);
		if (parsed.kind === EFFECT_KIND.note) continue;
		if (guard !== undefined) {
			const met = evalExpression(guard, ctx);
			if (!met.ok || met.value.type !== 'number' || met.value.value === 0) continue;
		}
		if (parsed.kind === EFFECT_KIND.extraAttack && parsed.target && parsed.extraAttack) {
			const { target: property, extraAttack: words, scope } = parsed;
			out.rules.push({ property, words, source: name, ...(scope ? { scope } : {}) });
			continue;
		}
		if (
			(parsed.kind === EFFECT_KIND.advantage || parsed.kind === EFFECT_KIND.disadvantage) &&
			parsed.target === ATTACK_TARGET
		) {
			const { kind: mode, scope } = parsed;
			out.modes.push({ mode, source: name, ...(scope ? { scope } : {}) });
			continue;
		}
		const amount =
			parsed.kind === EFFECT_KIND.grantValue ? resolveEffectValue(parsed, ctx).amount : undefined;
		if (parsed.target && amount !== undefined) out.values.push({ id: parsed.target, amount });
		else out.unread.push(raw);
	}
	return out;
}

/** Does a weapon carry every tag a scope asks for? No scope asks for nothing. */
const inScope = (tags: ItemTags, scope: string | undefined): boolean => scopeMatches(scope, tags);

/** Does a weapon carry this property — as a plain tag, or as the mastery its tag names — and every
 *  tag the scope asks for beside it? */
export const carriesProperty = (
	tags: ItemTags,
	property: string,
	scope: string | undefined,
): boolean =>
	(tags.has(property) || tags.get(ITEM_TAG.mastery) === property) && inScope(tags, scope);

/** What `attackProperties` is asked about: one weapon, and the attack made with it. */
export interface AttackPropertiesInput {
	/** Property word → its row, for the character's edition. */
	rows: ReadonlyMap<string, WeaponPropertyRow>;
	tags: ItemTags;
	/** Has the character drilled this kind of weapon? Without it the mastery says nothing. */
	mastered: boolean;
	/** The ability modifier this attack resolved from. */
	mod: number;
	/** `extra_attack` statements the CHARACTER makes (a feat that re-prices or adjusts one). */
	rules: readonly ExtraAttackRule[];
	/** Is ANOTHER wielded weapon carrying this property, within this scope? What `other` asks. */
	isPaired: (property: string, scope: string | undefined) => boolean;
	ctx: ExprContext;
	locale: string;
}

/** Everything this weapon's properties say about one attack. */
export function attackProperties(input: AttackPropertiesInput): {
	mastery?: WeaponMastery;
	extras: ExtraAttack[];
	modes: AttackRollMode[];
	unread: string[];
} {
	const { rows, tags, mod, locale } = input;
	const ctx = withAttackMod(input.ctx, mod);
	const masteryId = input.mastered ? (tags.get(ITEM_TAG.mastery) ?? '') : '';
	// the plain properties first and the mastery last, so the mastery is the row that "shaped it last"
	const ids = [...[...tags.keys()].filter((id) => id !== ITEM_TAG.mastery), masteryId];
	const read = ids.flatMap((id) => {
		const row = rows.get(id);
		return row ? [{ id, row, ...statementsOf(row, localizedName(row, locale), ctx) }] : [];
	});
	const ownRules = read.flatMap((r) => r.rules.map((rule) => ({ ...rule, row: r.row })));
	const applies = (rule: ExtraAttackRule) => inScope(tags, rule.scope);
	const about = (property: string) => [
		...ownRules.filter((rule) => rule.property === property && applies(rule)),
		...input.rules.filter((rule) => rule.property === property && applies(rule)),
	];

	const extras = ownRules
		.filter(
			(rule) =>
				grantsExtraAttack(rule.words) &&
				applies(rule) &&
				(!rule.words.includes(EXTRA_ATTACK_WORD.other) ||
					input.isPaired(rule.property, rule.scope)),
		)
		.map((grant): ExtraAttack => {
			const said = about(grant.property);
			const says = (word: string) => said.some((rule) => rule.words.some((w) => w === word));
			const shapers = ownRules.filter((rule) => rule.property === grant.property);
			return {
				property: grant.property,
				name: shapers.at(-1)?.source ?? grant.source,
				cost: says(EXTRA_ATTACK_WORD.free) ? EXTRA_ATTACK_WORD.free : EXTRA_ATTACK_WORD.bonus,
				rows: [...new Set([grant.row, ...shapers.map((rule) => rule.row)])],
				addsModifier: says(EXTRA_ATTACK_WORD.modifier),
			};
		});

	const mastered = read.find((r) => r.id === masteryId);
	const masteryRow = rows.get(masteryId);
	const mastery: WeaponMastery | undefined = masteryId
		? {
				id: masteryId,
				name: masteryRow ? localizedName(masteryRow, locale) : masteryId,
				...(masteryRow ? { row: masteryRow } : {}),
				values: mastered?.values ?? [],
			}
		: undefined;
	return {
		...(mastery ? { mastery } : {}),
		extras,
		modes: read.flatMap((r) =>
			r.modes
				.filter((mode) => inScope(tags, mode.scope))
				.map(({ mode, source }) => ({ mode, source })),
		),
		// a number stated by a plain property has no word on the row to stand beside, so it is shown
		// as the token it is — the same visible fate as any other kind this site does not read
		unread: read.flatMap((r) =>
			r.id === masteryId ? r.unread : [...r.unread, ...r.row.data.effects.filter(isGrantValue)],
		),
	};
}

const isGrantValue = (raw: string): boolean =>
	parseToken(splitGuard(raw).token).kind === EFFECT_KIND.grantValue;
