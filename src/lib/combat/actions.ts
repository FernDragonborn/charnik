/*
 * The standard combat actions list (Dash, Hide, Grapple…), system-aware (2014/2024). Pure.
 * Split out of the old combat/helpers.ts junk-drawer.
 */
import { signed } from '$lib/util/format';
import type { System } from '$lib/rules/pipeline';
import type { CharacterSheet, SkillId } from '$lib/character/derive';

/** A standard combat action row (Dash, Hide, Grapple…). `roll` is present for the ones that make a
 *  check; `hint` shows its live modifier. */
export interface StandardAction {
	id: string;
	name: string;
	hint: string;
	desc: string;
	/** Short right-side tag: "action" / "contest" / "→ roll" / "→ Attacks". */
	marker: string;
	roll?: [string, number];
}

/** The standard combat actions (Dash, Hide, Grapple…); roll ones reference live skills. Pure. */
export function standardActions(sheet: CharacterSheet | null, system: System): StandardAction[] {
	const sk = (k: SkillId) => sheet?.skills[k]?.value ?? 0;
	const is2024 = system === '5.5e';
	return [
		{
			id: 'attack',
			name: 'Attack',
			hint: '',
			desc: 'weapon / spell / unarmed',
			marker: '→ Attacks'
		},
		{ id: 'dash', name: 'Dash', hint: '', desc: '+speed this turn', marker: 'action' },
		{
			id: 'disengage',
			name: 'Disengage',
			hint: '',
			desc: 'no opportunity attacks',
			marker: 'action'
		},
		{ id: 'dodge', name: 'Dodge', hint: '', desc: 'attackers have disadv.', marker: 'action' },
		{
			id: 'hide',
			name: 'Hide',
			hint: signed(sk('stealth')),
			desc: 'Stealth',
			marker: '→ roll',
			roll: ['Hide (Stealth)', sk('stealth')]
		},
		{
			id: 'search',
			name: 'Search',
			hint: signed(sk('perception')),
			desc: 'Perception',
			marker: '→ roll',
			roll: ['Search (Perception)', sk('perception')]
		},
		// Study is a 2024 action; 2014 has no separate Study action
		...(is2024
			? [
					{
						id: 'study',
						name: 'Study',
						hint: signed(sk('arcana')),
						desc: 'recall lore',
						marker: '→ roll',
						roll: ['Study (Arcana)', sk('arcana')] as [string, number]
					}
				]
			: []),
		{
			id: 'grapple',
			name: 'Grapple',
			hint: signed(sk('athletics')),
			desc: 'Athletics vs target',
			marker: 'contest',
			roll: ['Grapple (Athletics)', sk('athletics')]
		},
		{
			id: 'shove',
			name: 'Shove',
			hint: signed(sk('athletics')),
			desc: 'prone / push 5 ft',
			marker: 'contest',
			roll: ['Shove (Athletics)', sk('athletics')]
		},
		{ id: 'help', name: 'Help', hint: '', desc: 'give an ally advantage', marker: 'action' },
		{ id: 'ready', name: 'Ready', hint: '', desc: 'prepare a trigger', marker: 'action' },
		// 2024 renamed 2014's "Use an Object" to "Utilize"
		{
			id: 'utilize',
			name: is2024 ? 'Utilize' : 'Use an Object',
			hint: '',
			desc: 'use an object',
			marker: 'action'
		}
	];
}
