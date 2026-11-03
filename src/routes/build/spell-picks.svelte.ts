/*
 * Choosing spells: one picker, a destination profile, and the Strict caps over each source.
 *
 * Strict shows only legally-pickable spells (the class's access map, cantrips always + leveled up to
 * its max spell level); Free lifts every gate, mirroring the skills toggle.
 */
import { toast } from '$lib/toast/toast';
import { t } from '$lib/i18n';
import { buildSpellPicker } from '$lib/build/derive';
import { casterForSpell, classCasts } from '$lib/character/spellcasting';
import { rowOfType } from './rows';
import type { BuildVM } from './build-view-model.svelte';

/** What the spell picker needs from the build view-model around it. */
export type SpellPicksHost = Pick<
	BuildVM,
	'draft' | 'edit' | 'graph' | 'sheet' | 'spellList' | 'row' | 'feats'
>;

export class SpellPicks {
	constructor(private host: () => SpellPicksHost) {}
	profileId = $state<string | null>(null);

	/** Does this character cast at all? Asked of the PROFILES rather than of the class rows, because a
	 *  Fighter who took Magic Initiate casts and no class row says so (§D). The class test survives as
	 *  the answer before a sheet exists — the profiles are derived from one. */
	isCaster = $derived.by(() => {
		const host = this.host();
		if ((host.sheet?.spellcasting.classes.length ?? 0) > 0) return true;
		return host.draft.classes.some((c) => {
			const row = rowOfType(host.row(c.classId), 'class');
			return !!row && classCasts(row);
		});
	});

	/** Each profile keeps its own pool and counters; the pane renders only one list. */
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
	active = $derived(
		this.picker.find((pc) => pc.profile.classEffectiveId === this.profileId) ??
			this.picker[0] ??
			null,
	);
	activeFeat = $derived.by(() =>
		this.host().feats.featSpellPicks.find(
			(choice) => `${choice.feat}.${choice.key}` === this.active?.profile.classEffectiveId,
		),
	);
	activeHeld = $derived.by(() => [
		...new Set([
			...(this.activeFeat ? (this.activeFeat.spells ?? []) : this.host().draft.selectedSpells),
			...(this.active?.profile.grantedSpells ?? []),
		]),
	]);

	/** The spells a class feature keeps always prepared (a Domain's, an Oath's) — had, never picked. */
	granted = $derived.by(
		() =>
			new Set(
				this.host()
					.sheet?.spellcasting.classes.filter((profile) => profile.chosenSpells === undefined)
					.flatMap((profile) => profile.grantedSpells) ?? [],
			),
	);
	/** What the picker shows as held: the picks, and what a feature grants. */
	held = $derived.by(() => [
		...new Set([
			...this.host().draft.selectedSpells,
			...this.host().feats.featSpellPicks.flatMap((choice) => choice.spells ?? []),
			...this.granted,
		]),
	]);

	toggleForActive = (ref: string) => {
		const feat = this.activeFeat;
		if (!feat) {
			this.toggle(ref);
			return;
		}
		const host = this.host();
		const current = host.draft.slotFeatSpells[feat.key];
		if (!current) return;
		const selected = current.spells ?? [];
		if (selected.includes(ref)) {
			if (
				host.edit &&
				host.draft.strict &&
				host.edit.loaded.slotFeatSpells[feat.key]?.spells?.includes(ref)
			) {
				toast(t('build.notice.strictKnownSpell'));
				return;
			}
		} else if (
			host.draft.strict &&
			this.active &&
			this.atCap(
				current.spells === undefined
					? { ...this.active, cantripsChosen: 0, leveledChosen: 0 }
					: this.active,
				ref,
			)
		)
			return;
		host.draft.slotFeatSpells = {
			...host.draft.slotFeatSpells,
			[feat.key]: {
				...current,
				spells: selected.includes(ref) ? selected.filter((id) => id !== ref) : [...selected, ref],
			},
		};
	};

	remove = (ref: string) => {
		const host = this.host();
		if (this.granted.has(ref)) {
			toast(t('build.notice.grantedSpell'));
			return;
		}
		if (
			host.edit &&
			host.draft.strict &&
			(host.edit.spells.has(ref) ||
				Object.values(host.edit.loaded.slotFeatSpells).some((choice) =>
					choice.spells?.includes(ref),
				))
		) {
			toast(t('build.notice.strictKnownSpell'));
			return;
		}
		host.draft.selectedSpells = host.draft.selectedSpells.filter((id) => id !== ref);
		host.draft.slotFeatSpells = Object.fromEntries(
			Object.entries(host.draft.slotFeatSpells).map(([key, choice]) => [
				key,
				{
					...choice,
					...(choice.spells ? { spells: choice.spells.filter((id) => id !== ref) } : {}),
				},
			]),
		);
	};

	/** The spell level of a ref, as the content declares it. */
	private levelOf = (ref: string): number =>
		Number(rowOfType(this.host().graph?.get(ref), 'spell')?.data.level ?? 0);

	toggle = (ref: string) => {
		const draft = this.host().draft;
		if (this.granted.has(ref)) {
			toast(t('build.notice.grantedSpell'));
			return;
		}
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
		const sheet = this.host().sheet;
		const owner = casterForSpell(
			sheet
				? {
						spellcasting: {
							classes: sheet.spellcasting.classes.filter(
								(profile) => profile.chosenSpells === undefined,
							),
						},
					}
				: null,
			ref,
		);
		const charged = this.picker.find((pc) => pc.profile.classId === owner?.classId);
		// a spell on no class's list is charged to nobody, so there is no cap to be full
		if (!charged?.profile.accessSpellIds.includes(ref)) return false;
		return this.atCap(charged, ref);
	}

	private atCap(charged: (typeof this.picker)[number], ref: string): boolean {
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
