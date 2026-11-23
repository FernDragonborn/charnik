<script lang="ts">
	// DEV-ONLY preview of the service dialogs on hand-made data, one per `?d=<name>`, so each can be
	// looked at in both themes and both locales without staging the failure that raises it — a file
	// changed under a character, a folder that is not empty, a draft whose entry is gone. The dialogs
	// are the real components.
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { characters } from '#lib/character/store.svelte.ts';
	import { newCharacter } from '#lib/character/schema.ts';
	import EditionSwitchDialog from '../../build/blocks/EditionSwitchDialog.svelte';
	import OrphanDialog from '#lib/components/OrphanDialog.svelte';
	import { SYSTEM_LABELS } from '#lib/rules/pipeline.ts';
	import { getContentGraph } from '#lib/content/provider.ts';
	import type { ContentGraph } from '#lib/content/loader.ts';
	import type { DraftEnvelope } from '#lib/drafts/store.ts';

	const which = $derived(page.url.searchParams.get('d') ?? '');
	let ready = $state(false);
	let graph = $state<ContentGraph | null>(null);

	/** An edit of a spell whose row was renamed away, then a translation of one whose source is off. */
	const ORPHANS: DraftEnvelope[] = [
		{
			schemaVersion: 1,
			target: { kind: 'editor', type: 'spell', source: 'SRD 5.1', id: 'fire-lance' },
			savedAt: '2026-11-19T21:40:00Z',
			data: {
				id: 'fire-lance',
				name_en: 'Fire Lance',
				level: 2,
				school: 'evocation',
				casting_time: '1 action',
				range: '120 feet',
				text_en:
					'You hurl a lance of pure flame at a creature you can see within range. Make a ranged spell attack; on a hit the target takes 3d8 fire damage.',
			},
		},
		{
			schemaVersion: 1,
			target: {
				kind: 'translate',
				type: 'spell',
				source: 'Old Pack',
				id: 'frost-ray',
				locale: 'uk',
			},
			savedAt: '2026-11-20T09:15:00Z',
			data: { name: 'Морозний промінь', text: 'Холодний промінь блакитного світла…' },
		},
	];

	onMount(() => {
		// the layout raises the conflict question itself whenever one is held
		if (which === 'conflict') {
			const mine = newCharacter('karroth', 'Karroth the Red', '5.5e');
			mine.play.hp.current = 38;
			const theirs = newCharacter('karroth', 'Karroth the Red', '5.5e');
			theirs.play.hp.current = 52;
			characters.conflict = { mine, file: { ok: true, character: theirs } };
		}
		if (which === 'orphan')
			void getContentGraph().then((loaded) => {
				graph = loaded;
			});
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

{#if ready && which === 'orphan' && graph && ORPHANS[0]}
	<OrphanDialog orphans={ORPHANS} startAt={ORPHANS[0]} {graph} onDone={() => {}} />
{/if}
