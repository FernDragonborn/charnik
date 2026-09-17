/*
 * Behavioral net for the Build view-model. Drives the REAL rune VM (compiled via the svelte plugin
 * in vitest.config) through stable boundaries only — `hydrate(Character)` in, the assembled
 * `Character` out — so it survives refactors of the VM's internal shape (field regroup, method
 * merges). It asserts WHAT a build produces, never HOW the VM is structured.
 */
import { makeTempContentRoot } from '../../test-support/fixtures';
import 'fake-indexeddb/auto'; // the draft session writes through the real Storage seam
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUserStorage } from '$lib/storage/provider';
import { listDrafts, deleteDraft } from '$lib/character/draft-repository';
import { loadCharacter, readCharacterPhoto } from '$lib/character/repository';
import { type ContentGraph } from '$lib/content/loader';
import { characterSchema, newCharacter, type Character } from '$lib/character/schema';
import { build, ASI } from './build-view-model.svelte';
import { newClassRow, ORIGIN_SLOT_KEY } from './draft';
import { targetForTodo, sameTarget } from './inspector-specs';
import { toggleSource } from '$lib/content/sources.svelte';

const S = 'SRD 5.2.1';

async function graphOf(): Promise<ContentGraph> {
	return makeTempContentRoot({
		'classes_srd.csv': [
			'id,systems,source,name_en,hit_die,saves,caster,spell_ability,asi_levels',
			`wizard,5.5e,${S},Wizard,d6,"int,wis",full,int,"4,8,12,16,19"`,
			`fighter,5.5e,${S},Fighter,d10,"str,con",none,,"4,6,8,12,14,16,19"`,
			`rogue,5.5e,${S},Rogue,d8,"dex,int",none,,"4,8,10,12,16,19"`
		].join('\n'),
		'class_features_srd.csv': [
			'id,systems,source,name_en,class_id,level,expertise_slots',
			`expertise,5.5e,${S},Expertise,rogue,1,"1:2,6:2"`
		].join('\n'),
		'feats_srd.csv': [
			'id,systems,source,name_en,category,ability_choice,skill_choice',
			`alert,5.5e,${S},Alert,general,,`,
			`tough,5.5e,${S},Tough,general,,`,
			// two half-feats with DISJOINT +1 options, and a third overlapping one: what a slot keeps
			// across a swap is decided by whether the new feat still offers the ability
			`wide,5.5e,${S},Wide Reader,general,"int,cha",`,
			`grappler,5.5e,${S},Grappler,general,"str,dex",`,
			`lore,5.5e,${S},Lore Keeper,general,"cha,wis",`,
			`skilled,5.5e,${S},Skilled,origin,,3`,
			// a half-feat origin feat: no SRD background grants one, a homebrew pack may
			`gifted,5.5e,${S},Gifted,origin,"str,dex",`
		].join('\n'),
		'backgrounds_srd.csv': [
			'id,systems,source,name_en,skills,origin_feat',
			`scholar,5.5e,${S},Scholar,"arcana,history",skilled`,
			`prodigy,5.5e,${S},Prodigy,,gifted`
		].join('\n'),
		'species_srd.csv': [
			'id,systems,source,name_en,effects,size,speed,creature_type',
			`hardy,5.5e,${S},Hardy,flat_bonus:con+2,medium,30,humanoid`
		].join('\n'),
		'spells_srd.csv': [
			'id,systems,source,name_en,level,school,casting_time,range,duration,components',
			`fireball,5.5e,${S},Fireball,3,evocation,action,150 ft,instant,V S M`
		].join('\n'),
	});
}

/** A fully-specified saved character to round-trip through the builder. */
function savedCharacter(): Character {
	const c = newCharacter('valen', 'Valen', '5.5e');
	c.build.species = `species:${S}:hardy`;
	c.build.classes = [{ class: `class:${S}:wizard`, level: 3 }];
	c.build.abilities = { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 12 };
	c.build.skills = ['arcana', 'history'];
	c.build.languages = [`language:${S}:common`];
	c.build.spells = [{ spell: `spell:${S}:fireball`, prepared: true, alwaysPrepared: false }];
	return characterSchema.parse(c);
}

describe('BuildVM · hydrate → assemble round-trip (behavioral)', () => {
	let graph: ContentGraph;
	beforeEach(async () => {
		graph = await graphOf();
		build.reset();
		build.graph = graph;
	});

	it('previewing an option leaves the draft exactly as it was', () => {
		build.draft.name = 'Valen';
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:wizard`, subclassId: null, level: 3 }];
		const before = JSON.stringify(build.draft);

		// the inspector's diff runs the REAL pipeline on a draft of its own; nothing outside may see it
		const sheet = build.previewSheet((trial) => {
			trial.draft.speciesId = `species:${S}:hardy`;
			trial.draft.skills = ['arcana'];
		});

		// the trial really was derived — an empty diff would pass a weaker assertion for free
		expect(sheet?.abilities.con.score.value).toBe(10); // 8 + the species' +2
		expect(JSON.stringify(build.draft)).toBe(before);
	});

	it('preserves identity, system, and the core build choices', () => {
		const saved = savedCharacter();
		build.hydrate(saved);
		const out = build.assembled; // the assembled Character

		expect(out.id).toBe('valen');
		expect(out.system).toBe('5.5e');
		expect(out.build.name).toBe('Valen');
		expect(out.build.species).toBe(`species:${S}:hardy`);
		expect(out.build.classes).toMatchObject([{ class: `class:${S}:wizard`, level: 3 }]);
		expect(out.build.classes[0]?.rowId).toBeTruthy(); // the row keeps an identity of its own
		expect(out.build.abilities).toEqual(saved.build.abilities);
	});

	it('keeps chosen languages, skills, and spell refs (skills may gain auto-grants)', () => {
		const saved = savedCharacter();
		build.hydrate(saved);
		const out = build.assembled;

		expect(out.build.languages).toContain(`language:${S}:common`);
		for (const skill of saved.build.skills) expect(out.build.skills).toContain(skill);
		expect(out.build.spells.map((s) => s.spell)).toContain(`spell:${S}:fireball`);
	});

	it('carries the languages and tools a player TYPED, which no content row backs', () => {
		const saved = savedCharacter();
		saved.build.customLanguages = ['Thieves’ cant of my table'];
		saved.build.customTools = ['Glassblower’s tools'];
		build.hydrate(saved);
		const out = build.assembled;

		expect(out.build.customLanguages).toEqual(['Thieves’ cant of my table']);
		expect(out.build.customTools).toEqual(['Glassblower’s tools']);
		// and a save written before the two columns existed still parses, with nothing typed in it
		const legacy = characterSchema.parse({
			...saved,
			build: { ...saved.build, customLanguages: undefined, customTools: undefined },
		});
		expect(legacy.build.customLanguages).toEqual([]);
		expect(legacy.build.customTools).toEqual([]);
	});

	it('preserves item attunement through the hydrate → assemble round-trip (D15)', () => {
		const saved = savedCharacter();
		saved.build.inventory = [
			{ item: `item:${S}:ring_of_protection`, qty: 1, equipped: true, attuned: true }
		];
		build.hydrate(characterSchema.parse(saved));
		const out = build.assembled;
		expect(out.build.inventory).toEqual([
			{ item: `item:${S}:ring_of_protection`, qty: 1, equipped: true, attuned: true }
		]);
	});

	it('a round trip with NOTHING clicked changes no play-side decision the save recorded', () => {
		// the guard the dropped-field family needed: `attuned`, then `base` (which weapon a template
		// magic item IS), then every prepared flag were each lost by a mapper that copies field by field
		const saved = savedCharacter();
		saved.build.inventory = [
			{ item: `item:${S}:flame_tongue`, qty: 1, equipped: true, attuned: true, base: `item:${S}:longsword` }
		];
		saved.build.spells = [
			{ spell: `spell:${S}:fireball`, prepared: false, alwaysPrepared: false }, // put away by the player
			{ spell: `spell:${S}:light`, prepared: true, alwaysPrepared: true } // granted by the class
		];
		const parsed = characterSchema.parse(saved);
		build.hydrate(parsed);
		const out = build.assembled;

		expect(out.build.inventory).toEqual(parsed.build.inventory);
		expect(out.build.spells).toEqual(parsed.build.spells);
	});

	it('derives ASI/feat slots from the class asi_levels data (Fighter gets 6 & 14)', () => {
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 14 }];
		expect(build.feats.featSlots.map((s) => s.level)).toEqual([4, 6, 8, 12, 14]);
	});

	it('level-up restores filled ASI slots and applies each boost ONCE, not twice (UBUG-13)', () => {
		build.draft.name = 'Asi';
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:wizard`, subclassId: null, level: 4 }];
		build.draft.abilities = { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 12 };
		const slot = build.feats.featSlots[0]; // the level-4 ASI slot
		expect(slot).toBeDefined();
		const key = slot?.key ?? '';
		build.feats.setSlotFeat(key, ASI);
		build.feats.toggleAsiPick(key, 'con'); // shape '2' → +2 CON
		const saved = characterSchema.parse(build.assembled);
		expect(saved.build.abilityBoosts.con).toBe(2);
		expect(saved.build.slotPicks.feats[key]).toBe(ASI); // slot persisted

		// re-open the SAME character (a level-up entry): the slot restores FILLED and its boost is
		// applied once — re-hydrating must not stack a second +2 on top of the carried flat boost.
		build.reset();
		build.graph = graph;
		build.hydrate(saved);
		expect(build.draft.slotFeats[key]).toBe(ASI); // shown filled, not blank
		expect(build.assembled.build.abilityBoosts.con).toBe(2); // once, not 4
	});

	it('a full ability picker replaces its oldest pick rather than ignoring the click', () => {
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:wizard`, subclassId: null, level: 4 }];
		const key = build.feats.featSlots[0]?.key ?? '';
		build.feats.setSlotFeat(key, ASI);

		// shape '2' takes ONE target, so the second click lands on a picker that is already full
		build.feats.toggleAsiPick(key, 'con');
		build.feats.toggleAsiPick(key, 'int');
		expect(build.draft.slotAsi[key]?.picks).toEqual(['int']);
		expect(build.assembled.build.abilityBoosts.int).toBe(2);
		expect(build.assembled.build.abilityBoosts.con).toBeUndefined();

		// '1-1' takes two, and a third click drops the one chosen first
		build.feats.setAsiShape(key, '1-1');
		build.feats.toggleAsiPick(key, 'str');
		build.feats.toggleAsiPick(key, 'dex');
		expect(build.draft.slotAsi[key]?.picks).toEqual(['str', 'dex']);
		build.feats.toggleAsiPick(key, 'wis');
		expect(build.draft.slotAsi[key]?.picks).toEqual(['dex', 'wis']);

		// clicking one you already hold still takes it back — replacing is only what a FULL picker does
		build.feats.toggleAsiPick(key, 'dex');
		expect(build.draft.slotAsi[key]?.picks).toEqual(['wis']);
	});

	it('a class row that already holds one says it swaps, not adds', () => {
		build.inspector.open({ id: 'class', index: 0 });
		expect(build.inspector.spec?.blurbKey).toBe('classBlurb');

		// once filled, the same control replaces — and its diff moves the saves and the spellcasting,
		// which reads as the app breaking the multiclass rule unless the pane says what it is doing
		build.classRows.setClass(0, `class:${S}:wizard`);
		expect(build.inspector.spec?.blurbKey).toBe('classReplaceBlurb');
		expect(build.inspector.spec?.values).toEqual({ class: 'Wizard' });
	});

	it('a class another row already holds is not offered again', () => {
		build.classRows.setClass(0, `class:${S}:wizard`);
		build.classRows.addClass();
		build.classRows.setClass(1, `class:${S}:fighter`);

		build.inspector.open({ id: 'class', index: 0 });
		const offered = build.inspector.options.map((r) => r.effectiveId);
		expect(offered).toContain(`class:${S}:wizard`); // the row's own class stays, and stays gold
		expect(offered).not.toContain(`class:${S}:fighter`); // taking it here would be Fighter/Fighter
	});

	it('undo and redo walk the whole draft back and forward', () => {
		// the page records on the autosave debounce; a test settles each step itself
		build.draft.name = 'Alia';
		build.history.record();
		build.classRows.setClass(0, `class:${S}:wizard`);
		build.history.record();

		build.history.undo();
		expect(build.draft.classes[0]?.classId).toBeNull();
		expect(build.draft.name).toBe('Alia'); // one step, not everything since the start
		build.history.undo();
		expect(build.draft.name).toBe('');
		expect(build.history.canUndo).toBe(false);

		build.history.redo();
		expect(build.draft.name).toBe('Alia');
		build.history.redo();
		expect(build.draft.classes[0]?.classId).toBe(`class:${S}:wizard`);
		expect(build.history.canRedo).toBe(false);
	});

	it('a fresh change forgets what was undone, and an unchanged draft is not a step', () => {
		build.draft.name = 'Alia';
		build.history.record();
		build.history.record(); // settled twice with nothing between
		build.history.undo();
		expect(build.draft.name).toBe('');
		expect(build.history.canUndo).toBe(false); // the second record added no step to walk back over

		build.draft.name = 'Bern';
		build.history.record();
		expect(build.history.canRedo).toBe(false); // the branch that held "Alia" is gone
	});

	it('a blank reset produces a minimal valid character (no crash on empty draft)', () => {
		const out = build.assembled;
		expect(out.build.name).toBeTruthy();
		expect(out.build.classes).toEqual([]);
	});

	it('autosaves a draft only once it holds a decision, and not while editing a real character', async () => {
		const storage = getUserStorage();
		await build.drafts.persist();
		expect(await listDrafts(storage)).toEqual([]); // nothing decided → no file to litter with

		build.draft.name = 'Hilda';
		await build.drafts.persist();
		expect((await listDrafts(storage)).map((d) => d.summary.name)).toEqual(['Hilda']);

		await build.drafts.discard(); // the draft became a character
		expect(await listDrafts(storage)).toEqual([]);

		build.hydrate(savedCharacter()); // editing an existing character — its own save is the record
		await build.drafts.persist();
		expect(await listDrafts(storage)).toEqual([]);
	});

	it('a level-up that lands before the content graph does not double the carried boost (B1)', () => {
		build.draft.name = 'Asi';
		// level 6 is a Fighter-only ASI level: the fallback the builder uses with no graph does not
		// know about it, which is what made the timing matter
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 6 }];
		const key = build.feats.featSlots.find((s) => s.level === 6)?.key ?? '';
		expect(key).toBeTruthy();
		build.feats.setSlotFeat(key, ASI);
		build.feats.toggleAsiPick(key, 'con');
		const saved = characterSchema.parse(build.assembled);
		expect(saved.build.abilityBoosts.con).toBe(2);

		// the page navigates into the level-up before the content load returns
		build.reset();
		build.graph = null;
		build.hydrate(saved);
		build.graph = graph; // …and the graph lands a moment later
		expect(build.assembled.build.abilityBoosts.con).toBe(2); // once, not 4
	});

	it('a level-up starts its own draft identity and leaves the unfinished build alone (B2)', async () => {
		const storage = getUserStorage();
		build.reset();
		build.graph = graph;
		build.draft.name = 'Unfinished';
		await build.drafts.persist();
		const unfinished = build.drafts.guid;
		expect((await listDrafts(storage)).map((d) => d.guid)).toEqual([unfinished]);

		// "Level up" on another character, in the same tab, then Create: the save discards the draft
		// it is holding, and holding somebody else's is how an untouched build disappears
		build.hydrate(savedCharacter());
		expect(build.drafts.guid).not.toBe(unfinished);
		await build.drafts.discard();
		expect((await listDrafts(storage)).map((d) => d.guid)).toEqual([unfinished]);
		await deleteDraft(storage, unfinished); // the tests share one store
	});

	it('a level-up does not inherit the previous build class stash (B3)', () => {
		build.classRows.setClass(0, `class:${S}:fighter`);
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 7 }];
		build.draft.skills = ['athletics'];
		build.classRows.setClass(0, `class:${S}:wizard`); // stashes the Fighter at level 7, with its skills

		build.hydrate(savedCharacter()); // Valen, Wizard 3
		build.classRows.setClass(0, `class:${S}:fighter`);
		expect(build.draft.classes[0]?.level).toBe(3); // the level Valen has, not the stash's 7
		expect(build.draft.skills).not.toContain('athletics');
	});

	it('writes a picked portrait into the character folder on save, and names it in the save (PORTRAIT)', async () => {
		const storage = getUserStorage();
		build.reset();
		build.graph = graph;
		build.hydrate(savedCharacter());
		// the DECODE is a webview API (covered in photo.browser.test.ts); what is under test here is
		// where the bytes go and what the save says about them
		build.pickedPhoto = { bytes: new Uint8Array([3, 1, 4]), ext: 'webp', mime: 'image/webp' };
		// creating is gated on the blocking todos, and this fixture character has two open ones
		build.draft.backgroundId = `background:${S}:prodigy`;
		build.draft.selectedSpells = [];
		build.feats.setSlotFeatAbility(ORIGIN_SLOT_KEY, 'dex'); // the background's half-feat pick
		expect(build.canCreate).toBe(true);

		await build.save();
		expect(Array.from(await readCharacterPhoto(storage, 'valen', 'photo.webp'))).toEqual([3, 1, 4]);
		expect((await loadCharacter(storage, 'valen')).character?.build.photo).toBe('photo.webp');
		expect(build.pickedPhoto).toBeNull(); // written, so no longer pending

		// re-saving without picking again keeps the portrait — the draft carries its NAME
		await build.save();
		expect((await loadCharacter(storage, 'valen')).character?.build.photo).toBe('photo.webp');

		// …and the way out takes the file with it, not just the reference
		build.clearPhoto();
		await build.save();
		expect((await loadCharacter(storage, 'valen')).character?.build.photo).toBeUndefined();
		expect((await storage.list('characters/valen')).some((e) => e.name.startsWith('photo.'))).toBe(
			false,
		);
	});

	it('closes the inspector when the draft under it is replaced (B17)', () => {
		build.inspector.open({ id: 'species' });
		build.hydrate(savedCharacter());
		expect(build.inspector.target).toBeNull();

		build.inspector.open({ id: 'species' });
		build.reset();
		expect(build.inspector.target).toBeNull();
	});

	it('a failed autosave says so and writes the same body on the next try (B5)', async () => {
		const storage = getUserStorage();
		build.reset();
		build.graph = graph;
		build.draft.name = 'Doomed';

		const write = vi.spyOn(storage, 'write').mockRejectedValueOnce(new Error('disk full'));
		await build.drafts.persist(); // the page calls this as `void persist()` — it must not reject
		const names = async () => (await listDrafts(storage)).map((d) => d.summary.name);
		expect(await names()).not.toContain('Doomed');
		write.mockRestore();

		// the SAME body again: a write recorded before it happened would short-circuit here forever
		await build.drafts.persist();
		expect(await names()).toContain('Doomed');
		await build.drafts.discard();
	});

	it('a failed Create says so, returns null, and leaves nothing half-done', async () => {
		const storage = getUserStorage();
		build.reset();
		build.graph = graph;
		build.draft.name = 'Doomed';
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 1 },
		];
		build.draft.speciesId = `species:${S}:hardy`;
		build.draft.backgroundId = `background:${S}:prodigy`;
		build.feats.setSlotFeatAbility(ORIGIN_SLOT_KEY, 'dex');
		build.draft.skills = ['arcana', 'history'];

		const write = vi.spyOn(storage, 'write').mockRejectedValue(new Error('disk full'));
		// the button does `const id = await build.save()` — a rejection here is an unhandled rejection
		// in an onclick, which is the one failure shape the user cannot see
		await expect(build.save()).resolves.toBeNull();
		expect(build.saving).toBe(false);
		write.mockRestore();
	});

	it('a class picker left open on a removed row cannot empty the shared pools (B4)', () => {
		build.classRows.setClass(0, `class:${S}:wizard`);
		build.draft.skills = ['arcana'];
		build.draft.selectedSpells = [`spell:${S}:fireball`];
		build.classRows.addClass();
		build.classRows.setClass(1, `class:${S}:fighter`);

		build.inspector.open({ id: 'class', index: 1 });
		build.classRows.removeClass(1);
		expect(build.inspector.target).toBeNull(); // the pane went with the row

		// and the pick that pane would have applied lands on nothing, instead of clearing the draft
		build.classRows.setClass(1, `class:${S}:fighter`);
		expect(build.draft.classes).toHaveLength(1);
		expect(build.draft.skills).toEqual(['arcana']);
		expect(build.draft.selectedSpells).toEqual([`spell:${S}:fireball`]);
	});

	it('filling a row that was already there cannot push the character past the cap (B7)', () => {
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:wizard`, subclassId: null, level: 20 },
			{ ...newClassRow(), classId: null, subclassId: null, level: 1 }, // added while the level was still low
		];
		build.classRows.setClass(1, `class:${S}:fighter`);
		expect(build.draft.classes[1]?.classId).toBeNull();
		expect(build.classRows.totalLevel).toBe(20);
	});

	it('a picked portrait does not survive into the next build', () => {
		// the VM is a singleton and `portraitSource` prefers a pick over the stored file, so bytes left
		// behind by an abandoned build showed on the next character AND overwrote their own portrait
		build.pickedPhoto = { bytes: new Uint8Array([1, 2, 3]), ext: 'webp', mime: 'image/webp' };
		build.reset();
		expect(build.pickedPhoto).toBeNull();

		build.pickedPhoto = { bytes: new Uint8Array([1, 2, 3]), ext: 'webp', mime: 'image/webp' };
		build.hydrate(savedCharacter());
		expect(build.pickedPhoto).toBeNull();
		expect(build.portraitSource?.kind).not.toBe('picked');
	});

	it('a level set before the class does NOT lock that class out at 20', () => {
		// `totalLevel`'s `|| 1` is a display floor; when it entered the arithmetic, taking the first
		// class was computed as level + 1 — so a blank row walked to 20 could never be filled
		build.draft.classes = [
			{ ...newClassRow(), classId: null, subclassId: null, level: 20 },
		];
		build.classRows.setClass(0, `class:${S}:fighter`);
		expect(build.draft.classes[0]?.classId).toBe(`class:${S}:fighter`);
		expect(build.classRows.totalLevel).toBe(20);
	});

	it('undo takes the class stash back with the draft (B18)', () => {
		build.classRows.setClass(0, `class:${S}:wizard`);
		build.draft.selectedSpells = [`spell:${S}:fireball`];
		build.history.record();

		build.classRows.setClass(0, `class:${S}:fighter`); // stashes the Wizard's spell list
		build.history.record();
		expect(build.classPicks.size).toBe(1);

		build.history.undo();
		expect(build.draft.classes[0]?.classId).toBe(`class:${S}:wizard`);
		expect(build.draft.selectedSpells).toEqual([`spell:${S}:fireball`]);
		// the stash the switch created is undone too — left behind, taking the Wizard again would
		// hand back picks that were just taken back
		expect(build.classPicks.size).toBe(0);
	});

	it('expertise stays reachable when the class grants none, and never dead-ends at the cap (B15, B16)', () => {
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 3 }];
		build.draft.skills = ['athletics', 'perception', 'survival'];
		expect(build.skillPicks.expertiseCap).toBe(0); // this Fighter grants no expertise slots

		// Strict says no, and says it out loud rather than rendering a control that does nothing
		build.skillPicks.toggleExpertise('athletics');
		expect(build.draft.expertise).toEqual([]);
		expect(build.skillPicks.expertiseOffered('athletics')).toBe(false);

		// Free is the mode that lifts it — and having taken one, the way back out must exist
		build.draft.strict = false;
		build.skillPicks.toggleExpertise('athletics');
		expect(build.draft.expertise).toEqual(['athletics']);
		build.draft.strict = true;
		expect(build.skillPicks.expertiseOffered('athletics')).toBe(true); // cap 0, but it is already doubled
		build.skillPicks.toggleExpertise('athletics');
		expect(build.draft.expertise).toEqual([]);

		// at a real cap the click replaces the oldest pick instead of being ignored (ui.md §10)
		build.draft.classes = [{ ...newClassRow(), classId: `class:${S}:rogue`, subclassId: null, level: 1 }];
		expect(build.skillPicks.expertiseCap).toBe(2);
		build.skillPicks.toggleExpertise('athletics');
		build.skillPicks.toggleExpertise('perception');
		build.skillPicks.toggleExpertise('survival');
		expect(build.draft.expertise).toEqual(['perception', 'survival']);
	});

	it('a draft written by an older Charnik opens instead of taking the page down (B6)', () => {
		build.hydrateDraft({
			guid: 'older-draft',
			savedAt: new Date().toISOString(),
			summary: { name: 'Old', classes: '', level: 1, system: '5.5e' },
			// no slotFeatSkills and no inventory (fields that did not exist yet), a level nothing can
			// hold, and a generation method that was never one
			draft: {
				name: 'Old',
				classes: [{ ...newClassRow(), classId: `class:${S}:wizard`, subclassId: null, level: 99 }],
				method: 'astrology',
				skills: ['arcana'],
			},
			classPicks: [
				['class:x:y', { level: 3 }],
				['class:junk:junk', 'not a set of picks at all'],
			],
		});

		expect(build.draft.name).toBe('Old'); // what WAS readable is kept
		expect(build.draft.skills).toEqual(['arcana']);
		expect(build.draft.slotFeatSkills).toEqual({}); // the missing field is blank, not undefined
		expect(build.draft.inventory).toEqual([]);
		expect(build.draft.classes[0]?.level).toBe(1);
		expect(build.draft.method).toBe('point_buy');
		expect(build.classPicks.size).toBe(1); // the readable stash entry survives, the junk one does not
		expect(build.assembled.build.name).toBe('Old'); // and the sheet derives at all, which is the point
	});

	it('a character saved when slot keys named a row index still restores its slots (S4)', () => {
		const saved = savedCharacter();
		saved.build.classes = [{ class: `class:${S}:wizard`, level: 4 }]; // no rowId: an older save
		saved.build.slotPicks = {
			feats: { '0:4': ASI },
			asi: { '0:4': { shape: '2', picks: ['con'] } },
			featAbility: {},
			featSkills: {},
		};
		build.reset();
		build.graph = graph;
		build.hydrate(characterSchema.parse(saved));

		const key = build.feats.featSlots.find((s) => s.level === 4)?.key ?? '';
		expect(key).not.toBe('0:4'); // the row has an id now
		expect(build.draft.slotFeats[key]).toBe(ASI); // …and its picks came with it
		expect(build.assembled.build.abilityBoosts.con).toBe(2);
	});

	it('a feat left in a slot the level no longer grants stops blocking the others (B8)', () => {
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 8 },
		];
		const at = (level: number) => build.feats.featSlots.find((s) => s.level === level)?.key ?? '';
		const alert = `feat:${S}:alert`;
		const slot8 = at(8);
		build.feats.setSlotFeat(slot8, alert);
		// spent by a slot the character HAS: offering it again in another slot would grant it twice
		expect(build.feats.featOptionBlocked(alert, at(4))).toBe(true);

		// step the class back to 4 — the level-8 slot leaves the sheet, its pick stays in the draft so
		// raising the level again brings the feat back
		build.draft.classes = build.draft.classes.map((c) => ({ ...c, level: 4 }));
		expect(build.feats.featSlots.map((s) => s.level)).toEqual([4]);
		expect(build.draft.slotFeats[slot8]).toBe(alert);
		expect(build.feats.featOptionBlocked(alert, at(4))).toBe(false);
	});

	it('switching edition clears the picks the new one has no row for (B12)', () => {
		build.draft.speciesId = `species:${S}:hardy`; // 5.5e only, like everything in this fixture
		build.classRows.setClass(0, `class:${S}:wizard`);
		build.draft.selectedSpells = [`spell:${S}:fireball`];

		const losing = build.picksLostBySwitching('5e');
		expect(losing.map((p) => p.type).sort()).toEqual(['class', 'species', 'spell']);

		build.switchSystem('5e');
		expect(build.draft.system).toBe('5e');
		expect(build.draft.speciesId).toBeNull();
		expect(build.draft.classes[0]?.classId).toBeNull();
		expect(build.draft.selectedSpells).toEqual([]);
		// and nothing is left applying itself from behind a picker that can no longer show it
		expect(build.assembled.build.abilityBoosts).toEqual({});
	});

	it('every todo points at the control that fixes it (N15)', () => {
		// the review bar is only useful if its lines are links, and a todo whose target is wrong opens
		// a pane about something else entirely
		expect(targetForTodo({ key: 'name', kind: 'name', required: true })).toBeNull();
		expect(targetForTodo({ key: 'class', kind: 'class', required: true, index: 1 })).toEqual({
			id: 'class',
			index: 1,
		});
		expect(
			targetForTodo({ key: 'feat', kind: 'feat', required: false, slotKey: 'r0:4', level: 4 }),
		).toEqual({ id: 'feat', slotKey: 'r0:4', level: 4 });
		expect(targetForTodo({ key: 'skills', kind: 'skills', required: true })).toEqual({
			id: 'skills',
		});
	});

	it('two targets are the same one by what they identify, not by how they were spelled', () => {
		// the sheet cards' `active` state and the pane's remount both hang off this; comparing the
		// objects as JSON made it depend on key order in unrelated components
		expect(sameTarget({ id: 'class', index: 1 }, { id: 'class', index: 1 })).toBe(true);
		expect(sameTarget({ id: 'class', index: 1 }, { id: 'class', index: 2 })).toBe(false);
		expect(sameTarget({ id: 'class', index: 1 }, { id: 'subclass', index: 1 })).toBe(false);
		expect(
			sameTarget(
				{ id: 'feat', level: 4, slotKey: 'r0:4' },
				{ id: 'feat', slotKey: 'r0:4', level: 4 },
			),
		).toBe(true);
		expect(sameTarget({ id: 'species' }, { id: 'species' })).toBe(true);
		expect(sameTarget(null, { id: 'species' })).toBe(false);
	});

	it('a feat spent in another slot is offered with a reason, not withheld (N15)', () => {
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 8 },
		];
		const at = (level: number) => build.feats.featSlots.find((s) => s.level === level)?.key ?? '';
		build.feats.setSlotFeat(at(8), `feat:${S}:alert`);

		build.inspector.open({ id: 'feat', slotKey: at(4), level: 4 });
		const spec = build.inspector.pick;
		expect(spec?.options.map((r) => r.effectiveId)).toContain(`feat:${S}:alert`);
		expect(spec?.blockedKey?.(`feat:${S}:alert`)).toBe('build.feats.takenElsewhere');
		expect(spec?.blockedKey?.(`feat:${S}:tough`)).toBeNull();
	});

	it('a granted origin feat asks its own choices, and they land on the character (B13)', () => {
		build.draft.backgroundId = `background:${S}:scholar`;
		expect(build.feats.originFeatRef).toBe(`feat:${S}:skilled`);
		// Skilled grants three skills of the player's choice — unpicked, they are three choices owed,
		// and the review bar says so instead of the grant quietly evaporating
		expect(build.feats.originChoicesOwed).toBe(3);
		expect(build.todos.map((t) => t.kind)).toContain('originFeat');

		for (const skill of ['stealth', 'athletics', 'survival'])
			build.feats.toggleSlotFeatSkill(ORIGIN_SLOT_KEY, skill, 3);
		expect(build.feats.originChoicesOwed).toBe(0);
		expect(build.assembled.build.featSkills).toEqual(
			expect.arrayContaining(['stealth', 'athletics', 'survival'])
		);
		expect(build.todos.map((t) => t.kind)).not.toContain('originFeat');
	});

	it('a feat-granted skill counts as proficient, so expertise on it is offered and survives assemble', () => {
		build.draft.backgroundId = `background:${S}:scholar`; // grants Skilled
		build.feats.toggleSlotFeatSkill(ORIGIN_SLOT_KEY, 'stealth', 3);
		// the derive reads `build.skills` + `build.featSkills` as one set; the picker must agree
		expect(build.skillPicks.isProficient('stealth')).toBe(true);
		// …and the feat's OWN picker must not read its grant back as taken elsewhere
		expect(build.feats.featSkillTakenElsewhere(ORIGIN_SLOT_KEY, 'stealth')).toBe(false);
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:rogue`, subclassId: null, level: 1 },
		];
		expect(build.skillPicks.expertiseOffered('stealth')).toBe(true);
		build.skillPicks.toggleExpertise('stealth');
		expect(build.assembled.build.expertise).toContain('stealth');
	});

	it("a granted half-feat's +1 is asked for, and reaches the ability score (B13)", () => {
		build.draft.abilities = { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 12 };
		build.draft.backgroundId = `background:${S}:prodigy`;
		expect(build.feats.halfFeatOptionsFor(ORIGIN_SLOT_KEY)).toEqual(['str', 'dex']);
		expect(build.feats.originChoicesOwed).toBe(1);

		build.feats.setSlotFeatAbility(ORIGIN_SLOT_KEY, 'dex');
		expect(build.feats.originChoicesOwed).toBe(0);
		expect(build.assembled.build.abilityBoosts.dex).toBe(1);

		// and a level-up of that character applies it once, not twice — the same reconciliation the
		// slots get, because the origin feat re-derives its own boost too
		const saved = characterSchema.parse(build.assembled);
		build.reset();
		build.graph = graph;
		build.hydrate(saved);
		expect(build.assembled.build.abilityBoosts.dex).toBe(1);
	});

	it('Strict settles what a level-up loaded: no level down, no re-picking, no dropping a class', () => {
		const saved = savedCharacter(); // Valen, Wizard 3, Strict
		build.reset();
		build.graph = graph;
		build.hydrate(saved);

		// the level it has already played is the floor; the way UP is what a level-up is for
		expect(build.classRows.canLowerLevel(0)).toBe(false);
		build.classRows.bumpClassLevel(0, -1);
		expect(build.draft.classes[0]?.level).toBe(3);
		build.classRows.bumpClassLevel(0, 1);
		expect(build.draft.classes[0]?.level).toBe(4);
		expect(build.classRows.canLowerLevel(0)).toBe(true); // the level just added is not settled
		build.classRows.bumpClassLevel(0, -1);
		expect(build.draft.classes[0]?.level).toBe(3);

		// the decisions it arrived with are shown and explained, never silently missing, and Clear
		// stops offering to unmake one
		build.inspector.open({ id: 'species' });
		expect(build.inspector.pick?.blockedKey?.(`species:${S}:hardy`)).toBeNull(); // its own, taken
		expect(build.inspector.pick?.blockedKey?.('species:x:elf')).toBe('build.strictSettled');
		expect(build.inspector.pick?.clearable).toBe(false);
		build.inspector.take(`class:${S}:fighter`); // a blocked take is refused, like any other
		expect(build.draft.speciesId).toBe(`species:${S}:hardy`);

		// a class the character has is not un-taken; one added at this level-up still is
		expect(build.classRows.canRemoveClass(0)).toBe(false);
		build.classRows.addClass();
		build.classRows.setClass(1, `class:${S}:fighter`);
		expect(build.classRows.canRemoveClass(1)).toBe(true);
		build.classRows.removeClass(1);
		expect(build.draft.classes).toHaveLength(1);
	});

	it('Free lifts every level-up lock — that is what the toggle is for', () => {
		const saved = savedCharacter();
		saved.ui.strict = false;
		build.hydrate(characterSchema.parse(saved));

		expect(build.settledDraft).toBeNull();
		expect(build.classRows.canLowerLevel(0)).toBe(true);
		build.classRows.bumpClassLevel(0, -1);
		expect(build.draft.classes[0]?.level).toBe(2);
		build.inspector.open({ id: 'species' });
		expect(build.inspector.pick?.blockedKey?.('species:x:elf')).toBeNull();
		expect(build.inspector.pick?.clearable).toBe(true);
	});

	it('a new character settles nothing at all', () => {
		expect(build.settledDraft).toBeNull();
		build.classRows.setClass(0, `class:${S}:wizard`);
		build.classRows.bumpClassLevel(0, 1);
		expect(build.classRows.canLowerLevel(0)).toBe(true);
		build.classRows.bumpClassLevel(0, -1);
		expect(build.draft.classes[0]?.level).toBe(1);
		expect(build.classRows.canLowerLevel(0)).toBe(false); // level 1 is the floor for everyone
	});

	it('moving a saved ASI to another ability grants the new one ONLY, however often it moves', () => {
		build.draft.name = 'Mover';
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 8 },
		];
		build.draft.abilities = { str: 15, dex: 14, con: 14, int: 10, wis: 10, cha: 8 };
		const key = build.feats.featSlots[0]?.key ?? '';
		build.feats.setSlotFeat(key, ASI);
		build.feats.toggleAsiPick(key, 'str'); // shape '2' → +2 STR
		let saved = characterSchema.parse(build.assembled);
		expect(saved.build.abilityBoosts).toEqual({ str: 2 });

		// re-open (the level-up path) and move the pick: the ability it LEFT keeps nothing. The residue
		// is measured against the picks the SAVE held, so there is nothing for the old one to survive on.
		for (const [from, to] of [['str', 'dex'], ['dex', 'con'], ['con', 'int']] as const) {
			build.reset();
			build.graph = graph;
			build.hydrate(saved);
			build.feats.toggleAsiPick(key, from); // un-pick, then take the other — what the picker does
			build.feats.toggleAsiPick(key, to);
			expect(build.assembled.build.abilityBoosts).toEqual({ [to]: 2 });
			saved = characterSchema.parse(build.assembled);
		}

		// the same arithmetic one door over: swapping the ASI for a feat takes its +2 with it
		build.reset();
		build.graph = graph;
		build.hydrate(saved);
		build.feats.setSlotFeat(key, `feat:${S}:alert`);
		expect(build.assembled.build.abilityBoosts).toEqual({});
		expect(build.assembled.build.feats).toContain(`feat:${S}:alert`);
	});

	it("a half-feat swap keeps a +1 the new feat still offers and re-points one it does not", () => {
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:fighter`, subclassId: null, level: 4 },
		];
		build.draft.abilities = { str: 15, dex: 14, con: 14, int: 10, wis: 10, cha: 8 };
		const key = build.feats.featSlots[0]?.key ?? '';

		build.feats.setSlotFeat(key, `feat:${S}:wide`); // int / cha → defaults to int
		expect(build.draft.slotFeatAbility[key]).toBe('int');
		build.feats.setSlotFeatAbility(key, 'cha');
		expect(build.assembled.build.abilityBoosts).toEqual({ cha: 1 });

		build.feats.setSlotFeat(key, `feat:${S}:lore`); // cha / wis → CHA is still on offer, so it stays
		expect(build.draft.slotFeatAbility[key]).toBe('cha');
		expect(build.assembled.build.abilityBoosts).toEqual({ cha: 1 });

		build.feats.setSlotFeat(key, `feat:${S}:grappler`); // str / dex → CHA is not, so the +1 re-points
		expect(build.draft.slotFeatAbility[key]).toBe('str');
		expect(build.assembled.build.abilityBoosts).toEqual({ str: 1 });

		// and a moved half-feat +1 does not leave residue behind on a level-up either
		const saved = characterSchema.parse(build.assembled);
		build.reset();
		build.graph = graph;
		build.hydrate(saved);
		build.feats.setSlotFeatAbility(key, 'dex');
		expect(build.assembled.build.abilityBoosts).toEqual({ dex: 1 });
	});

	it('un-picking a skill takes its expertise with it, so the cap stops evicting a live pick', () => {
		build.draft.classes = [
			{ ...newClassRow(), classId: `class:${S}:rogue`, subclassId: null, level: 1 },
		];
		expect(build.skillPicks.expertiseCap).toBe(2);
		for (const skill of ['acrobatics', 'stealth']) build.skillPicks.toggleSkill(skill);
		for (const skill of ['acrobatics', 'stealth']) build.skillPicks.toggleExpertise(skill);
		expect(build.skillPicks.expertiseUsed).toBe(2);

		build.skillPicks.toggleSkill('stealth'); // no longer proficient → no longer expert
		expect(build.draft.expertise).toEqual(['acrobatics']);
		expect(build.skillPicks.expertiseUsed).toBe(1);

		// the freed slot really is free: the new pick lands beside the live one instead of evicting it
		build.skillPicks.toggleSkill('perception');
		build.skillPicks.toggleExpertise('perception');
		expect(build.draft.expertise).toEqual(['acrobatics', 'perception']);
		expect(build.assembled.build.expertise).toEqual(['acrobatics', 'perception']);
	});

	it('RV3: a picked ref survives its source being disabled; an unpicked one is filtered out', () => {
		build.hydrate(savedCharacter()); // picks class = wizard (source S); fighter stays unpicked
		const wizard = `class:${S}:wizard`;
		const fighter = `class:${S}:fighter`;
		expect(build.classList.map((r) => r.effectiveId)).toEqual(
			expect.arrayContaining([wizard, fighter])
		);
		try {
			toggleSource(S); // user disables the whole SRD source AFTER building
			const ids = build.classList.map((r) => r.effectiveId);
			expect(ids).toContain(wizard); // picked → kept, still visible + re-pickable
			expect(ids).not.toContain(fighter); // unpicked → filtered as normal
		} finally {
			toggleSource(S); // restore the shared reactive source config for the other tests
		}
	});
});
