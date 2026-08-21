<script lang="ts">
	// DEV-ONLY preview of the content-health panel. The panel is the only surface a user has for
	// "why isn't my CSV showing up", and on the shipped SRD it always renders "all clear" — so its
	// problem states had no visual coverage at all. This route feeds DELIBERATELY broken CSVs through
	// the REAL loader (not hand-made issue objects), so what you see is what a user would see.
	// shot.mjs pixel-diffs the first viewport only — `body` never scrolls, so the groups below the
	// fold are eyeballed here rather than diffed, the same as on every long route.
	import ContentHealth from '$lib/components/settings/ContentHealth.svelte';
	import { MemoryStorage } from '$lib/storage/memory';
	import { loadContent } from '$lib/content/loader';
	import { content, loadContentStore } from '$lib/content/store.svelte';
	import { deriveHealth } from '$lib/character/health.svelte';

	const SPELL_HEAD =
		'id,systems,source,name_en,name_uk,text_en,text_uk,level,school,casting_time,range,components,duration,concentration,ritual';
	const spell = (id: string, systems: string, name_uk = '', text_uk = '') =>
		`${id},${systems},Homebrew,${id},${name_uk},A spell.,${text_uk},3,evocation,1 action,150 feet,V,Instantaneous,false,false`;

	const files: Record<string, string> = {
		// one row half-translated, one duplicate id, one with an unusable `systems` value
		'preview/spells_homebrew.csv': [
			SPELL_HEAD + ',name_spanish',
			spell('fire_bolt', '5.5e', 'Вогняна стріла') + ',Dardo',
			spell('fire_bolt', '5.5e') + ',',
			spell('bad_edition', '3.5e') + ',',
		].join('\n'),
		'preview/stuff.csv': ['#content-type: speel', SPELL_HEAD, spell('zap', '5.5e')].join('\n'),
		'preview/whatever.csv': [SPELL_HEAD, spell('zap', '5.5e')].join('\n'),
		'preview/spell_lists_homebrew.csv': [
			'id,systems,source,class_id,spell_id',
			'x,5.5e,Homebrew,warlok,fire_bolt',
		].join('\n'),
		// a stamped file whose body no longer matches its hash → the drift group
		'preview/feats_homebrew.csv': [
			'#content-source: My Feats',
			'#content-license: Custom',
			'#content-updated_at: 2026-08-01',
			'#content-hash: xxh64:0000000000000000',
			'id,systems,source,name_en,text_en,effects',
			// the d7 is deliberate: it drives the authoring-lint group from the real lint, not a stub
			'lucky_ish,5.5e,My Feats,Lucky-ish,Reroll a die.,flat_bonus:ac+1d7',
		].join('\n'),
	};

	async function seed(): Promise<void> {
		// the layout's own load is already in flight; let it finish, then take the store over — else
		// the real (healthy) SRD graph lands last and the preview shows "all clear"
		await loadContentStore();
		const storage = new MemoryStorage();
		for (const [path, body] of Object.entries(files)) await storage.write(path, body);
		content.graph = await loadContent(storage, ['preview']);
		content.guid = crypto.randomUUID();
		// the derive-time half comes from whichever character is open in play; stand in for it
		deriveHealth.set('Karroth the Red', [
			{
				source: 'Cloak of Protection',
				token: 'flat_bonus:armorclass+1',
				reason:
					'Nothing on the sheet is called "armorclass", so this effect changes nothing — did you mean "ac"?',
				detail: 'flat_bonus: unknown target "armorclass"',
			},
			{
				source: 'Rage',
				token: 'plugin:brutal:damage',
				reason:
					'This part of the sheet is worked out by a plugin, and the plugin did not return a usable answer — so it contributes nothing. Nothing else on the sheet is affected. Fix the plugin, then press “Retry plugins”.',
				detail: 'plugin budget for this computation exhausted',
			},
		]);
	}
	const ready = seed();
</script>

<div class="page">
	<h1>Dev preview · Content health</h1>
	{#await ready}
		<p>Loading the broken preview content…</p>
	{:then}
		<ContentHealth />
	{/await}
</div>

<style>
	.page {
		padding: var(--space-6);
		max-width: 900px;
	}
	h1 {
		font-family: var(--font-display);
		color: var(--color-text);
		margin-bottom: var(--space-5);
	}
	p {
		color: var(--color-text-muted);
	}
</style>
