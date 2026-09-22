/*
 * A description in the player's OWN WORDS — a cache over the content, never an edit of it.
 *
 * The CSV is untouched: an override is looked up by `type:source:id` at every place prose is read,
 * and removing it brings the shipped text straight back. That is what separates this from the
 * homebrew editor beside it, which forks the row itself.
 *
 * TWO SCOPES, because two characters may read the same item differently:
 *   - `character` (the default) lives in the open character's `ui.textOverrides`, so a character
 *     still travels with everything it needs;
 *   - `install` lives in `overrides.json` in the data dir, and applies wherever no character is open
 *     (the compendium) and to every character that has not written their own.
 * Promoting moves a row between the two; nothing is ever in both.
 *
 * Keyed by locale as well, exactly like the content's own `text_<code>` columns: prose written in
 * Ukrainian is not shown to a reader who switched to English, because it is not a translation of it.
 */
import type { Storage } from '$lib/storage/types';
import { getUserStorage } from '$lib/storage/provider';
import { logger } from '$lib/diag/logger';
import type { LoadedRow } from './loader';
import { localizedProse, plainProse, stripProse } from './prose';

/** Which store a row's own words live in. */
export const OVERRIDE_SCOPE = { character: 'character', install: 'install' } as const;
export type OverrideScope = (typeof OVERRIDE_SCOPE)[keyof typeof OVERRIDE_SCOPE];

/** `type:source:id` → locale → the prose written for it. */
export type OverrideMap = Record<string, Record<string, string>>;

const OVERRIDES_FILE = 'overrides.json';

/** The on-disk shape — tagged, so a stray JSON in the data dir is not mistaken for this one. */
interface OverridesFile {
	format: 'charnik-overrides';
	version: 1;
	entries: OverrideMap;
}

/** Read an untrusted parsed JSON into a map, dropping everything that is not prose under a key. A
 *  hand-edited file is input like any other: what survives is what has the right shape. */
export function overridesFromJson(raw: unknown): OverrideMap {
	const out: OverrideMap = {};
	if (!raw || typeof raw !== 'object') return out;
	const file = raw as Partial<OverridesFile>;
	const entries = file.format === 'charnik-overrides' ? file.entries : undefined;
	if (!entries || typeof entries !== 'object') return out;
	for (const [id, byLocale] of Object.entries(entries)) {
		if (!byLocale || typeof byLocale !== 'object') continue;
		const kept: Record<string, string> = {};
		for (const [locale, text] of Object.entries(byLocale))
			if (typeof text === 'string' && text.trim()) kept[locale] = text;
		if (Object.keys(kept).length) out[id] = kept;
	}
	return out;
}

export const serializeOverrides = (entries: OverrideMap): string =>
	JSON.stringify(
		{ format: 'charnik-overrides', version: 1, entries } satisfies OverridesFile,
		null,
		2,
	);

/** Set (or, with empty text, clear) one row's prose in a map, without mutating the original. */
export function withOverride(
	map: OverrideMap,
	id: string,
	locale: string,
	text: string,
): OverrideMap {
	const forRow: Record<string, string> = { ...map[id] };
	if (text.trim()) forRow[locale] = text;
	else delete forRow[locale];
	const next: OverrideMap = { ...map };
	if (Object.keys(forRow).length) next[id] = forRow;
	else delete next[id];
	return next;
}

/** What the open character contributes, and how to write it back. Bound by whoever owns the
 *  character (the combat and spellbook pages); absent everywhere else, which is what makes the
 *  compendium write to the install scope instead. */
interface CharacterBinding {
	entries: OverrideMap;
	write(entries: OverrideMap): void;
}

class Overrides {
	/** Rotated on every change, so a derived index (the search projection) can depend on it. A GUID
	 *  and not a counter, for the reason the character store spells out: `n++` READS the state it
	 *  then writes, and inside an effect that is a dependency on itself — which is an update loop,
	 *  not a bug in the caller. */
	guid = $state(crypto.randomUUID());
	private install = $state<OverrideMap>({});
	private character = $state<CharacterBinding | null>(null);

	/** The open character's own words, or null when none is open — which is also the read the UI uses
	 *  to decide whether "just this character" is an offer it can make. */
	get hasCharacter(): boolean {
		return this.character !== null;
	}

	/** Track the open character: its map is read live and written back through `write`. Pass null on
	 *  teardown, or the next page keeps writing into a character it is not showing. */
	bindCharacter(binding: CharacterBinding | null): void {
		this.character = binding;
		this.guid = crypto.randomUUID();
	}

	/** The words to show for a row in this locale, or undefined when the shipped text stands. */
	textFor(effectiveId: string, locale: string): string | undefined {
		return this.character?.entries[effectiveId]?.[locale] ?? this.install[effectiveId]?.[locale];
	}

	/** Which store the shown words came from — what the scope toggle reads, and what tells the UI
	 *  whether there is anything to restore. */
	scopeOf(effectiveId: string, locale: string): OverrideScope | null {
		if (this.character?.entries[effectiveId]?.[locale] != null) return OVERRIDE_SCOPE.character;
		if (this.install[effectiveId]?.[locale] != null) return OVERRIDE_SCOPE.install;
		return null;
	}

	/**
	 * Write one row's prose into `scope`, clearing it from the other — a row is never in both, so
	 * promoting is the same call as writing and there is no state where the two disagree.
	 *
	 * Empty text is the RESTORE: it removes the row and the shipped words come back.
	 */
	write(effectiveId: string, locale: string, text: string, scope: OverrideScope): void {
		const toCharacter = scope === OVERRIDE_SCOPE.character && this.character;
		if (toCharacter) {
			this.character?.write(withOverride(this.character.entries, effectiveId, locale, text));
			this.install = withOverride(this.install, effectiveId, locale, '');
		} else {
			this.install = withOverride(this.install, effectiveId, locale, text);
			if (this.character)
				this.character.write(withOverride(this.character.entries, effectiveId, locale, ''));
		}
		this.guid = crypto.randomUUID();
		this.persist();
	}

	/** Drop a row's own words from BOTH scopes — the way back to the shipped text. */
	restore(effectiveId: string, locale: string): void {
		this.install = withOverride(this.install, effectiveId, locale, '');
		if (this.character)
			this.character.write(withOverride(this.character.entries, effectiveId, locale, ''));
		this.guid = crypto.randomUUID();
		this.persist();
	}

	/** The install scope as it stands, for the writer below and for a test to read. */
	get installEntries(): OverrideMap {
		return this.install;
	}

	async load(storage: Storage): Promise<void> {
		try {
			const raw = await storage.read(OVERRIDES_FILE);
			this.install = raw ? overridesFromJson(JSON.parse(raw)) : {};
		} catch {
			// a missing or unreadable file means "nobody promoted anything yet", which is the common
			// case on a fresh install — the shipped prose is not a thing that can fail to load
			this.install = {};
		}
		this.guid = crypto.randomUUID();
	}

	async save(storage: Storage = getUserStorage()): Promise<void> {
		await storage.write(OVERRIDES_FILE, serializeOverrides(this.install));
	}

	/** Write the install scope out without making every caller wait on a file. A failure here loses a
	 *  promoted rewrite, which the player would find out about only on the next launch — so it is
	 *  reported rather than swallowed. */
	private persist(): void {
		void this.save().catch((err: unknown) => {
			logger.error('overrides: could not write ' + OVERRIDES_FILE, { err: String(err) });
		});
	}
}

export const overrides = new Overrides();

/**
 * Track the character whose own words apply, taking a SNAPSHOT of their map rather than the
 * character's own `$state` proxy — handing one reactive object to another makes the effect that read
 * it write it back, which Svelte stops as an update loop. `write` replaces the property, which
 * re-runs that effect with the new words.
 */
export function bindOpenCharacter(
	character: { ui: { textOverrides: OverrideMap } } | null,
	save: () => void,
): void {
	if (!character) {
		overrides.bindCharacter(null);
		return;
	}
	overrides.bindCharacter({
		entries: $state.snapshot(character.ui.textOverrides),
		write: (entries) => {
			character.ui.textOverrides = entries;
			save();
		},
	});
}

/** A row's prose as the READER should see it: their own words when they wrote some, the shipped
 *  text otherwise. The one accessor every display surface goes through. */
export const describedProse = (row: LoadedRow, locale: string): string =>
	overrides.textFor(row.effectiveId, locale) ?? localizedProse(row, 'text', locale);

/** The same words with their markdown STRIPPED — for the sheets that print prose as running text.
 *  The strip is `plainProse`'s rule either way, so a player's own words read like the shipped ones. */
export const describedPlainProse = (row: LoadedRow, locale: string): string => {
	const own = overrides.textFor(row.effectiveId, locale);
	return own === undefined ? plainProse(row, locale) : stripProse(own);
};
