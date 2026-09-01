/*
 * Choosing spells: one picker section per caster class, and the Strict caps over them.
 *
 * Strict shows only legally-pickable spells (the class's access map, cantrips always + leveled up to
 * its max spell level); Free lifts every gate, mirroring the skills toggle.
 */
import { toast } from 'svelte-sonner';
import { t } from '$lib/i18n';
import { buildSpellPicker } from '$lib/build/derive';
import { casterForSpell, classCasts } from '$lib/character/spellcasting';
import { rowOfType } from './rows';
import type { BuildVM } from './build-view-model.svelte';

/** What the spell picker needs from the build view-model around it. */
export type SpellPicksHost = Pick<BuildVM, 'draft' | 'edit' | 'graph' | 'sheet' | 'spellList' | 'row'>;

export class SpellPicks {
	constructor(private host: () => SpellPicksHost) {}

	isCaster = $derived.by(() =>
		this.host().draft.classes.some((c) => {
			const row = rowOfType(this.host().row(c.classId), 'class');
			return !!row && classCasts(row);
		}),
	);

	/** One section per caster class — a single-class character collapses to one. */
	picker = $derived.by(() => {
		const host = this.host();
		return host.graph && host.sheet
			? buildSpellPicker({
					allSpells: host.spellList,
					sheet: host.sheet,
					graph: host.graph,
					strict: host.draft.strict,
					selectedSpells: host.draft.selectedSpells,
				})
			: [];
	});

	/** The spell level of a ref, as the content declares it. */
	private levelOf = (ref: string): number =>
		Number(rowOfType(this.host().graph?.get(ref), 'spell')?.data.level ?? 0);

	toggle = (ref: string) => {
		const draft = this.host().draft;
		if (draft.selectedSpells.includes(ref)) {
			if (this.host().edit && draft.strict && this.host().edit?.spells.has(ref)) {
				toast(t('build.notice.strictKnownSpell'));
				return;
			}
			draft.selectedSpells = draft.selectedSpells.filter((s) => s !== ref);
			return;
		}
		if (draft.strict && this.blockedByCap(ref)) return;
		draft.selectedSpells = [...draft.selectedSpells, ref];
	};

	/**
	 * Is this pick refused by the cap of the class it would be charged to?
	 *
	 * The charge follows `casterForSpell` — the one attribution rule the play sheet and the picker's
	 * own tally already share (RV1). Refusing on "any class whose list holds it" instead is a
	 * different rule from the one that counts: a Cleric 5 / Wizard 5 who is full on cleric picks was
	 * refused *Cure Wounds* as a Wizard, even though nothing would ever have charged it to the cleric.
	 */
	private blockedByCap(ref: string): boolean {
		const owner = casterForSpell(this.host().sheet, ref);
		const charged = this.picker.find((pc) => pc.profile.classId === owner?.classId);
		// a spell on no class's list is charged to nobody, so there is no cap to be full
		if (!charged?.profile.accessSpellIds.includes(ref)) return false;
		const [chosen, cap, what] =
			this.levelOf(ref) === 0
				? ([charged.cantripsChosen, charged.profile.cantripCap, 'capCantrips'] as const)
				: ([charged.leveledChosen, charged.profile.preparedCap, 'capPrepared'] as const);
		if (chosen < cap) return false;
		// the class name only when there is more than one caster to tell apart
		const who = this.picker.length > 1 ? `${charged.profile.className} ` : '';
		toast(t('build.notice.strictCapFull', { who, what: t(`build.notice.${what}`), cap }));
		return true;
	}
}
