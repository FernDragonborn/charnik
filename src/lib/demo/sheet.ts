/*
 * The seeded demo character — a warlock × barbarian multiclass (DEMO-1), built to be the WIDEST
 * single-sheet coverage of the system so first-run shows the scope at a glance: pact-magic pool,
 * a real data-driven class resource (Rage, from `barbarian_rage`'s grant_resource token), CON/STR
 * meets CHA casting across two classes, a multiclass save set (first class only), an attuned magic
 * item, a feat with a live effect token (Alert), an active concentration, a mixed Hit-Dice pool, and
 * runtime buffs/conditions on top. It references REAL shipped SRD 5.2.1 content only (no hand-authored
 * data), so the whole pipeline runs against the actual content graph.
 *
 * It is just a normal seeded character, NOT a separate code path: it's saved to storage on first run
 * and edited/persisted like any other, so a user can freely play with it in the builder — and
 * `recreateDemoCharacter()` restores it to this canonical state (the "Restore demo" action).
 */
import { characterSchema, newCharacter, type Character } from '../character/schema';
import { PACT_SLOT_KEY } from '../rules/spellcasting';

const S = 'SRD 5.2.1';

/** The demo's runtime effects (buffs/debuffs/conditions) — static play-state, layered by the effects
 *  engine regardless of content, so they demonstrate the token vocabulary (flat bonus, dice bonus,
 *  condition) live. Module-level to keep `demoCharacter` under the size limit; the final
 *  `characterSchema.parse` clones it, so the shared array is never mutated. Rage is NOT here — it's a
 *  real class resource from `barbarian_rage`, so duplicating it as a runtime effect would double it. */
const DEMO_EFFECTS: Character['play']['effects'] = [
	{
		iid: 'shield-of-faith',
		label: 'Shield of Faith',
		effects: ['flat_bonus:ac+2'],
		positive: true,
		durationRounds: 100,
		startedRound: 0
	},
	{
		iid: 'bless',
		label: 'Bless',
		effects: ['flat_bonus:saves+1d4'],
		positive: true,
		durationRounds: 10,
		startedRound: 0
	},
	{
		iid: 'bane',
		label: 'Bane',
		effects: ['flat_bonus:saves-1d4'],
		positive: false,
		durationRounds: 10,
		startedRound: 0
	},
	{
		iid: 'poisoned',
		label: 'Poisoned',
		effects: ['apply_condition:poisoned'],
		positive: false
	}
];

export function demoCharacter(): Character {
	const c = newCharacter('karroth', 'Karroth the Red', '5.5e');
	// ids are snake_case (E3) and must match the SHIPPED SRD 5.2.1 content ids exactly; the demo is
	// built fresh at the current schemaVersion, so the v1→v2 ref migration never rewrites it.
	c.build.species = `species:${S}:tiefling`;
	c.build.speciesOption = `species_option:${S}:tiefling_infernal`; // Fiendish Legacy: Infernal
	c.build.background = `background:${S}:soldier`;
	// Warlock is class[0] → the multiclass save set comes from IT only (wis, cha). Both classes are ≥3
	// so each carries its subclass (subclass_level = 3 for both).
	c.build.classes = [
		{ class: `class:${S}:warlock`, level: 5, subclass: `subclass:${S}:fiend_patron` },
		{ class: `class:${S}:barbarian`, level: 3, subclass: `subclass:${S}:path_of_the_berserker` }
	];
	// Base scores stay point-buy-legal (8–15); the background's ability boosts layer on top (kept
	// separate so point-buy validation and the boost's provenance both survive).
	c.build.abilities = { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 15 };
	c.build.abilityBoosts = { con: 2, str: 1 }; // Soldier (2024): +2/+1 across STR/DEX/CON
	c.build.skills = ['arcana', 'deception', 'athletics', 'intimidation'];
	c.build.saves = ['wis', 'cha']; // warlock (first class) saving-throw proficiencies
	c.build.feats = [`feat:${S}:alert`]; // live token: flat_bonus:initiative+proficiency_bonus
	c.build.inventory = [
		{ item: `item:${S}:leather_armor`, qty: 1, equipped: true, attuned: false },
		{ item: `item:${S}:greataxe`, qty: 1, equipped: true, attuned: false }, // barbarian martial
		{ item: `item:${S}:cloak_of_protection`, qty: 1, equipped: true, attuned: true }, // attunement
		{ item: `item:${S}:handaxe`, qty: 2, equipped: false, attuned: false }
	];
	const spell = (id: string, prepared = true, alwaysPrepared = false) => ({
		spell: `spell:${S}:${id}`,
		prepared,
		alwaysPrepared
	});
	// Warlock (Pact Magic, CHA) spells — all list `warlock` in the shipped SRD spell rows.
	c.build.spells = [
		spell('eldritch_blast', false, true), // signature cantrip
		spell('hex'), // 1st-level concentration — the active concentration below
		spell('hold_person'),
		spell('invisibility'),
		spell('darkness')
	];
	c.play.hp = { current: 38, max: undefined, temp: 6 };
	c.play.hitDiceSpent = { d8: 1, d12: 1 }; // mixed pool (warlock d8 + barbarian d12), one of each spent
	c.play.spellSlotsSpent = { [PACT_SLOT_KEY]: 1 }; // one of the two 3rd-level pact slots spent
	c.play.resourcesSpent = { rage: 1 }; // one of three rages used (barbarian_rage grants 3 at level 3)
	c.play.concentration = `spell:${S}:hex`;
	c.play.inspiration = true;
	c.play.effects = DEMO_EFFECTS;
	return characterSchema.parse(c);
}
