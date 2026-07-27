<script lang="ts">
	// Classes & subclass card: one row per class (multiclass adds rows), each with a class picker,
	// subclass picker (when the class has subclasses) and a level stepper. Total level caps at 20.
	import { build, rowName, rowOfType } from '../state.svelte';
	import { titleCase } from '$lib/util/format';
	const b = build;
</script>

<div class="card">
	<h2>
		Classes &amp; subclass
		<button class="add-btn" onclick={() => b.addClass()}>＋ Multiclass</button>
	</h2>
	{#each b.draft.classes as cls, i (i)}
		{@const clsRow = cls.classId ? rowOfType(b.graph?.get(cls.classId), 'class') : undefined}
		{@const subs = b.subclassesFor(cls.classId)}
		<div class="class-row">
			<span class="class-icon">{clsRow ? '✦' : i === 0 ? '＋' : '⌁'}</span>
			<span class="class-name">
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
					<select class="bare subclass-select" value={cls.subclassId ?? ''} onchange={(e) => b.setSubclass(i, e.currentTarget.value || null)}>
						<option value="">Subclass — none yet</option>
						{#each subs as r (r.effectiveId)}<option value={r.effectiveId}>{rowName(r)}</option>{/each}
					</select>
				{/if}
			</span>
			<span class="stepper level">
				<button aria-label="lower level" onclick={() => b.bumpClassLevel(i, -1)}>−</button>
				<span class="base">{cls.level}</span>
				<button aria-label="raise level" onclick={() => b.bumpClassLevel(i, 1)}>+</button>
			</span>
			{#if i > 0}
				<button class="remove-btn" title="Remove class" onclick={() => b.removeClass(i)}>✕</button>
			{/if}
		</div>
	{/each}
	{#if b.draft.classes.length > 1}
		<p class="subtext note">Total level <b class="gold">{b.totalLevel}</b> / 20</p>
	{/if}
</div>

<style>
	.add-btn {
		all: unset;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: var(--font-size-xs);
		letter-spacing: 0;
		text-transform: none;
		color: var(--color-text-muted);
		border: 1px dashed var(--color-border-strong);
		border-radius: 7px;
		padding: 3px 9px;
		cursor: pointer;
	}
	.add-btn:hover {
		color: var(--color-text);
		border-color: var(--color-accent);
	}
	.remove-btn {
		all: unset;
		flex: none;
		cursor: pointer;
		color: var(--color-border-strong);
		font-size: var(--font-size-xs);
		padding: 0 6px;
	}
	.remove-btn:hover {
		color: var(--color-accent-bright);
	}
	/* combined with the shared `.bare` on the same element → qualify with .bare so this wins the
	 * font-size/weight override regardless of stylesheet load order (build.css is global). */
	.bare.subclass-select {
		display: block;
		margin-top: 3px;
		font-size: var(--font-size-xs);
		font-weight: 500;
	}
	.class-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-top: 1px solid var(--color-border);
	}
	.class-row:first-of-type {
		border-top: 0;
	}
	.class-row .class-icon {
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
	.class-row .class-name {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.class-row .class-name small {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		padding-left: 5px;
	}
</style>
