/*
 * The starting equipment the class and the background hand out, as the builder offers it. What a kit
 * holds is the row's `starting_equipment` column (`content/starting-equipment.ts`); what taking it
 * does to the draft is `starting-kit.ts`. This joins the two to the character being built: which
 * rows exist in its edition, which alternative its proficiencies allow, what is still unanswered.
 *
 * Offered while CREATING only — a character already played has long since spent its kit, and a
 * level-up is not where one is handed out.
 */
import {
	KIT_PART,
	KIT_SOURCE,
	kitItemsById,
	kitOf,
	matchesAny,
	type KitLine,
	type KitSource,
} from '$lib/content/starting-equipment';
import type { LoadedRow, LoadedRowOf } from '$lib/content/loader';
import { localizedName } from '$lib/content/detail';
import { resolveItem, armorCategoryOf } from '$lib/content/resolved-item';
import { parseItemTags, weaponCategoryOf } from '$lib/content/item-tags';
import { isRowActive } from '$lib/content/sources.svelte';
import { weaponProfGrants } from '$lib/combat/attacks';
import { armorProfGrants } from '$lib/character/granted-proficiency';
import { isArmorProficient, isWeaponProficient } from '$lib/rules/proficiency';
import { app } from '$lib/stores/app.svelte';
import { COINS, type Purse } from '$lib/rules/currency';
import type { Translate } from '$lib/i18n';
import {
	answerPick,
	dropKit,
	picksOwed,
	takeAlternative,
	takenCoins,
	type KitScope,
	type TakenKit,
} from './starting-kit';
import type { BuildVM } from './build-view-model.svelte';

export type StartingKitHost = Pick<BuildVM, 'draft' | 'graph' | 'edit' | 'row' | 'backgroundRow' | 'sheet'>;

/** One source's kit as the pane draws it. */
export interface KitView {
	source: KitSource;
	row: LoadedRow;
	lines: KitLine[];
	taken: TakenKit | undefined;
}

/** Why an alternative is refused (Strict) or noted (Free). */
export const KIT_BLOCK = { notProficient: 'notProficient' } as const;
type KitBlock = (typeof KIT_BLOCK)[keyof typeof KIT_BLOCK];

/** Coins as the purse says them, biggest last as the purse lists them: '15 gp', '2 sp · 15 gp'. */
export const purseSaid = (purse: Purse, translate: Translate): string =>
	COINS.filter((coin) => purse[coin.id])
		.map((coin) => `${purse[coin.id]} ${translate(`coinName.${coin.id}`)}`)
		.join(' · ');

export interface ItemChoice {
	ref: string;
	name: string;
}

export class StartingKitPicks {
	constructor(private host: () => StartingKitHost) {}

	private items = $derived.by(() => {
		const { graph, draft } = this.host();
		return graph ? kitItemsById(graph, draft.system, isRowActive) : new Map<string, LoadedRowOf<'item'>>();
	});

	kits = $derived.by<KitView[]>(() => {
		const host = this.host();
		if (host.edit) return [];
		const out: KitView[] = [];
		const sources: [KitSource, LoadedRow | undefined][] = [
			[KIT_SOURCE.class, host.row(host.draft.classes[0]?.classId ?? null)],
			[KIT_SOURCE.background, host.backgroundRow],
		];
		for (const [source, row] of sources) {
			const lines = kitOf(row);
			if (row && lines.length) out.push({ source, row, lines, taken: host.draft.startingKits[source] });
		}
		return out;
	});

	/** Kits offered and not taken — a nudge, never a requirement: many tables buy with gold instead. */
	kitsOwed = $derived(this.kits.filter((kit) => !kit.taken).length);
	picksOwed = $derived(this.kits.reduce((n, kit) => n + picksOwed(kit.taken, kit.lines), 0));
	/** The coins the taken kits hand over, which the purse starts with. */
	coins = $derived.by<Record<string, number>>(() => {
		const out: Record<string, number> = {};
		for (const kit of this.kits)
			for (const [coin, amount] of Object.entries(takenCoins(kit.taken, kit.lines)))
				out[coin] = (out[coin] ?? 0) + amount;
		return out;
	});

	private kitOf = (source: KitSource): KitView | undefined => this.kits.find((k) => k.source === source);

	itemRow = (id: string): LoadedRowOf<'item'> | undefined => this.items.get(id);
	itemName = (id: string): string => {
		const row = this.items.get(id);
		return row ? localizedName(row, app.activeLocale) : id;
	};

	/** Is the character proficient with this item? Only armour and weapons ask; anything unknown is
	 *  answered yes, as everywhere the app meets data it cannot classify. */
	private proficientWith(id: string): boolean {
		const { graph, sheet, draft } = this.host();
		const row = this.items.get(id);
		if (!graph || !sheet || !row) return true;
		const classes = draft.classes.flatMap((c) => (c.classId ? [{ class: c.classId }] : []));
		if (row.data.category === 'weapon')
			return isWeaponProficient(
				weaponProfGrants(classes, sheet.facts, graph),
				weaponCategoryOf(parseItemTags(row.data.tags)),
				row.id,
			);
		return isArmorProficient(
			armorProfGrants(classes, sheet.facts, graph),
			armorCategoryOf(resolveItem(graph, row)),
		);
	}

	blockOf = (kit: KitView, line: number, alternative: number): KitBlock | null => {
		const parts = kit.lines[line]?.alternatives[alternative]?.parts ?? [];
		const unmet = parts.some(
			(part) => part.kind === KIT_PART.item && part.ifProficient && !this.proficientWith(part.id),
		);
		return unmet ? KIT_BLOCK.notProficient : null;
	};

	private scopeOf(kit: KitView): KitScope {
		const strict = this.host().draft.strict;
		return {
			lines: kit.lines,
			refOf: (id) => this.items.get(id)?.effectiveId ?? null,
			allowed: (line, alternative) => !strict || this.blockOf(kit, line, alternative) === null,
		};
	}

	take = (source: KitSource, line: number, alternative: number): void => {
		const kit = this.kitOf(source);
		if (kit) takeAlternative(this.host().draft, { source, scope: this.scopeOf(kit) }, line, alternative);
	};
	putBack = (source: KitSource): void => dropKit(this.host().draft, source);
	answer = (source: KitSource, at: { line: number; part: number; n: number }, ref: string): void => {
		const kit = this.kitOf(source);
		if (kit) answerPick(this.host().draft, { source, scope: this.scopeOf(kit) }, at, ref);
	};

	/** The items an `any.` pick may be answered with, by name. */
	candidates = (tagSets: readonly (readonly string[])[]): ItemChoice[] => {
		const { graph } = this.host();
		if (!graph) return [];
		return [...this.items.values()]
			.filter((row) => matchesAny(graph, row, tagSets))
			.map((row) => ({ ref: row.effectiveId, name: localizedName(row, app.activeLocale) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	};
}
