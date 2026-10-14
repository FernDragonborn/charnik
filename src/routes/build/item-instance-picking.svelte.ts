/*
 * Taking an item that leaves a question open — which weapon, which +N — out of the shared item
 * picker. The builder's equipment pane and the play sheet's Add item popover both mount the same
 * `SectionedPicker`, so both take through this: the question is asked when the item is ADDED, in a
 * small popover beside the ✓, and what lands in the inventory is that one instance — never the
 * book's "Weapon, +1, +2, or +3" with its questions left standing on the row.
 *
 * A search that already says which one ("longsword +1", "shield +2") skips the question: the picker
 * offers those instances as rows of their own, above the rest, answered.
 */
import {
	asksWhichOne,
	instanceQuestions,
	instanceRowId,
	instancesForQuery,
	parseInstanceRowId,
	sayInstanceWith,
	type InstanceAnswers,
	type InstanceQuestions,
	type InstanceScope,
} from '$lib/content/item-instance';
import { localizedName } from '$lib/content/detail';
import { parseBonusChoices } from '$lib/content/item-tags';
import type { LoadedRow } from '$lib/content/loader';
import { translator } from '$lib/i18n';

/** What the pane taking items gives this: where to look, and what to do with what was taken. */
export interface InstancePickingHost {
	scope: () => InstanceScope | null;
	carried: () => readonly string[];
	add: (ref: string) => void;
	addInstance: (ref: string, answers: InstanceAnswers) => void;
	putBack: (ref: string) => void;
}

/** One section of the shared picker. */
export interface PickerSection {
	key: string;
	label: string;
	rows: LoadedRow[];
}

/** The key of the section above the rest — open from the start, so it is seen before anything is
 *  typed. */
export const INSTANCE_SECTION = 'instances';

/** Its heading: the book's +N rows before a search, the instances a search named after one. */
export interface InstanceSectionLabels {
	tiered: string;
	found: string;
}

/** The question on screen: which row, what it is called, and the control it opened beside. */
export interface InstanceAsk {
	ref: string;
	name: string;
	questions: InstanceQuestions;
	anchor: HTMLElement;
}

export class InstancePicking {
	asking = $state<InstanceAsk | null>(null);

	constructor(private host: InstancePickingHost) {}

	/**
	 * The section above the rest. Before anything is typed it holds the rows the book prints once
	 * at several bonuses — Weapon, Armor, Shield, Ammunition +N — so a magic item is one press away
	 * and asks which one. Once a search names an instance ("longsword +1") it holds those instances,
	 * answered: each is the content row it is an instance of, under the instance's name and an id
	 * that carries the answers. None when a search names none.
	 */
	section(query: string, labels: InstanceSectionLabels): PickerSection | null {
		const scope = this.host.scope();
		if (!scope) return null;
		if (!query.trim()) {
			const tiered = scope.graph
				.list('item', { system: scope.system })
				.filter((row) => scope.isActive(row) && parseBonusChoices(row.data.bonus_choice).length)
				.sort((a, b) => localizedName(a, scope.locale).localeCompare(localizedName(b, scope.locale)));
			return tiered.length ? { key: INSTANCE_SECTION, label: labels.tiered, rows: tiered } : null;
		}
		const rows = instancesForQuery(scope, query, sayInstanceWith(translator())).flatMap((match) => {
			const row = scope.graph.get(match.ref);
			if (row?.type !== 'item') return [];
			const data = { ...row.data, name_en: match.name, [`name_${scope.locale}`]: match.name };
			return [{ ...row, effectiveId: instanceRowId(match), data }];
		});
		return rows.length ? { key: INSTANCE_SECTION, label: labels.found, rows } : null;
	}

	/** A pane's sections with the searched-for instances above them. */
	withInstances = (
		query: string,
		labels: InstanceSectionLabels,
		sections: PickerSection[],
	): PickerSection[] => {
		const found = this.section(query, labels);
		return found ? [found, ...sections] : sections;
	};

	/** The content row behind a picker id — an instance row reads as the row it is an instance of. */
	rowIdOf = (id: string): string => parseInstanceRowId(id)?.ref ?? id;

	/** A press on a row's ✓. An answered instance is carried at once; a row with a question open asks
	 *  it first; anything else toggles as it always did. */
	take = (id: string): void => {
		const instance = parseInstanceRowId(id);
		if (instance) return this.host.addInstance(instance.ref, instance.answers);
		const scope = this.host.scope();
		const row = scope?.graph.get(id);
		if (scope && row?.type === 'item') {
			const questions = instanceQuestions(scope, row);
			const anchor = document.activeElement;
			if (asksWhichOne(questions) && anchor instanceof HTMLElement) {
				this.asking = { ref: id, name: localizedName(row, scope.locale), questions, anchor };
				return;
			}
		}
		if (this.host.carried().includes(id)) this.host.putBack(id);
		else this.host.add(id);
	};

	answer = (answers: InstanceAnswers): void => {
		if (this.asking) this.host.addInstance(this.asking.ref, answers);
		this.asking = null;
	};

	cancel = (): void => {
		this.asking = null;
	};
}
