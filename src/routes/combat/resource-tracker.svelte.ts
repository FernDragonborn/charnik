/*
 * The resource/rest subsystem of the Combat view-model: spell-slot pips, named resource pips (rage,
 * ki, item N/day…), a day's boundaries and the rests. What each press DOES is a pure action in
 * `$lib/play/resources` and `$lib/play/rests`; this is the names the panels and the action executor
 * call, and the one thing only a screen has — noticing that an ability's window has opened.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { saveCharacterGuarded } from '$lib/character/store.svelte';
import type { Character } from '$lib/character/schema';
import type { CharacterSheet, ResourceOption } from '$lib/character/derive';
import type { PlayContext, PlayOutcome } from '$lib/play/outcome';
import {
	canAfford,
	gainSlot,
	hitDiceSpent,
	passBoundary,
	resourceLeft,
	resourceName,
	resourceSpent,
	restoreResource,
	restoreResourceUpTo,
	setResourcePip,
	setSlotPip,
	spendOnOption,
	spendResource,
	useResource,
	type DayBoundary,
	type OptionSpend,
} from '$lib/play/resources';
import { longRestHitDiceBudget, rest, type RestChoice, type RestKind } from '$lib/play/rests';
import { titleCase } from '$lib/combat/helpers';

export type { RestChoice };

const NOTE_ACTION = 'note:';

/** What an option takes from its pool this time (`x` priced at the amount the player picked), and
 *  what it says it does — a `note:` action IS that, in the row's own words. */
const spendOf = (opt: ResourceOption, amount: number): OptionSpend => ({
	resource: opt.resourceId,
	cost: opt.cost === 'x' ? amount : opt.cost,
	name: opt.name,
	says: opt.action.startsWith(NOTE_ACTION) ? opt.action.slice(NOTE_ACTION.length) : opt.description,
});

/** What this subsystem needs from the sheet around it. */
export interface ResourceTrackerHost {
	character: Character | null;
	sheet: CharacterSheet | null;
	/** Carry out a play-state action on the open character; false when it was refused. */
	act(action: (character: Character, ctx: PlayContext) => PlayOutcome): boolean;
}

export class ResourceTracker {
	constructor(private host: () => ResourceTrackerHost) {}
	private getCharacter = () => this.host().character;
	private getSheet = () => this.host().sheet;
	private act: ResourceTrackerHost['act'] = (action) => this.host().act(action);

	/** The open character and its sheet together, or null while either is missing. */
	private get open(): { c: Character; sheet: CharacterSheet } | null {
		const c = this.getCharacter();
		const sheet = this.getSheet();
		return c && sheet ? { c, sheet } : null;
	}

	// tap a spell-slot pip: click a filled pip to spend down to it, a spent pip to restore up to it
	slotClick = (key: string, full: number, spent: number, index: number) =>
		this.act((c, ctx) => setSlotPip(c, { key, full, spent, index }, ctx));

	/** What a pool is CALLED — never its id (UX-1). Public because the action executor blocks a spend
	 *  with the same sentence. */
	resourceName = (id: string): string => {
		const sheet = this.getSheet();
		return sheet ? resourceName(sheet, id) : titleCase(id);
	};

	/** Spent count for a resource, clamped to what the current sheet actually grants. */
	resourceSpent = (id: string): number => {
		const open = this.open;
		return open ? resourceSpent(open.c, open.sheet, id) : 0;
	};
	/** Use ONE unit of a resource, or block with a notice when it is exhausted. Returns whether it
	 *  went through, because a cast paying from a pool has to know BEFORE it touches the action
	 *  economy. */
	useResource = (id: string, max: number): boolean =>
		this.act((c, ctx) => useResource(c, { id, max }, ctx));
	resourceClick = (id: string, max: number, index: number) =>
		this.act((c, ctx) => setResourcePip(c, { id, max, index }, ctx));

	/** Spent count for a hit-die pool, clamped to the live max. */
	hitDiceSpent = (die: string): number => {
		const open = this.open;
		return open ? hitDiceSpent(open.c, open.sheet, die) : 0;
	};

	/** Units left in a pool (max − spent). Public because a chip showing what a pool has left is the
	 *  same question a spend-option's afford-check asks. */
	remainingFor = (resourceId: string): number => {
		const open = this.open;
		return open ? resourceLeft(open.c, open.sheet, resourceId) : 0;
	};
	/** Piece 3: can this option be paid for right now? (`x` = a player-picked `amount`, ≥1.) */
	canAffordOption = (opt: ResourceOption, amount = 1): boolean => {
		const open = this.open;
		return !!open && canAfford(open.c, open.sheet, spendOf(opt, amount));
	};
	/** Piece 3: spend on an option — afford-check, deduct the cost, say what it does. Returns whether
	 *  it went through. */
	spendOption = (opt: ResourceOption, amount = 1): boolean =>
		this.act((c, ctx) => spendOnOption(c, spendOf(opt, amount), ctx));

	/** Spend `count` uses of a pool as PART of an action that already said what it is — the
	 *  `spend_resource:<id>[:<n>]` verb. */
	spendFrom = (id: string, count: number) =>
		this.act((c, ctx) => spendResource(c, { id, count }, ctx));

	/** Give the character one more spell slot of `level` — the `gain_slot:<level>` verb. */
	gainSlot = (level: number) => this.act((c, ctx) => gainSlot(c, { level }, ctx));

	/** Regain ALL expended uses of a pool — the `restore_resource:<id>` action verb. */
	restoreAll = (id: string) => this.act((c, ctx) => restoreResource(c, { id }, ctx));

	/** Regain expended uses until at least `upTo` are AVAILABLE. Returns the resulting available
	 *  count (for the caller's notice), 0 when the pool is unknown. */
	restoreUpTo = (id: string, upTo: number): number => {
		if (!this.getSheet()?.resources.some((r) => r.id === id)) return 0;
		this.act((c, ctx) => restoreResourceUpTo(c, { id, upTo }, ctx));
		return this.remainingFor(id);
	};

	/** What each spend-option's `available` guard said last time we looked. Plain, not `$state`: it is
	 *  read and written by the same call, and a reactive field there is a loop. */
	private windowWas = new Map<string, boolean>();
	/**
	 * Say so when a conditional ability's window OPENS — Persistent Rage at combat start, Uncanny
	 * Metabolism on the first initiative. The panel greys a closed one, which is the "never hidden"
	 * half; nothing announced the moment it stopped being closed, which is the half a player needs to
	 * notice it at all (`docs/internals/characters.md` ▸ a tracker surfaces, it never decides).
	 *
	 * It notices, and stops there: no spend, no pre-selection. The first pass only records — otherwise
	 * opening the sheet would announce every ability the character has.
	 */
	noticeOpenedWindows = () => {
		const seeded = this.windowWas.size > 0;
		for (const o of this.getSheet()?.resourceOptions ?? []) {
			const was = this.windowWas.get(o.id);
			this.windowWas.set(o.id, o.available);
			if (seeded && was === false && o.available)
				toast(t('combat.notice.windowOpen', { name: o.name }));
		}
	};

	/** Written at once rather than by the debounced autosave: a rest or a new day is the kind of
	 *  moment a player closes the app right after. */
	saveNow = () => {
		const c = this.getCharacter();
		if (c) void saveCharacterGuarded(c);
	};

	/** A boundary that is not a rest: dawn, or dusk. A CONTROL the player presses, never a clock the
	 *  app runs. */
	passBoundary = (trigger: DayBoundary) => {
		if (this.act((c, ctx) => passBoundary(c, { trigger }, ctx))) this.saveNow();
	};

	/** Does this character have anything that comes back at that boundary? The control for it is shown
	 *  only then — a button that can never do anything is a worse answer than no button. */
	hasBoundaryPool = (trigger: DayBoundary): boolean =>
		(this.getSheet()?.resources ?? []).some((r) => r.recharge.trigger === trigger);

	/** How many spent Hit Dice a long rest may return to this character, whichever sizes they are. */
	get longRestHitDiceBudget(): number {
		const open = this.open;
		return open ? longRestHitDiceBudget(open.c, open.sheet) : 0;
	}

	/** Take a rest (`$lib/play/rests`). */
	rest = (kind: RestKind, choice: RestChoice = {}) => {
		if (this.act((c, ctx) => rest(c, { kind, choice }, ctx))) this.saveNow();
	};
}
