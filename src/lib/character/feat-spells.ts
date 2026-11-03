import type { ContentGraph } from '../content/loader';
import type { SpellAccess } from '../content/spellAccess';
import { ISSUE_KEY, type EffectIssue } from '../effects/token-parser';
import type { Ability } from '../rules/core';
import type { Character } from './schema';
import type { SpellcastingClass } from './spellcasting';

/** One rung of a feat's spell grant: how many spells of that level it teaches. */
export interface FeatSpellGrant {
	level: number;
	count: number;
}

/** Parse a feat's `spell_choice` column — `spell level:count` pairs (`"0:2,1:1"` = two cantrips and
 *  one level-1 spell). The colon is spell level against count; a CLASS level would be `@`
 *  (`content/level-gate.ts`), which a feat's grant does not need. A malformed
 *  pair is dropped rather than guessed at: a feat that teaches nothing shows as teaching nothing. */
export function featSpellGrants(spec: string | undefined): FeatSpellGrant[] {
	if (!spec) return [];
	const out: FeatSpellGrant[] = [];
	for (const pair of spec.split(',')) {
		const [lvl, n] = pair.split(':');
		const level = Number(lvl);
		const count = Number(n);
		if (Number.isFinite(level) && Number.isFinite(count) && count > 0) out.push({ level, count });
	}
	return out;
}

/**
 * The caster profiles a character's SPELL-GRANTING FEATS are, one per taken instance (Magic Initiate
 * is repeatable, and each instance is its own list, its own ability and its own two cantrips).
 *
 * A feat that teaches spells IS a caster profile RAW — it names the ability its spells are cast with,
 * which is the whole of what a profile decides. Modelled as one rather than as a fourth kind of spell
 * grant, the ordinary machinery does the rest for free: the builder's picker gets a section with the
 * feat's own caps, `casterForSpell` attributes the picks to it, and the sheet shows their DC and
 * attack off the chosen ability instead of off whichever class happened to be first.
 *
 * It carries no slots and no share of the caster level — the free cast a feat grants is a
 * `grant_resource` pool in its own row, and RAW a feat never advances spellcasting.
 */
interface FeatCasterInput {
	character: Character;
	graph: ContentGraph;
	access: SpellAccess;
	statsFor: (ability: Ability, classId: string) => Pick<SpellcastingClass, 'saveDC' | 'attack'>;
	issues?: EffectIssue[];
}

export function featCasterProfiles({
	character,
	graph,
	access,
	statsFor,
	issues,
}: FeatCasterInput): SpellcastingClass[] {
	const out: SpellcastingClass[] = [];
	for (const taken of character.build.featSpells) {
		// an answer for a feat the character no longer HAS is residue (a hand-edited save, an older
		// build): the feats list is the record of what they took, and a profile is not conjured beside it
		if (!character.build.feats.includes(taken.feat)) continue;
		const feat = graph.get(taken.feat);
		if (feat?.type !== 'feat') continue;
		const grants = featSpellGrants(feat.data.spell_choice);
		if (!grants.length) continue;
		if (taken.spells === undefined)
			issues?.push({
				source: feat.data.name_en,
				token: taken.feat,
				key: ISSUE_KEY.featSpellOwnershipMissing,
				values: { source: feat.data.name_en },
			});
		// the chosen list is a bare class id; its ROW is this character's edition of that class, which
		// is what the access index is keyed by
		const listRow = graph
			.list('class', { system: character.system })
			.find((c) => c.id === taken.list);
		const cantrips = grants.find((g) => g.level === 0)?.count ?? 0;
		const leveled = grants.filter((g) => g.level > 0);
		const profileId = `${taken.feat}.${taken.key}`;
		out.push({
			// keyed by the SLOT the feat sits in, so two instances of a repeatable feat are two
			// profiles with two lists and never one that swallows the other's picks
			classId: profileId,
			classEffectiveId: profileId,
			className: feat.data.name_en,
			ability: taken.ability,
			...statsFor(taken.ability, profileId),
			// "known", never "prepared": the spells a feat teaches are fixed until you level up and
			// swap one — there is no re-prepare on a rest
			prepareStyle: 'known',
			cantripCap: cantrips,
			preparedCap: leveled.reduce((n, g) => n + g.count, 0),
			maxSpellLevel: leveled.reduce((n, g) => Math.max(n, g.level), 0),
			accessSpellIds: listRow ? access.spellIdsForClass(listRow.effectiveId) : [],
			isPact: false,
			// the feat's own statement: SRD 5.2.1 lets any spellcaster ritual a spell they have
			// prepared, and a feat that keeps its spell always prepared says so on its row
			ritualSource: feat.data.ritual_source ?? null,
			grantedSpells: taken.spells ?? [],
			...(taken.spells ? { chosenSpells: taken.spells } : {}),
		});
	}
	return out;
}
