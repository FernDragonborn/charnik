<script lang="ts">
	// Build / create — bakes design-preview/d-build.html: two-column card editor (Classes &
	// subclass · Proficiencies & choices · Ability boosts & feats | Ability scores · Spells) with
	// a full-width review/create bar. Wired to the content graph + a live deriveSheet preview +
	// the character store. Rules stay lenient (Free by default); only a name is required to
	// create. Single-class v1 (multiclass deferred).
	import { onMount } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { build, rowName, ASI } from './state.svelte';
	import { ABILITIES } from '$lib/character/schema';
	import { SKILL_ABILITY } from '$lib/character/derive';
	import { loadCharacterBySlug } from '$lib/character/store.svelte';
	import type { Ability } from '$lib/rules/core';
	import type { StatMethod } from '$lib/build/rules';

	onMount(build.load);

	// Runs on first load AND every navigation (incl. a query-only change on this same route, which
	// doesn't remount): ?edit/?levelup=<slug> hydrates from that character; no param → a fresh draft
	// (so "New character" after a level-up doesn't reopen the last edit).
	afterNavigate(async () => {
		const slug = page.url.searchParams.get('edit') || page.url.searchParams.get('levelup');
		const char = slug ? await loadCharacterBySlug(slug) : null;
		if (char) build.hydrate(char);
		else build.reset();
	});

	const b = build;
	const titleCase = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
	const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
	const METHODS: { id: StatMethod; label: string }[] = [
		{ id: 'point-buy', label: 'Point buy' },
		{ id: 'standard-array', label: 'Standard array' },
		{ id: 'manual', label: 'Manual' }
	];

	async function create() {
		const id = await b.save();
		if (id) goto(`${base}/combat`);
	}
</script>

<svelte:head><title>Build — Charnik</title></svelte:head>

<section class="page">
	<div class="bhead">
		<h1>Build</h1>
		<label class="namewrap">
			<span class="vh">Character name</span>
			<input class="nameinput" placeholder="Name your character…" bind:value={b.draft.name} />
		</label>
		<span class="spacer"></span>
		<div class="seg2" role="group" aria-label="Ruleset">
			<button class:on={b.draft.system === '5e'} onclick={() => (b.draft.system = '5e')}>5e</button>
			<button class:on={b.draft.system === '5.5e'} onclick={() => (b.draft.system = '5.5e')}>5.5e</button>
		</div>
		<div class="seg2" role="group" aria-label="Enforcement">
			<button class:on={b.draft.strict} onclick={() => (b.draft.strict = true)} title="enforce rules">Strict</button>
			<button class:free={true} class:on={!b.draft.strict} onclick={() => (b.draft.strict = false)} title="change anything">Free</button>
		</div>
	</div>

	<div class="cols">
		<div class="col">
			<!-- origin (creation-only: the mock edits an existing sheet, so it has no picker) -->
			<div class="card">
				<h2>Origin</h2>
				<label class="field">
					<span>Species</span>
					<select
						value={b.draft.speciesId ?? ''}
						onchange={(e) => b.pickSpecies(e.currentTarget.value || null)}
					>
						<option value="">— choose —</option>
						{#each b.speciesList as r (r.effectiveId)}<option value={r.effectiveId}
								>{rowName(r)}</option
							>{/each}
					</select>
				</label>
				{#if b.speciesOptions.length}
					<label class="field">
						<span>{b.speciesOptionLabel}</span>
						<select bind:value={b.draft.speciesOptionId}>
							<option value={null}>— choose —</option>
							{#each b.speciesOptions as r (r.effectiveId)}<option value={r.effectiveId}
									>{rowName(r)}</option
								>{/each}
						</select>
					</label>
				{/if}
				<label class="field">
					<span>Background</span>
					<select bind:value={b.draft.backgroundId}>
						<option value={null}>— choose —</option>
						{#each b.backgroundList as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
					</select>
				</label>
			</div>

			<!-- classes & subclass (multiclass: one clsrow per class) -->
			<div class="card">
				<h2>
					Classes &amp; subclass
					<button class="add" onclick={() => b.addClass()}>＋ Multiclass</button>
				</h2>
				{#each b.draft.classes as cls, i (i)}
					{@const clsRow = cls.classId ? b.graph?.get(cls.classId) : undefined}
					{@const subs = b.subclassesFor(cls.classId)}
					<div class="clsrow">
						<span class="ic">{clsRow ? '✦' : i === 0 ? '＋' : '⌁'}</span>
						<span class="nm">
							<select class="bare" value={cls.classId ?? ''} onchange={(e) => b.setClass(i, e.currentTarget.value || null)}>
								<option value="">{i === 0 ? 'Choose a class…' : 'Add a class…'}</option>
								{#each b.classList as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
							</select>
							{#if clsRow}
								<small>{titleCase(String(clsRow.data.hit_die))} hit die{#if i === 0} · saves {String(clsRow.data.saves).toUpperCase()}{/if}</small>
							{:else}
								<small>{i === 0 ? 'pick your class — level, saves & skills follow' : 'multiclass — adds levels'}</small>
							{/if}
							{#if subs.length}
								<select class="bare sub2" value={cls.subclassId ?? ''} onchange={(e) => b.setSubclass(i, e.currentTarget.value || null)}>
									<option value="">Subclass — none yet</option>
									{#each subs as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
								</select>
							{/if}
						</span>
						<span class="stepper lvl">
							<button aria-label="lower level" onclick={() => b.bumpClassLevel(i, -1)}>−</button>
							<span class="base">{cls.level}</span>
							<button aria-label="raise level" onclick={() => b.bumpClassLevel(i, 1)}>+</button>
						</span>
						{#if i > 0}
							<button class="rm" title="Remove class" onclick={() => b.removeClass(i)}>✕</button>
						{/if}
					</div>
				{/each}
				{#if b.draft.classes.length > 1}
					<p class="sub note">Total level <b class="gold">{b.totalLevel}</b> / 20</p>
				{/if}
			</div>

			<!-- proficiencies & choices -->
			<div class="card">
				<h2>Proficiencies &amp; choices</h2>
				<p class="sub">Saving throws <span class="gold">(fixed by class)</span></p>
				<div class="chips gap">
					{#if b.classRow}
						{#each String(b.classRow.data.saves).split(',') as sv (sv)}
							<span class="pchip locked">{sv.trim().toUpperCase()}</span>
						{/each}
					{:else}<span class="sub">—</span>{/if}
				</div>

				<p class="sub">
					Skills — choose <b class="teal">{b.skillChosenCount}/{b.classSkillCount}</b> from class
					{#if b.autoSkills.length}· <span class="gold">{b.autoSkills.length} from background</span>{/if}
				</p>
				<div class="chips gap">
					{#each Object.keys(SKILL_ABILITY) as skill (skill)}
						{@const auto = b.autoSkills.includes(skill)}
						{@const on = auto || b.draft.skills.includes(skill)}
						{@const pickable = b.skillPickable(skill)}
						<span class="skwrap">
							<button class="pchip" class:on class:locked={auto} class:dim={!pickable} disabled={auto || !pickable} onclick={() => b.toggleSkill(skill)}>
								{titleCase(skill)}
							</button>
							{#if on}
								<button class="x2" class:on={b.draft.expertise.includes(skill)} title="Expertise (×2 proficiency)" onclick={() => b.toggleExpertise(skill)}>×2</button>
							{/if}
						</span>
					{/each}
				</div>

				<p class="sub">
					Languages <span class="cnt">{b.draft.selectedLanguages.length}</span>
					{#if b.backgroundLangCount > 0}<span class="note"
							>· background grants {b.backgroundLangCount}</span
						>{/if}
				</p>
				<div class="chips gap">
					{#each b.languageList as r (r.effectiveId)}
						<button
							class="pchip"
							class:on={b.draft.selectedLanguages.includes(r.effectiveId)}
							onclick={() => b.toggleLanguage(r.effectiveId)}>{rowName(r)}</button
						>
					{/each}
				</div>
			</div>

			<!-- ability boosts & feats -->
			<div class="card">
				<h2>Ability boosts &amp; feats <span class="cnt">{b.filledSlots}/{b.featSlots.length}</span></h2>
				{#if !b.classId}
					<p class="sub">Pick a class to see its ASI / feat slots.</p>
				{:else}
					{#if b.originFeatRef}
						<div class="frow">
							<span class="lvtag gold">BG</span>
							<span class="ft"><b>Origin feat</b> — {rowName(b.graph?.get(b.originFeatRef))} <span class="sub">(granted)</span></span>
						</div>
					{/if}
					{#each b.featSlots as slot (slot.key)}
						{@const chosen = b.draft.slotFeats[slot.key] ?? ''}
						{@const asi = b.draft.slotAsi[slot.key]}
						{@const multi = b.draft.classes.length > 1}
						<div class="frow" class:done={!!chosen}>
							<span class="lvtag">{multi ? `${slot.className.slice(0, 3)} ` : ''}L{slot.level}</span>
							<select class="bare ftsel" value={chosen} onchange={(e) => b.setSlotFeat(slot.key, e.currentTarget.value)}>
								<option value="">— ASI or feat —</option>
								<option value={ASI}>Ability Score Improvement (+2 or +1/+1)</option>
								{#each b.featOptionsFor(slot.level) as f (f.effectiveId)}
									<option value={f.effectiveId} disabled={b.featOptionBlocked(f.effectiveId, slot.key)}>
										{rowName(f)}{b.isRepeatable(f.effectiveId) ? ' ↻' : ''}
									</option>
								{/each}
							</select>
						</div>
						{#if chosen === ASI && asi}
							<div class="asi">
								<div class="seg2 small">
									<button class:on={asi.shape === '2'} onclick={() => b.setAsiShape(slot.key, '2')}>+2 one</button>
									<button class:on={asi.shape === '1-1'} onclick={() => b.setAsiShape(slot.key, '1-1')}>+1 / +1</button>
								</div>
								<div class="chips">
									{#each ABILITIES as ab (ab)}
										{@const amt = b.asiBoostFor(slot.key)[ab as Ability]}
										<button class="pchip" class:on={asi.picks.includes(ab as Ability)} onclick={() => b.toggleAsiPick(slot.key, ab as Ability)}>
											{ab.toUpperCase()}{#if amt}<span class="gold"> +{amt}</span>{/if}
										</button>
									{/each}
								</div>
							</div>
						{/if}
					{/each}
					<p class="sub note">↻ = repeatable — take it in more than one slot. ASI &amp; feats apply to the preview.</p>
				{/if}
			</div>
		</div>

		<div class="col">
			<!-- ability scores -->
			<div class="card">
				<div class="statgenhead">
					<div class="method">
						{#each METHODS as m (m.id)}
							<button class="seg" class:on={b.draft.method === m.id} onclick={() => b.setMethod(m.id)}>{m.label}</button>
						{/each}
					</div>
					{#if b.draft.method === 'point-buy'}
						<span class="points">Points <b class:over={b.pointsLeft < 0}>{b.pointsLeft}</b> / 27</span>
					{/if}
				</div>

				{#each ABILITIES as ab (ab)}
					{@const block = b.sheet?.abilities[ab as Ability]}
					<div class="strow">
						<span class="ab">{ab}</span>
						{#if b.draft.method === 'standard-array'}
							<select class="arraysel bare" value={b.draft.arrayPick[ab as Ability] ?? ''} onchange={(e) => b.assignArray(ab as Ability, e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}>
								<option value="">—</option>
								{#if b.draft.arrayPick[ab as Ability] != null}<option value={b.draft.arrayPick[ab as Ability]}>{b.draft.arrayPick[ab as Ability]}</option>{/if}
								{#each b.arrayRemaining as v (v)}<option value={v}>{v}</option>{/each}
							</select>
						{:else}
							<span class="stepper">
								<button aria-label="lower {ab}" onclick={() => b.bumpAbility(ab as Ability, -1)}>−</button>
								<span class="base">{b.draft.abilities[ab as Ability]}</span>
								<button aria-label="raise {ab}" onclick={() => b.bumpAbility(ab as Ability, 1)}>+</button>
							</span>
						{/if}
						<span class="bonus">{b.abilityNote(ab as Ability)}</span>
						<span class="total">{block?.score ?? b.draft.abilities[ab as Ability]} <small>{block ? signed(block.mod) : ''}</small></span>
					</div>
				{/each}

				{#if b.boostCarrier === 'background' && b.backgroundBoostChoices.length}
					<div class="boost">
						<p class="sub">5.5e background boost — on your <b class="gold">{rowName(b.backgroundRow)}</b> abilities</p>
						<div class="seg2 small">
							<button class:on={b.draft.boostShape === '2-1'} onclick={() => (b.draft.boostShape = '2-1')}>+2 / +1</button>
							<button class:on={b.draft.boostShape === '1-1-1'} onclick={() => (b.draft.boostShape = '1-1-1')}>+1 / +1 / +1</button>
						</div>
						<div class="chips gap">
							{#each b.backgroundBoostChoices as ab (ab)}
								<button class="pchip" class:on={b.draft.boostPicks.includes(ab)} onclick={() => b.toggleBoostPick(ab)}>
									{ab.toUpperCase()}{#if b.backgroundBoosts[ab]}<span class="gold"> +{b.backgroundBoosts[ab]}</span>{/if}
								</button>
							{/each}
						</div>
					</div>
				{:else if b.boostCarrier === 'species'}
					<p class="sub note">5e species ability bonuses apply automatically from the species entry.</p>
					{#if b.speciesBoostChoice}
						<div class="boost">
							<p class="sub">
								{rowName(b.speciesOptionRow) || rowName(b.speciesRow)} — choose
								<b class="gold">{b.speciesBoostChoice.count}</b> to raise by +{b.speciesBoostChoice
									.amount}
								<span class="cnt">{b.draft.speciesBoostPicks.length}/{b.speciesBoostChoice.count}</span>
							</p>
							<div class="chips gap">
								{#each b.speciesBoostAbilities as ab (ab)}
									<button
										class="pchip"
										class:on={b.draft.speciesBoostPicks.includes(ab)}
										onclick={() => b.toggleSpeciesBoostPick(ab)}
									>
										{ab.toUpperCase()}{#if b.draft.speciesBoostPicks.includes(ab)}<span class="gold">
												+{b.speciesBoostChoice.amount}</span
											>{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- spells (per caster class; Strict = access + level caps, Free = everything) -->
			<div class="card">
				<h2>Spells <span class="cnt teal">{b.draft.selectedSpells.length}</span></h2>
				{#if b.spellPicker.length}
					<p class="sub">
						{b.draft.strict ? 'Only spells you can legally take' : 'Free mode — every spell'} · refine
						prepared/known in the <b>Spellbook</b> after creating.
					</p>
					{#each b.spellPicker as pc (pc.profile.classEffectiveId)}
						{#if b.spellPicker.length > 1}
							<p class="sub sgrp">
								{pc.profile.className} — cantrips <b class="teal">{pc.cantripsChosen}/{pc.profile.cantripCap}</b>
								· prepared <b class="gold">{pc.leveledChosen}/{pc.profile.preparedCap}</b>
							</p>
						{:else}
							<p class="sub">
								Cantrips <b class="teal">{pc.cantripsChosen}/{pc.profile.cantripCap}</b> · prepared
								<b class="gold">{pc.leveledChosen}/{pc.profile.preparedCap}</b>
							</p>
						{/if}
						{#each pc.groups as g (g.level)}
							<p class="sub sgrp">{g.label}</p>
							<div class="chips gap">
								{#each g.spells as s (s.effectiveId)}
									<button
										class="pchip"
										class:on={b.draft.selectedSpells.includes(s.effectiveId)}
										onclick={() => b.toggleSpell(s.effectiveId)}
									>
										{rowName(s)}
									</button>
								{/each}
							</div>
						{/each}
					{/each}
				{:else if b.classRow}
					<p class="sub">{rowName(b.classRow)} has no innate spellcasting.</p>
				{:else}
					<p class="sub">Pick a class to see spellcasting.</p>
				{/if}
			</div>

			<!-- inventory / starting equipment (creation only — managed in the play view after that) -->
			{#if !b.edit}
				<div class="card">
					<h2>Inventory <span class="cnt">{b.draft.inventory.length}</span></h2>
			<label class="field">
				<span>Add item</span>
				<select
					value=""
					onchange={(e) => {
						b.addInventoryItem(e.currentTarget.value);
						e.currentTarget.value = '';
					}}
				>
					<option value="">— add an item —</option>
					{#each b.itemList as r (r.effectiveId)}<option value={r.effectiveId}
							>{rowName(r)}</option
						>{/each}
				</select>
			</label>
			{#if b.draft.inventory.length}
				<div class="invlist">
					{#each b.draft.inventory as it (it.item)}
						<div class="invrow">
							<span class="invname">{rowName(b.graph?.get(it.item))}</span>
							<span class="invqty">
								<button onclick={() => b.bumpItemQty(it.item, -1)} aria-label="Fewer">−</button>
								<b>{it.qty}</b>
								<button onclick={() => b.bumpItemQty(it.item, 1)} aria-label="More">+</button>
							</span>
							{#if b.itemEquippable(it.item)}
								<button
									class="pchip"
									class:on={it.equipped}
									onclick={() => b.toggleItemEquipped(it.item)}
									>{it.equipped ? 'Equipped' : 'Equip'}</button
								>
							{/if}
							<button
								class="invrm"
								onclick={() => b.removeInventoryItem(it.item)}
								aria-label="Remove">✕</button
							>
						</div>
					{/each}
				</div>
				{:else}
					<p class="sub">No items yet — add starting equipment.</p>
				{/if}
			</div>
		{/if}
		</div>
	</div>

	<!-- review & create (echoes the mock's bottom lucard) -->
	<div class="card review">
		<h2 class="rev">
			{b.edit ? 'Review & save' : 'Review & create'}
			<span class="cnt gold">Level {b.sheet?.level ?? b.totalLevel}</span>
		</h2>
		<div class="revgrid">
			{#if b.sheet}
				<div class="stats">
					<div class="stat"><b>{b.sheet.ac.value}</b><small>AC</small></div>
					<div class="stat"><b>{b.sheet.maxHp.value}</b><small>Max HP</small></div>
					<div class="stat"><b>{signed(b.sheet.initiative.value)}</b><small>Init</small></div>
					<div class="stat"><b>{b.sheet.speed.value}</b><small>Speed</small></div>
					<div class="stat"><b>{signed(b.sheet.proficiencyBonus)}</b><small>Prof</small></div>
					{#if b.sheet.spellcasting.classes[0]}<div class="stat"><b>{b.sheet.spellcasting.classes[0].saveDC.value}</b><small>Spell DC</small></div>{/if}
				</div>
			{/if}
			<div class="revside">
				{#if b.issues.length}
					<ul class="issues">{#each b.issues as msg (msg)}<li>{msg}</li>{/each}</ul>
				{:else}
					<p class="sub ready">Ready to create.</p>
				{/if}
				{#if b.sheet?.missing.length}
					<p class="sub warn">Missing content: {b.sheet.missing.join(', ')}</p>
				{/if}
				<button class="create wide" disabled={!b.canCreate || b.saving} onclick={create}>
					{b.saving ? 'Saving…' : b.edit ? '✦ Save changes' : '✦ Create character'}
				</button>
			</div>
		</div>
	</div>
</section>

<style>
	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.bhead {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}
	.page :global(h1) {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--font-size-xl);
		margin: 0;
	}
	.namewrap {
		flex: 1;
		min-width: 200px;
		max-width: 360px;
	}
	.nameinput {
		width: 100%;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 16px;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: 9px;
		padding: 9px 12px;
	}
	.nameinput:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.spacer {
		flex: 1;
	}
	.seg2 {
		display: flex;
		border: 1px solid var(--color-border-strong);
		border-radius: 8px;
		overflow: hidden;
	}
	.seg2 button {
		all: unset;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 7px 13px;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.seg2 button:hover {
		color: var(--color-text);
	}
	.seg2 button.on {
		background: var(--color-good-soft);
		color: var(--color-good);
	}
	.seg2 button.free.on {
		background: var(--color-resource-soft);
		color: var(--color-resource);
	}
	.seg2.small button {
		padding: 5px 10px;
		font-size: 11px;
	}
	.create {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 13px;
		background: var(--color-accent-deep);
		border: 1px solid var(--color-accent-deep);
		color: var(--color-accent-text);
		border-radius: 9px;
		padding: 9px 16px;
		cursor: pointer;
	}
	.create:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.create.wide {
		width: 100%;
		padding: 11px;
	}

	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
		align-items: start;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 17px;
	}
	.card :global(h2) {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 0 0 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.add {
		all: unset;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 11px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--color-text-muted);
		border: 1px dashed var(--color-border-strong);
		border-radius: 7px;
		padding: 3px 9px;
		cursor: pointer;
	}
	.add:hover {
		color: var(--color-text);
		border-color: var(--color-accent);
	}
	.rm {
		all: unset;
		flex: none;
		cursor: pointer;
		color: var(--color-border-strong);
		font-size: 12px;
		padding: 0 6px;
	}
	.rm:hover {
		color: var(--color-accent-bright);
	}
	.sub2 {
		display: block;
		margin-top: 3px;
		font-size: 12px;
		font-weight: 500;
	}
	.cnt {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0;
	}
	.gold {
		color: var(--color-resource);
	}
	.teal {
		color: var(--color-good);
	}
	.sub {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 0 0 8px;
	}
	.sub.note {
		margin-top: 10px;
	}
	.sub.sgrp {
		margin-top: 10px;
		color: var(--color-resource);
	}
	.sub.warn {
		color: var(--color-warning);
	}
	.sub.ready {
		color: var(--color-good);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 11px;
	}
	.field:last-child {
		margin-bottom: 0;
	}
	.field > span {
		flex: none;
		width: 92px;
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	select {
		font-family: var(--font-body);
		font-size: 13px;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 7px 10px;
		cursor: pointer;
	}
	.field select {
		flex: 1;
	}
	select:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	/* a select that reads as inline text inside a row (class/subclass/feat) */
	.bare {
		background: transparent;
		border: 1px solid transparent;
		padding: 3px 4px;
		border-radius: 6px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14px;
	}
	.bare:hover {
		border-color: var(--color-border);
		background: var(--color-surface-2);
	}

	/* class rows */
	.clsrow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-top: 1px solid var(--color-border);
	}
	.clsrow:first-of-type {
		border-top: 0;
	}
	.clsrow .ic {
		width: 38px;
		height: 38px;
		border-radius: 10px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		display: grid;
		place-items: center;
		font-size: 18px;
		flex: none;
		color: var(--color-accent-bright);
	}
	.clsrow .nm {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.clsrow .nm small {
		color: var(--color-text-muted);
		font-size: 12px;
		padding-left: 5px;
	}
	.lvl {
		flex: none;
	}

	.stepper {
		display: flex;
		align-items: center;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 9px;
		overflow: hidden;
		width: max-content;
	}
	.stepper button {
		all: unset;
		cursor: pointer;
		color: var(--color-text-muted);
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		font-size: 16px;
	}
	.stepper button:hover {
		background: var(--color-border);
		color: var(--color-text);
	}
	.stepper .base {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 16px;
		min-width: 32px;
		text-align: center;
	}
	.lvl .base {
		color: var(--color-resource);
		font-size: 20px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	.chips.gap {
		margin-bottom: 12px;
	}
	.pchip {
		all: unset;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 5px 11px;
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
	}
	.pchip:hover:not(:disabled) {
		border-color: var(--color-border-strong);
	}
	.pchip.on {
		background: var(--color-good-soft);
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.pchip.locked {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
		cursor: default;
	}
	.pchip.dim {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.invlist {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}
	.invrow {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 6px 10px;
	}
	.invname {
		flex: 1;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 13px;
	}
	.invqty {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.invqty button {
		width: 22px;
		height: 22px;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	.invrm {
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
	}
	.invrm:hover {
		color: var(--color-danger, #d06a52);
	}
	.pchip:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.skwrap {
		display: inline-flex;
		align-items: stretch;
		gap: 3px;
	}
	.x2 {
		all: unset;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		padding: 0 6px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		cursor: pointer;
	}
	.x2:hover {
		border-color: var(--color-border-strong);
	}
	.x2.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.x2:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	/* feat / ASI slot rows */
	.frow {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--color-border);
	}
	.frow:first-of-type {
		border-top: 0;
	}
	.frow .lvtag {
		flex: none;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		padding: 2px 7px;
	}
	.frow.done .lvtag {
		border-color: var(--color-good);
		color: var(--color-good);
	}
	.frow .ft {
		flex: 1;
		font-size: 13px;
	}
	.frow .ft b {
		font-family: var(--font-display);
		font-weight: 600;
	}
	.ftsel {
		flex: 1;
	}
	.asi {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px 0 10px 34px;
	}

	.statgenhead {
		display: flex;
		align-items: center;
		margin-bottom: 12px;
	}
	.method {
		display: flex;
		gap: 6px;
	}
	.seg {
		all: unset;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 12px;
		padding: 6px 12px;
		border-radius: 8px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.seg.on {
		background: var(--color-resource-soft);
		border-color: var(--color-resource);
		color: var(--color-resource);
	}
	.points {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.points b {
		color: var(--color-good);
	}
	.points b.over {
		color: var(--color-danger);
	}
	.strow {
		display: grid;
		grid-template-columns: 40px 108px 1fr 76px;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--color-border);
	}
	.strow:first-of-type {
		border-top: 0;
	}
	.ab {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.arraysel {
		width: max-content;
	}
	.bonus {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-text-muted);
	}
	.total {
		text-align: right;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 18px;
	}
	.total small {
		color: var(--color-text-muted);
		font-size: 12px;
		font-weight: 500;
		margin-left: 4px;
	}
	.boost {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	/* review bar */
	.review {
		margin-top: 18px;
		background: linear-gradient(180deg, var(--color-accent-soft), var(--color-surface));
		border-color: var(--color-accent-deep);
	}
	.review .rev {
		color: var(--color-accent-bright);
	}
	.revgrid {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 18px;
		align-items: center;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}
	.stat {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		padding: 10px;
		text-align: center;
	}
	.stat b {
		display: block;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 22px;
	}
	.stat small {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}
	.revside {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.issues {
		margin: 0;
		padding-left: 16px;
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.issues li {
		margin: 2px 0;
	}

	@media (max-width: 760px) {
		.cols,
		.revgrid {
			grid-template-columns: 1fr;
		}
	}
</style>
