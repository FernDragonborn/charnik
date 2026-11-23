<script lang="ts">
	// DEV-ONLY preview of the service dialogs on hand-made data, one per `?d=<name>`, so each can be
	// looked at in both themes and both locales without staging the failure that raises it — a file
	// changed under a character, a folder that is not empty. The dialogs are the real components.
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { characters } from '#lib/character/store.svelte.ts';
	import { newCharacter } from '#lib/character/schema.ts';
	import EditionSwitchDialog from '../../build/blocks/EditionSwitchDialog.svelte';
	import { SYSTEM_LABELS } from '#lib/rules/pipeline.ts';

	const which = $derived(page.url.searchParams.get('d') ?? '');
	let ready = $state(false);

	onMount(() => {
		// the layout raises the conflict question itself whenever one is held
		if (which === 'conflict') {
			const mine = newCharacter('karroth', 'Karroth the Red', '5.5e');
			mine.play.hp.current = 38;
			const theirs = newCharacter('karroth', 'Karroth the Red', '5.5e');
			theirs.play.hp.current = 52;
			characters.conflict = { mine, file: { ok: true, character: theirs } };
		}
		ready = true;
	});
</script>

{#if ready && which === 'edition'}
	<EditionSwitchDialog
		system={SYSTEM_LABELS['5.5e']}
		from={SYSTEM_LABELS['5e']}
		losing={[
			{ type: 'feat', ref: 'feat:SRD 5.1:fire-resistance', name: 'Fire Resistance' },
			{ type: 'spell', ref: 'spell:SRD 5.1:fire-bolt', name: 'Fire Bolt' },
		]}
		onConfirm={() => {}}
		onCancel={() => {}}
	/>
{/if}
