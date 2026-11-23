<script lang="ts">
	// "Something outside Charnik changed this character" — asked when a save was refused because
	// `character.json` is not the file this app last held. No `onDismiss`: nothing has been written,
	// and a stray click on the backdrop must not pick a winner for the player.
	import { _ } from '$lib/i18n';
	import DialogShell from './DialogShell.svelte';
	import {
		characters,
		resolveConflict,
		CONFLICT_CHOICE,
		type ConflictChoice,
	} from '$lib/character/store.svelte';
	import { rosterEntryOf } from '$lib/character/repository';
	import type { Character } from '$lib/character/schema';
	import { errText } from '$lib/util/format';
	import { toast } from '$lib/toast/toast';

	const conflict = $derived(characters.conflict);
	const theirs = $derived(conflict?.file.character ?? null);
	let settling = $state(false);

	const summaryOf = (c: Character) => ({
		level: rosterEntryOf(c).level,
		hp: c.play.hp.current,
	});

	async function settle(choice: ConflictChoice) {
		settling = true;
		try {
			await resolveConflict(choice);
		} catch (e) {
			// the question stays open: the state the player chose is not on disk yet
			toast($_('character.conflict.failed'), { description: errText(e) });
		} finally {
			settling = false;
		}
	}
</script>

{#if conflict}
	<DialogShell
		titleId="character-conflict-title"
		title={$_('character.conflict.title')}
		sub={conflict.mine.build.name}
		subtitle={$_('character.conflict.subtitle')}
		width="min(640px, calc(100vw - 2 * var(--space-4)))"
	>
		<div class="dialog-body">
			<div class="sides">
				<section class="dialog-card">
					<span class="dialog-label">{$_('character.conflict.mine')}</span>
					<span class="what"
						>{$_('character.conflict.summary', { values: summaryOf(conflict.mine) })}</span
					>
					<button class="btn" disabled={settling} onclick={() => settle(CONFLICT_CHOICE.mine)}
						>{$_('character.conflict.keepThis')}</button
					>
				</section>
				<section class="dialog-card">
					<span class="dialog-label">{$_('character.conflict.file')}</span>
					{#if theirs}
						<span class="what"
							>{$_('character.conflict.summary', { values: summaryOf(theirs) })}</span
						>
					{:else}
						<span class="what"
							>{$_('character.conflict.unreadable', {
								values: { error: conflict.file.error ?? '' },
							})}</span
						>
					{/if}
					<button
						class="btn"
						disabled={settling || !theirs}
						onclick={() => settle(CONFLICT_CHOICE.file)}>{$_('character.conflict.keepThis')}</button
					>
				</section>
			</div>
			<p class="hint">
				{$_('character.conflict.bothHint', {
					values: {
						copy: $_('character.conflict.copyName', { values: { name: conflict.mine.build.name } }),
					},
				})}
			</p>
		</div>

		<footer class="dialog-foot">
			<span class="dialog-spacer"></span>
			<button class="btn primary" disabled={settling} onclick={() => settle(CONFLICT_CHOICE.copy)}
				>{$_('character.conflict.keepBoth')}</button
			>
		</footer>
	</DialogShell>
{/if}

<style>
	.sides {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.sides section {
		flex: 1 1 14rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	/* the version is the number to compare, so it reads as one */
	.what {
		font-family: var(--font-display);
		font-weight: 600;
	}
	.sides .btn {
		align-self: flex-start;
		margin-top: var(--space-2);
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
