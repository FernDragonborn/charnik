/*
 * Taking a starting kit: a line swaps its own rows and no other, a pick lands as the item answered,
 * and putting the kit back takes exactly what it added.
 */
import { describe, it, expect } from 'vitest';
import { parseStartingKit } from '$lib/content/starting-equipment';
import { inventoryRow } from '$lib/character/schema';
import { blankDraft } from './draft';
import { answerPick, dropKit, picksOwed, takeAlternative, takenCoins, type KitScope } from './starting-kit';

const lines = parseStartingKit(
	'chain_mail | leather_armor + longbow; any.martial + shield | 2*any.martial; 4*handaxe + 10gp | 50gp',
);
const scope = (allowed: KitScope['allowed'] = () => true): KitScope => ({
	lines,
	refOf: (id) => `item:T:${id}`,
	allowed,
});
const carried = (draft: ReturnType<typeof blankDraft>) =>
	draft.inventory.map((e) => (e.qty > 1 ? `${e.item}×${e.qty}` : e.item));

describe('a starting kit in the draft', () => {
	it('the first take hands every line over on its first card, the pressed one on the card pressed', () => {
		const draft = blankDraft();
		takeAlternative(draft, { source: 'class', scope: scope() }, 2, 1);
		expect(carried(draft)).toEqual(['item:T:chain_mail', 'item:T:shield']);
		expect(takenCoins(draft.startingKits.class, lines)).toEqual({ gp: 50 });
		expect(picksOwed(draft.startingKits.class, lines)).toBe(1);
	});

	it('a swap touches its own line, and the player’s own rows stay', () => {
		const draft = blankDraft();
		draft.inventory = [inventoryRow({ item: 'item:T:rope' })];
		takeAlternative(draft, { source: 'class', scope: scope() }, 0, 0);
		const shield = draft.inventory.find((e) => e.item === 'item:T:shield');
		takeAlternative(draft, { source: 'class', scope: scope() }, 0, 1);
		expect(carried(draft)).toEqual([
			'item:T:rope',
			'item:T:shield',
			'item:T:handaxe×4',
			'item:T:leather_armor',
			'item:T:longbow',
		]);
		expect(draft.inventory.find((e) => e.item === 'item:T:shield')?.iid).toBe(shield?.iid);
	});

	it('a pick is carried once answered, and answering again replaces it', () => {
		const draft = blankDraft();
		takeAlternative(draft, { source: 'class', scope: scope() }, 1, 1);
		answerPick(draft, { source: 'class', scope: scope() }, { line: 1, part: 0, n: 1 }, 'item:T:longsword');
		answerPick(draft, { source: 'class', scope: scope() }, { line: 1, part: 0, n: 1 }, 'item:T:flail');
		expect(carried(draft).filter((ref) => ref === 'item:T:flail')).toHaveLength(1);
		expect(carried(draft)).not.toContain('item:T:longsword');
		expect(picksOwed(draft.startingKits.class, lines)).toBe(1);
	});

	it('putting the kit back takes exactly what it added', () => {
		const draft = blankDraft();
		draft.inventory = [inventoryRow({ item: 'item:T:rope' })];
		takeAlternative(draft, { source: 'background', scope: scope() }, 0, 0);
		dropKit(draft, 'background');
		expect(carried(draft)).toEqual(['item:T:rope']);
		expect(draft.startingKits).toEqual({});
	});

	it('a card the rules refuse is not taken, and the default skips it', () => {
		const draft = blankDraft();
		const refuseChainMail = scope((line, alternative) => !(line === 0 && alternative === 0));
		takeAlternative(draft, { source: 'class', scope: refuseChainMail }, 0, 0);
		expect(draft.startingKits.class).toBeUndefined();
		takeAlternative(draft, { source: 'class', scope: refuseChainMail }, 2, 0);
		expect(draft.startingKits.class?.picks).toEqual([1, 0, 0]);
	});
});
