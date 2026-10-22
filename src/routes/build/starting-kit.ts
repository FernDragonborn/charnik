/*
 * What taking a starting kit does to the draft.
 *
 * A kit is a build choice that lands as ordinary inventory rows, so the player equips, counts and
 * removes them like anything else they carry. What makes it a CHOICE is that every row it put there
 * is remembered by part: taking another alternative on a line swaps that line's rows and no other,
 * answering which martial weapon replaces only that weapon, and putting the kit back takes away
 * exactly what it added. Coins are not rows — they are read off the alternatives taken, and land in
 * the purse when the character is created.
 */
import { inventoryRow } from '$lib/character/schema';
import {
	KIT_PART,
	KIT_SOURCE,
	kitCoins,
	type KitLine,
	type KitSource,
} from '$lib/content/starting-equipment';
import type { DraftState } from './draft';

/** A kit as the player has taken it. */
export interface TakenKit {
	/** The alternative taken on each line the book prints, by index. */
	picks: number[];
	/** The item an `any.` pick was answered with, by `askKey`. Kept when the player switches away,
	 *  so switching back finds the weapon they had chosen. */
	asks: Record<string, string>;
	/** The inventory row each granted thing became, by `grantKey` — what a swap or a put-back
	 *  takes away. */
	granted: Record<string, string>;
}

/** Which kit an operation is on, and the content it is read against. */
export interface KitAt {
	source: KitSource;
	scope: KitScope;
}

/** Everything a kit operation needs from the content: the lines, and an item id as a ref in the
 *  character's edition (null when the edition has no such row — content health says so). */
export interface KitScope {
	lines: readonly KitLine[];
	refOf: (id: string) => string | null;
	/** May this alternative be taken — Strict refuses one whose "(if proficient)" is not met. */
	allowed: (line: number, alternative: number) => boolean;
}

export const askKey = (line: number, alternative: number, part: number, n: number): string =>
	`${line}.${alternative}.${part}.${n}`;
const grantKey = (line: number, part: number, n: number): string => `${line}.${part}.${n}`;
const linePrefix = (line: number): string => `${line}.`;

function withoutRows(draft: DraftState, iids: readonly string[]): void {
	if (!iids.length) return;
	const gone = new Set(iids);
	draft.inventory = draft.inventory.filter((entry) => !gone.has(entry.iid));
}

/** Put one line's taken alternative into the inventory, in place of whatever the line held. */
function grantLine(draft: DraftState, kit: TakenKit, scope: KitScope, line: number): void {
	const held = Object.keys(kit.granted).filter((key) => key.startsWith(linePrefix(line)));
	withoutRows(
		draft,
		held.flatMap((key) => kit.granted[key] ?? []),
	);
	for (const key of held) delete kit.granted[key];
	const alternative = kit.picks[line] ?? 0;
	const added = [];
	for (const [p, part] of (scope.lines[line]?.alternatives[alternative]?.parts ?? []).entries()) {
		if (part.kind === KIT_PART.item) {
			const ref = scope.refOf(part.id);
			if (!ref) continue;
			const entry = inventoryRow({ item: ref, qty: part.count });
			kit.granted[grantKey(line, p, 0)] = entry.iid;
			added.push(entry);
		} else if (part.kind === KIT_PART.any) {
			for (let n = 0; n < part.count; n++) {
				const ref = kit.asks[askKey(line, alternative, p, n)];
				if (!ref) continue;
				const entry = inventoryRow({ item: ref });
				kit.granted[grantKey(line, p, n)] = entry.iid;
				added.push(entry);
			}
		}
	}
	draft.inventory = [...draft.inventory, ...added];
}

/** Take an alternative on a line. The first take hands the whole kit over, every other line on its
 *  first alternative the rules allow — a default the player sees and changes with one press. */
export function takeAlternative(
	draft: DraftState,
	{ source, scope }: KitAt,
	line: number,
	alternative: number,
): void {
	if (!scope.allowed(line, alternative)) return;
	const taken = draft.startingKits[source];
	if (taken) {
		if (taken.picks[line] === alternative) return;
		taken.picks[line] = alternative;
		grantLine(draft, taken, scope, line);
		draft.startingKits = { ...draft.startingKits, [source]: taken };
		return;
	}
	const kit: TakenKit = {
		picks: scope.lines.map((each, l) => {
			if (l === line) return alternative;
			const first = each.alternatives.findIndex((_, a) => scope.allowed(l, a));
			return Math.max(0, first);
		}),
		asks: {},
		granted: {},
	};
	scope.lines.forEach((_, l) => grantLine(draft, kit, scope, l));
	draft.startingKits = { ...draft.startingKits, [source]: kit };
}

/** Answer which item an `any.` pick is — and carry that one. */
export function answerPick(
	draft: DraftState,
	{ source, scope }: KitAt,
	at: { line: number; part: number; n: number },
	ref: string,
): void {
	const kit = draft.startingKits[source];
	if (!kit) return;
	kit.asks[askKey(at.line, kit.picks[at.line] ?? 0, at.part, at.n)] = ref;
	grantLine(draft, kit, scope, at.line);
	draft.startingKits = { ...draft.startingKits, [source]: kit };
}

/** Change the background — the kit the old one handed out goes with it. */
export function setBackground(draft: DraftState, id: string | null): void {
	if (id === draft.backgroundId) return;
	dropKit(draft, KIT_SOURCE.background);
	draft.backgroundId = id;
}

/** Put a kit back: every row it added leaves the inventory, and the source asks again. */
export function dropKit(draft: DraftState, source: KitSource): void {
	const kit = draft.startingKits[source];
	if (!kit) return;
	withoutRows(draft, Object.values(kit.granted));
	const { [source]: _dropped, ...rest } = draft.startingKits;
	draft.startingKits = rest;
}

/** The coins the taken alternatives hand over, by coin id. */
export function takenCoins(kit: TakenKit | undefined, lines: readonly KitLine[]): Record<string, number> {
	const out: Record<string, number> = {};
	if (!kit) return out;
	lines.forEach((line, l) => {
		const alternative = line.alternatives[kit.picks[l] ?? 0];
		if (!alternative) return;
		for (const [coin, amount] of Object.entries(kitCoins(alternative)))
			out[coin] = (out[coin] ?? 0) + amount;
	});
	return out;
}

/** How many `any.` picks of the taken alternatives are still unanswered. */
export function picksOwed(kit: TakenKit | undefined, lines: readonly KitLine[]): number {
	if (!kit) return 0;
	let owed = 0;
	lines.forEach((line, l) => {
		const alternative = kit.picks[l] ?? 0;
		line.alternatives[alternative]?.parts.forEach((part, p) => {
			if (part.kind !== KIT_PART.any) return;
			for (let n = 0; n < part.count; n++) if (!kit.asks[askKey(l, alternative, p, n)]) owed++;
		});
	});
	return owed;
}
